import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AtSign, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  fetchGenres,
  type GenreCategoryGroup,
} from "../../hooks/useNarrativeStream";
import { useNarrativeStore, useNarrativePhase, type NavTab } from "../../store/narrativeStore";
import { compositionLockReason, isCompositionEditable } from "../../store/phase";
import {
  COMPOSER_DND_MIME,
  ENTRY_CATALOG_ID,
  customTeamItem,
  findCatalogItem,
  genreExpertItem,
  narrativeRouteItem,
  type ComposerCatalogItem,
} from "../../composer/composerCatalog";
import { ASSISTANT_SEATS, seatPrimaryStep } from "../../composer/seats.generated";
import {
  createCustomTeam,
  customTeamLabel,
  deleteCustomTeam,
  distillCustomTeam,
  listCustomTeams,
  subscribeCustomTeams,
  type CustomTeam,
  type CustomTeamKind,
  type TeamMaterialGroup,
} from "../../lib/customTeams";
import { sendRoleToComposer } from "../../lib/bridge";
import type { ModeId, TierId } from "../../types";
import { useT, getLocale } from "../../i18n";

/**
 * 席位 → 叙事路由。
 *
 * 二十席是产品口径的花名册，叙事路由是后端实际能起的那几条单品管线，两者不是一一对应：
 * 有的席位（结构、设定集、各类质检与润色）后端尚无独立可单跑的入口。
 * 映射不上的席位仍可 @、可拖进画布，只是点它不落路由——与其偷偷回落到"自动"，
 * 不如明说这一席还不能单跑。
 */
const SEAT_ROUTE: Readonly<Record<string, ModeId>> = {
  worldview: "worldview" as ModeId,
  character: "character" as ModeId,
  item: "item_lore" as ModeId,
  scene_list: "scene" as ModeId,
  outline: "initial_outline" as ModeId,
  plot: "script" as ModeId,
  quest: "quest" as ModeId,
  storyboard: "vn_storyboard_mode" as ModeId,
  narrative_card: "narrative_card" as ModeId,
};

/** 把一个角色项塞进 dataTransfer——与画布 onDrop 读的是同一个 MIME。 */
function startRoleDrag(e: React.DragEvent, item: ComposerCatalogItem, label: string): void {
  e.dataTransfer.setData(COMPOSER_DND_MIME, JSON.stringify({ catalogId: item.id, item }));
  e.dataTransfer.setData("text/plain", label);
  e.dataTransfer.effectAllowed = "copy";
}

/**
 * 创作空间的第二层——真正的工具栏，只放三类工具组：
 *
 *  - 叙事策划专家组：按游戏品类预制的多 agent 管线。两级：游戏类型是「X 专家组」，
 *    其下的具体品类是「Y 专家」——一组人对一个类型，一个人对一个品类。
 *  - 叙事助手团队：二十席基础 agent，各司一环；
 *  - 自定义专属叙事团队：用户投喂作者作品蒸馏出的私有助手。
 *
 * 叙事上传与叙事路由不在这里——需求写在画布的输入节点里，或直接在平台对话栏说。
 * 视图切换与画布缩放也不在这里，归底栏那条居中工具条。
 */
