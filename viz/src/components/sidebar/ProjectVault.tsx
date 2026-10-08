import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, Check, ChevronDown, ChevronLeft, ChevronRight, Crosshair, FileText, Plus, Trash2, X } from "lucide-react";
import {
  addCategory,
  createProject,
  deleteCategory,
  deleteProject,
  listProjects,
  moveAsset,
  removeAsset,
  renameCategory,
  subscribeProjects,
  updateProject,
  type NarrativeProject,
  type ProjectAsset,
} from "../../lib/projectVault";
import { archiveAsset } from "../../lib/archiveAsset";
import { composerTarget, sendFileToComposer } from "../../lib/bridge";
import { useMention } from "../../hooks/useMention";
import { canLocateInContentBrowser, locateInContentBrowser } from "../../lib/locateArtifact";
import { fetchRunFiles } from "../../hooks/useNarrativeStream";
import {
  buildLibraryContents,
  classifyContent,
  CONTENT_TYPES,
  type LibraryFile,
} from "../../lib/contentTypes";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useNarrativeRuntime } from "../runtime/NarrativeRuntimeProvider";
import { useT } from "../../i18n";

/** 时间戳 → 与任务列表同款的「月/日 时:分」。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 跨任务挑产物：先选一个任务，再从它的产物里挑一份放进当前类别。
 *
 * 项目的资产可以横跨多个任务，所以选择器不能锁在某一跑上——这正是资源库
 * 与资产库解耦之后必须有的一步。列表复用任务管理那份历史，内容按需拉。
 */