export function CenterToolbar() {
  const t = useT();
  const openTab = useNarrativeStore((s) => s.openNavTab);
  const setOpenTab = useNarrativeStore((s) => s.setOpenNavTab);
  const routing = useNarrativeStore((s) => s.routing);
  const setRouting = useNarrativeStore((s) => s.setRouting);
  const setRoutingConfigured = useNarrativeStore((s) => s.setRoutingConfigured);
  const notifyConfigChange = useNarrativeStore((s) => s.notifyConfigChange);

  const [genres, setGenres] = useState<GenreCategoryGroup[]>([]);
  const [openGenreCat, setOpenGenreCat] = useState<string | null>(null);
  const [teams, setTeams] = useState<CustomTeam[]>([]);
  const [teamKind, setTeamKind] = useState<CustomTeamKind>("book_template");
  const [teamSource, setTeamSource] = useState("");
  /**
   * 材料按"书"分组，且分组由用户显式声明。
   *
   * 不按文件名去猜谁和谁是同一本：后端的 unit-identity 只能解析单部作品内的章节序号，
   * 跨书归组它推不出来，猜错会把多本书的风格搅成一团且不报错。全维度蒸馏里
   * 空标题那一组是"作者本人资料"（访谈、创作谈）。
   */
  const [teamGroups, setTeamGroups] = useState<TeamMaterialGroup[]>([]);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const materialRef = useRef<HTMLInputElement>(null);
  /** 这次点开文件选择器是在给哪一组收材料（空串 = 作者本人资料）。 */
  const pendingGroupRef = useRef<string>("");
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [menuX, setMenuX] = useState<number | null>(null);

  /**
   * 生产前后的编排闸门。
   *
   * 闸门本身在 `App.tsx`——非 idle 就不挂编排画布。但调色板一直在，所以此前非 idle
   * 仍然可以起拖：拖出去没有落点，松手什么也不发生，也没有话说明为什么。
   * 这里读同一个判据，把不能拖说出来；`@` 与「点一下落路由」不受影响，
   * 那两件事在跑着的时候仍然成立。
   */
  const phase = useNarrativePhase();
  const canCompose = isCompositionEditable(phase);
  const lockReason = compositionLockReason(phase);

  useEffect(() => {
    if (openTab !== "experts" || genres.length > 0) return;
    let alive = true;
    fetchGenres(getLocale()).then((g) => alive && setGenres(g)).catch(() => {});
    return () => { alive = false; };
  }, [openTab, genres.length]);

  useEffect(() => {
    void listCustomTeams().then(setTeams);
    return subscribeCustomTeams(setTeams);
  }, []);

  // 点面板外收起：菜单浮在主体上方，不收起会挡住正文。
  useEffect(() => {
    if (!openTab) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenTab(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openTab, setOpenTab]);

  /** 菜单左沿对齐打开它的那个 tab；窗口尺寸变了要重量一次，否则菜单会漂在旧位置。 */
  useEffect(() => {
    if (!openTab) return;
    const measure = () => {
      // tab 的 offsetParent 就是 position:relative 的 .cw-topnav，与面板同一坐标系。
      const tab = barRef.current?.querySelector<HTMLElement>(`[data-tab="${openTab}"]`);
      if (tab) setMenuX(tab.offsetLeft);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [openTab]);

  /** 选中任一工具都要落这三件事，否则 phase 到不了 routed。 */
  const commitRouting = useCallback(
    (patch: Parameters<typeof setRouting>[0]) => {
      setRouting(patch);
      setRoutingConfigured(true);
      notifyConfigChange("routing");
    },
    [setRouting, setRoutingConfigured, notifyConfigChange],
  );

  const mention = useCallback((item: ComposerCatalogItem, label: string) => {
    sendRoleToComposer({
      name: label,
      category: item.category,
      catalogId: item.id,
      pipelineTemplate: item.pipelineTemplate,
      tier: item.tier ?? null,
      routeGroup: item.routeGroup,
      stepId: item.stepId,
      modeId: item.modeId,
      teamId: item.teamId,
    });
  }, []);

  /** 末级工具行：@ 送进对话框，行本身可拖进画布，点一下则落成当前配置。 */
  const renderLeaf = (opts: {
    key: string;
    label: string;
    title?: string;
    active: boolean;
    item: ComposerCatalogItem;
    onPick?: () => void;
    /** 角标：席位在管线里的角色（default 不标——那是常态，标了全是噪音）。 */
    badge?: { text: string; kind: string };
  }) => (
    <div
      key={opts.key}
      className={`cw-menu__leaf${opts.active ? " is-active" : ""}${opts.onPick ? "" : " is-unwired"}${canCompose ? "" : " is-locked"}`}
      draggable={canCompose}
      onDragStart={(e) => canCompose && startRoleDrag(e, opts.item, opts.label)}
      title={canCompose ? opts.title : t(lockReason ?? "composer.locked.confirmed")}
    >
      <button
        type="button"
        className="cw-menu__at"
        title={t("lib.mentionAssistant")}
        aria-label={t("lib.mentionAssistant")}
        onClick={(e) => { e.stopPropagation(); mention(opts.item, opts.label); }}
      >
        <AtSign size={10} aria-hidden />
      </button>
      <button
        type="button"
        className="cw-menu__item cw-menu__item--leaf"
        disabled={!opts.onPick}
        onClick={opts.onPick}
      >
        {opts.label}
        {opts.badge && (
          <span className={`cw-menu__role cw-menu__role--${opts.badge.kind}`}>{opts.badge.text}</span>
        )}
      </button>
    </div>
  );

  const genreName = (() => {
    if (!routing.genreCode) return null;
    for (const group of genres) {
      const hit = group.genres.find((g) => g.code === routing.genreCode);
      if (hit) return hit.name;
    }
    return routing.genreCode;
  })();

  const summaries: Record<NavTab, string> = {
    experts: genreName ?? t("nav.none"),
    units: routing.routeGroup === "narrative" ? t(`route.${routing.narrativeRoute}.label`) : t("nav.none"),
    custom: teams.length > 0 ? t("team.count", { n: teams.length }) : t("nav.none"),
  };

  const TABS: { id: NavTab; label: string }[] = [
    { id: "experts", label: t("nav.tools.experts") },
    { id: "units", label: t("nav.tools.units") },
    { id: "custom", label: t("nav.tools.custom") },
  ];

  /**
   * 建团队并立刻起蒸馏。
   *
   * 建与蒸馏是后端两个端点（建立即返回、蒸馏 202 异步跑），但对用户是一件事：
   * 他点的是"建立团队"，期望的是过一会儿多出一位可用的成员。留一个"已建立但从没蒸馏"
   * 的中间态只会让他再找一个按钮。
   */
  const submitTeam = useCallback(async () => {
    const source = teamSource.trim();
    if (!source) return;
    const withFiles = teamGroups.filter((g) => g.files.length > 0);
    if (withFiles.length === 0) {
      setSubmitError(t("team.needMaterials"));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const team = await createCustomTeam(teamKind, source, withFiles);
      await distillCustomTeam(team.id, withFiles);
      setTeamSource("");
      setTeamGroups([]);
      setCreatingTeam(false);
      // 蒸馏在后端跑，回到菜单能看到 distilling 转成 ready（列表自带轮询）。
      setOpenTab("custom");
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [teamKind, teamSource, teamGroups, t, setOpenTab]);

  /** 收一批文件到某一组（书）。全维度蒸馏可以有多组 + 一组作者资料。 */
  const addFilesToGroup = useCallback((title: string, files: File[]) => {
    if (files.length === 0) return;
    setTeamGroups((prev) => {
      const at = prev.findIndex((g) => g.title === title);
      if (at < 0) return [...prev, { title, files }];
      const merged = [...prev];
      const seen = new Set(merged[at]!.files.map((f) => f.name));
      merged[at] = {
        title,
        files: [...merged[at]!.files, ...files.filter((f) => !seen.has(f.name))],
      };
      return merged;
    });
  }, []);

  return (
    <div className="cw-topnav" ref={rootRef}>
      <div className="cw-topnav__bar" role="tablist" aria-label={t("nav.aria")} ref={barRef}>
        {TABS.map((tab) => {
          const open = openTab === tab.id;
          return (
            <button
              key={tab.id}
              data-tab={tab.id}
              type="button"
              role="tab"
              aria-selected={open}
              aria-expanded={open}
              className={`cw-topnav__tab${open ? " is-open" : ""}`}
              title={summaries[tab.id]}
              onClick={() => setOpenTab(open ? null : tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
        {/*
         * 第二枚需求入口：画布默认自带一枚种子入口节点，但那枚是数据层种下的，
         * 顶栏此前没有任何可拖入口——"自由组织多条管线"这条设计在算法与后端就绪
         * 的情况下，界面上用不上。这一枚可拖可重复：拖几次就锚几条独立管线。
         */}
        <div
          className={`cw-topnav__tab cw-topnav__entry${canCompose ? "" : " is-locked"}`}
          draggable={canCompose}
          onDragStart={(e) => {
            if (!canCompose) return;
            const item = findCatalogItem(ENTRY_CATALOG_ID);
            if (item) startRoleDrag(e, item, t("composer.entryDrag.label"));
          }}
          title={canCompose ? t("composer.entryDrag.hint") : t(lockReason ?? "composer.locked.confirmed")}
          aria-label={t("composer.entryDrag.label")}
        >
          <Plus size={12} aria-hidden />
          {t("composer.entryDrag.label")}
        </div>
      </div>

      {openTab && (
        <div
          className="cw-topnav__panel"
          role="region"
          aria-label={t("nav.aria")}
          style={menuX === null ? undefined : ({ "--cw-menu-x": `${menuX}px` } as CSSProperties)}
        >
          {openTab === "experts" && (
            <>
              {/* 中间一级是游戏类型 → 一个专家组；末级是具体品类 → 一位专家。 */}
              <div className="cw-menu">
                {genres.map((group) => (
                  <button
                    key={group.category}
                    type="button"
                    className={`cw-menu__item${openGenreCat === group.category ? " is-open" : ""}`}
                    onClick={() => setOpenGenreCat(group.category)}
                  >
                    {t("nav.suffix.group", { name: group.label })}
                  </button>
                ))}
              </div>
              {openGenreCat && (
                <div className="cw-menu cw-menu--leaf">
                  {(genres.find((g) => g.category === openGenreCat)?.genres ?? []).map((g) => {
                    const active = routing.genreCode === g.code;
                    const expertLabel = t("nav.suffix.expert", { name: g.name });
                    return renderLeaf({
                      key: g.code,
                      label: expertLabel,
                      title: g.keywords?.join(" / "),
                      active,
                      item: genreExpertItem(g, expertLabel),
                      onPick: () =>
                        // 选定专家即选定品类；层级跟着品类走，用户不再单挑。
                        commitRouting(
                          active
                            ? { genreCode: null }
                            : { routeGroup: "planning", genreCode: g.code, tierChoice: g.tier as TierId },
                        ),
                    });
                  })}
                </div>
              )}
            </>
          )}

          {openTab === "units" && (
            <div className="cw-menu cw-menu--leaf">
              {ASSISTANT_SEATS.map((seat) => {
                const route = SEAT_ROUTE[seat.id];
                const runnable = !!route && seat.status === "active";
                const active = runnable && routing.routeGroup === "narrative" && routing.narrativeRoute === route;
                // 不进默认步序的席位要在菜单上说清楚，否则百科娘这类"跑管线永远
                // 不会带上"的席位与必跑席位长得一样，用户只能靠跑一遍才发现。
                const role = seat.pipelineRole === "default" ? null : seat.pipelineRole;
                return renderLeaf({
                  key: seat.id,
                  label: seat.name,
                  title: [
                    runnable
                      ? t(`route.${route}.hint`)
                      : seat.status === "planned"
                        ? t("nav.seat.planned")
                        : t("nav.seat.noSoloRun"),
                    role ? t(`nav.seat.role.${role}.hint`) : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  badge: role ? { text: t(`nav.seat.role.${role}`), kind: role } : undefined,
                  active,
                  item: runnable
                    ? narrativeRouteItem(route, seat.name)
                    : {
                        id: `engineer.${seat.id}`,
                        category: "engineer" as const,
                        labelKey: `composer.item.engineer.${seat.id}`,
                        label: seat.name,
                        icon: "▣",
                        seatId: seat.id,
                        stepId: seatPrimaryStep(seat.id),
                        planned: seat.status === "planned",
                        pipelineRole: seat.pipelineRole,
                      },
                  onPick: runnable
                    ? () => commitRouting({ routeGroup: "narrative", narrativeRoute: route })
                    : undefined,
                });
              })}
            </div>
          )}

          {openTab === "custom" && (
            <div className="cw-menu cw-menu--custom">
              {teams.length === 0 && <p className="cw-menu__hint">{t("team.empty")}</p>}
              {teams.map((team) => {
                const label = customTeamLabel(team, t);
                const item = customTeamItem(team, label);
                // 两个条件都得成立：这支团队蒸馏好了，且现在还在可编排的阶段。
                const usable = team.status === "ready" && canCompose;
                return (
                  <div
                    key={team.id}
                    className={`cw-menu__leaf${usable ? "" : " is-unwired"}${canCompose ? "" : " is-locked"}`}
                    // 可拖进画布：拖一枚团队节点接到入口，这条管线就带上这位成员。
                    draggable={usable}
                    onDragStart={(e) => usable && startRoleDrag(e, item, label)}
                  >
                    <button
                      type="button"
                      className="cw-menu__at"
                      title={t("lib.mentionAssistant")}
                      aria-label={t("lib.mentionAssistant")}
                      onClick={() => mention(item, label)}
                    >
                      <AtSign size={10} aria-hidden />
                    </button>
                    <span
                      className="cw-menu__item cw-menu__item--leaf"
                      // 失败要能看见原因：只显示"失败"的话用户唯一能做的就是再点一次同样会挂的按钮。
                      title={team.errorMessage ?? team.profile?.summary ?? t(`team.status.${team.status}`)}
                    >
                      {label}
                      <em className="cw-menu__picked">{t(`team.status.${team.status}`)}</em>
                    </span>
                    <button
                      type="button"
                      className="cw-menu__at"
                      title={t("team.delete")}
                      aria-label={t("team.delete")}
                      onClick={() => void deleteCustomTeam(team.id)}
                    >
                      <Trash2 size={10} aria-hidden />
                    </button>
                  </div>
                );
              })}

              {/* 常态是"一列已有团队 + 末尾一个 +"。建团是独立一件事，不是这一列的下一项，
                  所以按下 + 收起菜单、另开居中模态，不再往菜单尾巴上接一段长表单。 */}
              <button
                type="button"
                className="cw-menu__new"
                title={t("team.create")}
                aria-label={t("team.create")}
                onClick={() => { setCreatingTeam(true); setOpenTab(null); }}
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}

      {creatingTeam && (
        <div
          className="cw-team-modal__backdrop"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget) setCreatingTeam(false); }}
        >
          <div className="cw-team-modal" role="dialog" aria-modal="true" aria-label={t("team.create")}>
            <header className="cw-team-modal__head">
              <span className="cw-team-modal__title">{t("team.create")}</span>
              <button
                type="button"
                className="cw-team-modal__close"
                title={t("team.cancel")}
                aria-label={t("team.cancel")}
                onClick={() => setCreatingTeam(false)}
              >
                <X size={14} aria-hidden />
              </button>
            </header>
              <div className="cw-team-form">
                <div className="cw-team-form__kinds">
                  {(["book_template", "author_advisor"] as CustomTeamKind[]).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`cw-menu__item${teamKind === kind ? " is-active" : ""}`}
                      onClick={() => setTeamKind(kind)}
                    >
                      {t(`team.kind.${kind}`)}
                    </button>
                  ))}
                </div>
                <p className="cw-menu__hint">{t(`team.kind.${teamKind}.hint`)}</p>
                <input
                  className="narrative-tag-custom-input"
                  value={teamSource}
                  placeholder={t(`team.source.${teamKind}`)}
                  onChange={(e) => setTeamSource(e.target.value)}
                />
                {/* 单本蒸馏只有一本书，分组即书名本身，不必让用户再声明一遍。
                    全维度蒸馏要按书分开投喂——蒸馏专家据此分辨"哪条规律跨了作品"，
                    混成一堆它就只能当成一本超长的书看。 */}
                {teamKind === "book_template" ? (
                  <button
                    type="button"
                    className="fx-btn"
                    onClick={() => { pendingGroupRef.current = teamSource.trim(); materialRef.current?.click(); }}
                    disabled={!teamSource.trim()}
                  >
                    <Plus size={12} aria-hidden />
                    {t("team.addMaterials", { n: teamGroups[0]?.files.length ?? 0 })}
                  </button>
                ) : (
                  <>
                    <input
                      className="narrative-tag-custom-input"
                      value={newGroupTitle}
                      placeholder={t("team.groupTitle")}
                      onChange={(e) => setNewGroupTitle(e.target.value)}
                    />
                    <div className="cw-team-form__kinds">
                      <button
                        type="button"
                        className="fx-btn"
                        disabled={!newGroupTitle.trim()}
                        onClick={() => { pendingGroupRef.current = newGroupTitle.trim(); materialRef.current?.click(); }}
                      >
                        <Plus size={12} aria-hidden />
                        {t("team.addBook")}
                      </button>
                      {/* 空标题那一组：作者本人资料（访谈、创作谈），2.4.2 拿它当"作者怎么想"的直接证据。 */}
                      <button
                        type="button"
                        className="fx-btn"
                        onClick={() => { pendingGroupRef.current = ""; materialRef.current?.click(); }}
                      >
                        <Plus size={12} aria-hidden />
                        {t("team.addAuthorMaterials")}
                      </button>
                    </div>
                  </>
                )}
                <input
                  ref={materialRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFilesToGroup(pendingGroupRef.current, Array.from(e.target.files ?? []));
                    // 收完一本就清输入框，下一本直接键入书名——否则用户会以为刚才那本没收进去。
                    if (pendingGroupRef.current && pendingGroupRef.current === newGroupTitle.trim()) {
                      setNewGroupTitle("");
                    }
                    e.target.value = "";
                  }}
                />
                {teamGroups.map((group) => (
                  <p key={group.title || "__author__"} className="cw-menu__hint">
                    {(group.title || t("team.authorMaterialsLabel"))}
                    ：{group.files.map((f) => f.name).join("、")}
                  </p>
                ))}
                {/* 检索开关只对全维度蒸馏有意义：作者本人的公开资料不在上传里，只能检索。 */}
                {teamKind === "author_advisor" && (
                  <p className="cw-menu__hint">{t("team.encyclopediaHint")}</p>
                )}
                <div className="cw-team-form__foot">
                  <button
                    type="button"
                    className="fx-btn"
                    disabled={!teamSource.trim() || submitting}
                    onClick={() => void submitTeam()}
                  >
                    <Sparkles size={12} aria-hidden />
                    {submitting ? t("team.distilling") : t("team.create")}
                  </button>
                  <button type="button" className="fx-btn" onClick={() => setCreatingTeam(false)}>
                    {t("team.cancel")}
                  </button>
                </div>
                {submitError && <p className="cw-menu__hint cw-menu__hint--warn">{submitError}</p>}
                <p className="cw-menu__hint">{t("team.distillHint")}</p>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