function AssetPicker({
  onPick,
  onClose,
  title,
}: {
  onPick: (taskKey: string, file: LibraryFile) => void;
  onClose: () => void;
  title: string;
}) {
  const t = useT();
  const wb = useNarrativeRuntime();
  const [taskKey, setTaskKey] = useState<string | null>(null);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskKey) return;
    let cancelled = false;
    setLoading(true);
    fetchRunFiles(taskKey)
      .then((groups) => {
        if (cancelled) return;
        const paths = groups.flatMap((g) => g.files.map((f) => `${g.group}/${f}`));
        const { buckets, loose } = buildLibraryContents(paths);
        setFiles([...buckets.flatMap((b) => b.files), ...loose]);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  return (
    <div className="tf-collect" role="dialog" aria-label={title}>
      <header className="tf-collect__head">
        <span className="tf-collect__title">{title}</span>
        <button type="button" className="tf-collect__close" aria-label={t("nav.input.close")} onClick={onClose}>
          <X size={12} aria-hidden />
        </button>
      </header>
      <div className="tf-collect__body">
        {!taskKey ? (
          (wb?.displayHistory ?? []).length === 0 ? (
            <p className="pi-hint">{t("vault.pickNoTask")}</p>
          ) : (
            (wb?.displayHistory ?? []).map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="tf-collect__row"
                onClick={() => setTaskKey(entry.key)}
              >
                <span>{entry.userInput?.slice(0, 40) || entry.key}</span>
                <em>{t("vault.assets", { n: entry.fileCount ?? 0 })}</em>
              </button>
            ))
          )
        ) : loading ? (
          <p className="pi-hint">{t("tms.history.loading")}</p>
        ) : (
          <>
            <button type="button" className="tf-collect__row" onClick={() => setTaskKey(null)}>
              <ChevronLeft size={11} aria-hidden />
              <span>{t("vault.pickBack")}</span>
            </button>
            {files.length === 0 && <p className="pi-hint">{t("task.files.empty")}</p>}
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                className="tf-collect__row tf-collect__row--cat"
                title={f.path}
                onClick={() => onPick(taskKey, f)}
              >
                {f.name}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 项目管理：用户自建的资产库。目前只给原子框架。
 *
 * 与任务的分工——任务是系统按一次生成落的目录，条目三行、类别按实跑环节自动归；
 * 项目这边三条信息全由用户定：时间戳取「确认建项目」那一刻，标题与标签自填。
 *
 * 中间层是叙事类型，从资产自己的文件名派生（同一张表任务侧也在用），用户不用先建格子；
 * 只铺装得下东西的那几类，空的不铺——铺满二十个空格子在用户自己的柜子里比在任务侧更没道理。
 * 自建类别仍在，它管的是跨叙事类型的归拢，落下来能改名能删，优先于派生归位。
 *
 * 眼下整库存在浏览器本地（见 lib/projectVault.ts）：后端还没有 projects 这个实体。
 * 换后端时只换那一层端口，这里不动。
 */
export function ProjectVault() {
  const t = useT();
  const openedProjectId = useNarrativeStore((s) => s.openedProjectId);
  const openVaultProject = useNarrativeStore((s) => s.openVaultProject);
  const closeVaultProject = useNarrativeStore((s) => s.closeVaultProject);
  const setFocusedFile = useNarrativeStore((s) => s.setFocusedFile);

  const [projects, setProjects] = useState<NarrativeProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTags, setDraftTags] = useState("");
  /** 正在往哪个类别里加东西；null = 选择器没开。 */
  const [pickInto, setPickInto] = useState<string | null>(null);
  /** 新建类别的面板开着没；开着时给花名册选项 + 自定义输入。 */
  const [addingCat, setAddingCat] = useState(false);
  const [catDraft, setCatDraft] = useState("");
  /** 收起来的类别（默认全开）；折的是中间层，不是上面那张项目卡。 */
  const [closedCats, setClosedCats] = useState<string[]>([]);
  const toggleCat = useCallback(
    (id: string) =>
      setClosedCats((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [],
  );

  useEffect(() => {
    void listProjects().then(setProjects);
    return subscribeProjects(setProjects);
  }, []);

  const opened = useMemo(
    () => projects.find((p) => p.id === openedProjectId) ?? null,
    [projects, openedProjectId],
  );

  const submitNewProject = useCallback(async () => {
    const title = draftTitle.trim();
    if (!title) return;
    const tags = draftTags.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    await createProject(title, tags);
    setDraftTitle("");
    setDraftTags("");
    setCreating(false);
  }, [draftTitle, draftTags]);

  const { flashed, mention } = useMention();
  const toHost = composerTarget() === "host";

  const mentionAsset = useCallback(
    (asset: ProjectAsset) => {
      mention(asset.id, () =>
        sendFileToComposer({
          entryKey: asset.taskKey,
          path: asset.path,
          name: asset.name,
          contentType: asset.contentType ?? undefined,
        }),
      );
    },
    [mention],
  );

  /** @ 按钮的即时反馈：送去哪、成没成，都只说实际发生的那一种。 */
  const mentionTitle = useCallback(
    (key: string) => {
      if (flashed?.key !== key) return t(toHost ? "lib.mentionFile" : "lib.copyFile");
      if (flashed.delivery === "failed") return t("lib.copyFailed");
      return t(flashed.delivery === "host" ? "lib.mentioned" : "lib.copied");
    },
    [flashed, t, toHost],
  );

  // ── 项目内部：资产管理 ──────────────────────────────────────────────────
  if (opened) {
    const categories = opened.categories;

    const submitCategory = (name: string) => {
      if (!name.trim()) return;
      void addCategory(opened.id, name);
      setCatDraft("");
      setAddingCat(false);
    };

    const renderAssets = (assets: ProjectAsset[]) => (
      <div className="pi-cards pi-cards--assets">
        {assets.map((a) => (
          <div key={a.id} className="pi-card" title={`${a.taskKey} · ${a.path}`}>
            <button
              type="button"
              className="pi-at"
              title={mentionTitle(a.id)}
              aria-label={t(toHost ? "lib.mentionFile" : "lib.copyFile")}
              onClick={() => mentionAsset(a)}
            >
              {flashed?.key === a.id && flashed.delivery !== "failed" ? (
                <Check size={10} aria-hidden />
              ) : (
                <AtSign size={10} aria-hidden />
              )}
            </button>
            {/* 与任务侧同一个动作、同一条通道：定位到平台系统文件区。 */}
            {canLocateInContentBrowser() && (
              <button
                type="button"
                className="pi-at"
                title={t("lib.locateFile")}
                aria-label={t("lib.locateFile")}
                onClick={() =>
                  void locateInContentBrowser({ entryKey: a.taskKey, path: a.path, name: a.name })
                }
              >
                <Crosshair size={10} aria-hidden />
              </button>
            )}
            <button
              type="button"
              className="pi-card__open"
              onClick={() => setFocusedFile({ taskKey: a.taskKey, path: a.path, name: a.name })}
            >
              <FileText size={13} className="pi-card__icon" aria-hidden />
              <span className="pi-card__name">{a.name}</span>
            </button>
            <select
              className="pi-move"
              value={a.categoryId ?? ""}
              title={t("vault.moveTo")}
              aria-label={t("vault.moveTo")}
              onChange={(e) => void moveAsset(opened.id, a.id, e.target.value || null)}
            >
              {/* 空值不是"扔进未归类"，是"交回叙事类型自动归位"。 */}
              <option value="">{t("vault.autoByType")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="pi-star"
              title={t("vault.removeAsset")}
              aria-label={t("vault.removeAsset")}
              onClick={() => void removeAsset(opened.id, a.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );

    /** 类别下的「+」空位：点开选择器，从任意任务里挑一份产物放进来。 */
    const addSlot = (categoryId: string) => (
      <button
        type="button"
        className="pi-slot"
        title={t("vault.addAsset")}
        aria-label={t("vault.addAsset")}
        onClick={() => setPickInto(categoryId)}
      >
        <Plus size={14} aria-hidden />
      </button>
    );

    /**
     * 选择器紧跟在按下的那个「+」下面。
     * 它问的是"往这一类里加什么"，钉在面板底部时中间隔着别的类别与一堆资产卡，
     * 用户得自己把问题和答案连起来——离开了触发点，选择器就不知道是谁的选择器。
     */
    const renderPicker = (categoryId: string) => (
      <AssetPicker
        title={t("vault.addAsset")}
        onClose={() => setPickInto(null)}
        onPick={(taskKey, file) => {
          // 收进来即归档：同一个动作把这一份记为定稿，见 lib/archiveAsset.ts。
          void archiveAsset(
            opened.id,
            { taskKey, path: file.path, name: file.name, contentType: file.type },
            categoryId,
          );
          setPickInto(null);
        }}
      />
    );

    /**
     * 中间层是**叙事类型**，由资产自己派生，不用用户先把格子建出来。
     *
     * 从前这一层全靠手建：归档进来的东西一律先落进「未归类」，用户得自己建一个
     * 「角色档案」再把它拖过去——而这份产物是哪一类，文件名早就说了（同一张映射表
     * 任务侧一直在用，见 lib/contentTypes.ts）。让用户重说一遍系统已经知道的事，
     * 换来的只有一个常年堆满的「未归类」。
     *
     * 自建类别没有取消：主表允许用户在项目下开自己的类别，那是跨叙事类型的归拢
     * （「给美术的那批」这种），不是对叙事类型的替代。两者的优先级也因此定下来——
     * 显式放进自建类别的按自建走，剩下的按叙事类型落位，两边都认不出的才进未归类。
     */
    const customIds = new Set(categories.map((c) => c.id));
    // 花名册改名或用户删了自建类别后，孤儿资产退回按叙事类型归位而不是凭空消失。
    const loose = opened.assets.filter(
      (a) => a.categoryId === null || !customIds.has(a.categoryId),
    );
    const derived = CONTENT_TYPES.map((def) => ({
      id: `type:${def.id}`,
      name: t(def.labelKey),
      assets: loose.filter((a) => classifyContent(a.path) === def.id),
    })).filter((b) => b.assets.length > 0);
    // 空的叙事类型不铺：项目是用户的柜子，铺一排空格子在这里比在任务侧更没道理。
    const uncategorized = loose.filter((a) => classifyContent(a.path) === null);

    return (
      <div className="project-panel project-panel--opened">
        <div className="project-panel__body">
          {/* 与任务侧同一套：进来之后留在原位的还是那张条目卡，返回图标贴卡片右缘上下居中。 */}
          <div className="history-item is-opened">
            <div className="hi-header">
              <span className="hi-time">{formatTime(opened.createdAt)}</span>
              <span className="hi-badge hi-badge--config">
                {t("vault.assets", { n: opened.assets.length })}
              </span>
              <button
                type="button"
                className="hi-back"
                title={t("vault.back")}
                aria-label={t("vault.back")}
                onClick={closeVaultProject}
              >
                <ChevronLeft size={24} aria-hidden />
              </button>
            </div>
            <div className="hi-input-preview" title={opened.title}>{opened.title}</div>
            <div className="hi-meta">
                {opened.tags.map((tag) => (
                  <span key={tag} className="hi-tag">{tag}</span>
                ))}
                <button
                  type="button"
                  className="vault-edit"
                  onClick={() => {
                    const title = prompt(t("vault.renamePrompt"), opened.title);
                    if (title?.trim()) void updateProject(opened.id, { title });
                  }}
                >
                  {t("vault.rename")}
                </button>
                <button
                  type="button"
                  className="vault-edit"
                  onClick={() => {
                    const raw = prompt(t("vault.tagsPrompt"), opened.tags.join(", "));
                    if (raw == null) return;
                    void updateProject(opened.id, {
                      tags: raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
                    });
                  }}
                >
                  {t("vault.editTags")}
                </button>
              </div>
          </div>

          <div className="project-inside">
            <section className="pi-section">
              {/* 未归类的直挂项目下——与任务侧「归不到助手的直挂库下」同一套两级退化。 */}
              {uncategorized.length > 0 && (
                <div className={`pi-bucket${closedCats.includes("__uncat") ? " is-closed" : ""}`}>
                  <div className="pi-bucket__title">
                    <button
                      type="button"
                      className="pi-bucket__toggle"
                      aria-expanded={!closedCats.includes("__uncat")}
                      onClick={() => toggleCat("__uncat")}
                    >
                      {closedCats.includes("__uncat")
                        ? <ChevronRight size={11} aria-hidden />
                        : <ChevronDown size={11} aria-hidden />}
                      <span>{t("vault.uncategorized")}</span>
                    </button>
                    <em className="pi-bucket__count">{uncategorized.length}</em>
                  </div>
                  {!closedCats.includes("__uncat") && renderAssets(uncategorized)}
                </div>
              )}

              {/* 叙事类型桶：名字来自映射表，所以不给改名与删除——改了就对不上任务侧。 */}
              {derived.map((b) => {
                const open = !closedCats.includes(b.id);
                return (
                  <div key={b.id} className={`pi-bucket${open ? "" : " is-closed"}`}>
                    <div className="pi-bucket__title">
                      <button
                        type="button"
                        className="pi-bucket__toggle"
                        aria-expanded={open}
                        title={open ? t("entry.fold") : t("entry.unfold")}
                        onClick={() => toggleCat(b.id)}
                      >
                        {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                        <span>{b.name}</span>
                      </button>
                      <em className="pi-bucket__count">{b.assets.length}</em>
                    </div>
                    {open && renderAssets(b.assets)}
                  </div>
                );
              })}

              {categories.map((c) => {
                const files = opened.assets.filter((a) => a.categoryId === c.id);
                const open = !closedCats.includes(c.id);
                return (
                  <div
                    key={c.id}
                    className={`pi-bucket${files.length === 0 ? " is-empty" : ""}${open ? "" : " is-closed"}`}
                  >
                    <div className="pi-bucket__title">
                      <button
                        type="button"
                        className="pi-bucket__toggle"
                        aria-expanded={open}
                        title={open ? t("entry.fold") : t("entry.unfold")}
                        onClick={() => toggleCat(c.id)}
                      >
                        {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                      </button>
                      <button
                        type="button"
                        className="pi-bucket__name"
                        title={t("vault.renameCategory")}
                        onClick={() => {
                          const name = prompt(t("vault.renameCategory"), c.name);
                          if (name?.trim()) void renameCategory(opened.id, c.id, name);
                        }}
                      >
                        {c.name}
                      </button>
                      <em className="pi-bucket__count">{files.length}</em>
                      <button
                        type="button"
                        className="pi-at"
                        title={t("vault.deleteCategory")}
                        aria-label={t("vault.deleteCategory")}
                        onClick={() => void deleteCategory(opened.id, c.id)}
                      >
                        <Trash2 size={10} aria-hidden />
                      </button>
                    </div>
                    {open && (
                      <div className="pi-cards pi-cards--assets">
                        {files.length > 0 && renderAssets(files)}
                        {addSlot(c.id)}
                        {pickInto === c.id && renderPicker(c.id)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 自建类别：跨叙事类型的归拢（「给美术的那批」），与上面按类型派生的桶并存。 */}
              {!addingCat ? (
                <button type="button" className="pi-newcat" onClick={() => setAddingCat(true)}>
                  <Plus size={12} aria-hidden />
                  {t("vault.addCategory")}
                </button>
              ) : (
                <div className="pi-catadd">
                  <input
                    className="narrative-tag-custom-input"
                    autoFocus
                    value={catDraft}
                    placeholder={t("vault.newCategoryPlaceholder")}
                    onChange={(e) => setCatDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitCategory(catDraft);
                      if (e.key === "Escape") { setCatDraft(""); setAddingCat(false); }
                    }}
                  />
                  <div className="pi-catadd__foot">
                    <button
                      type="button"
                      className="fx-btn"
                      disabled={!catDraft.trim()}
                      onClick={() => submitCategory(catDraft)}
                    >
                      {t("tms.confirm")}
                    </button>
                    <button
                      type="button"
                      className="fx-btn"
                      onClick={() => { setCatDraft(""); setAddingCat(false); }}
                    >
                      {t("team.cancel")}
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    );
  }

  // ── 项目列表 ────────────────────────────────────────────────────────────
  return (
    <div className="project-panel">
      {/* 与任务侧一致：不为"共几条"单开一条带子。 */}
      <div className="project-panel__body">
        {creating && (
          <div className="vault-create">
            <input
              className="narrative-tag-custom-input"
              autoFocus
              value={draftTitle}
              placeholder={t("vault.titlePlaceholder")}
              onChange={(e) => setDraftTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submitNewProject()}
            />
            <input
              className="narrative-tag-custom-input"
              value={draftTags}
              placeholder={t("vault.tagsPlaceholder")}
              onChange={(e) => setDraftTags(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submitNewProject()}
            />
            <button
              type="button"
              className="fx-btn"
              disabled={!draftTitle.trim()}
              onClick={() => void submitNewProject()}
            >
              {t("tms.confirm")}
            </button>
          </div>
        )}

        <div className="history-list">
          {/* 与任务列表同款的「+」：新建项目，放在最上（新建是这一栏最常用的动作）。 */}
          <button
            type="button"
            className="history-new"
            title={t("vault.newProject")}
            aria-label={t("vault.newProject")}
            onClick={() => setCreating((v) => !v)}
          >
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
          {projects.length === 0 && <div className="history-empty">{t("vault.empty")}</div>}
          {projects.map((p) => (
            <div
              key={p.id}
              className="history-item"
              style={{ cursor: "pointer" }}
              title={t("vault.openHint")}
              onClick={() => openVaultProject(p.id)}
            >
              <div className="hi-header">
                <span className="hi-time">{formatTime(p.createdAt)}</span>
                <span className="hi-badge hi-badge--config">{t("vault.assets", { n: p.assets.length })}</span>
                <button
                  type="button"
                  className="hi-pipe-toggle"
                  title={t("vault.deleteProject")}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (confirm(t("vault.deleteConfirm", { name: p.title }))) void deleteProject(p.id);
                  }}
                >
                  <Trash2 size={10} aria-hidden />
                </button>
              </div>
              <div className="hi-input-preview">{p.title}</div>
              <div className="hi-meta">
                {p.tags.map((tag) => (
                  <span key={tag} className="hi-tag">{tag}</span>
                ))}
                <span className="hi-files">{t("vault.categories", { n: p.categories.length })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
