import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Crosshair,
  FileText,
  FolderPlus,
  History,
  Plus,
  X,
} from "lucide-react";
import { fetchRunFiles, fetchVersionOrigins, type VersionOrigin } from "../../hooks/useNarrativeStream";
import {
  buildLibraryContents,
  groupVersions,
  CONTENT_TYPES,
  type FileEntry,
  type LibraryContents,
  type LibraryFile,
} from "../../lib/contentTypes";
import { seatPrimaryStep } from "../../composer/seats.generated";
import {
  collectAsset,
  createProject,
  listProjects,
  subscribeProjects,
  type NarrativeProject,
} from "../../lib/projectVault";
import {
  confirmAsset,
  isConfirmed,
  listConfirmedAssets,
  unconfirmAsset,
  type ConfirmedAsset,
} from "../../lib/assetConfirm";
import { findCatalogItem } from "../../composer/composerCatalog";
import { composerTarget, sendFileToComposer, sendRoleToComposer } from "../../lib/bridge";
import { useMention } from "../../hooks/useMention";
import { canLocateInContentBrowser, locateInContentBrowser } from "../../lib/locateArtifact";
import { useNarrativeStore } from "../../store/narrativeStore";
import { useT } from "../../i18n";

/**
 * 一个任务内部的产物一览——三级里的后两级（环节文件夹 → 该环节下的产物与其各版本）。
 *
 * 中间层来自这一跑真走过的环节：跑了世界观设定就有世界观设定这一夹，没跑过的不占位。
 * 任务是一次具体的活儿，列上二十个空类别只会让用户以为哪里出了问题——空类别该出现的
 * 地方是项目库那种"等着往里放东西"的柜子。
 *
 * 顺序也照这一跑的流程排（stepOrder 由外层按 activeSteps / completedSteps 给），
 * 而不是花名册的静态顺序：用户看的是自己那条管线，先世界观后角色，不是产品目录的排法。
 *
 * 中间层的标题条可点即收：进了条目之后要腾地方的是这些文件夹，不是上面那张条目卡。
 *
 * 点文件卡 = 把它设为「当前查看的产物」，右侧文本视图铺正文、节点视图挪到对应节点。
 * 类别标题上的 @ 送的是那位助手，文件卡上的 @ 送的是那份产物，都落进宿主对话框，
 * 方便平台 agent 直接对着具体对象开工；文件夹图标则把它收进项目库。
 */
export function TaskFiles({
  taskKey,
  stepOrder = [],
}: {
  taskKey: string;
  /** 这一跑的环节顺序（step id）；空数组则退回花名册顺序。 */
  stepOrder?: readonly string[];
}) {
  const t = useT();
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /** 键权层 M2：每份历史版本文件的溯源，键是 `LibraryFile.path`。 */
  const [versionOrigins, setVersionOrigins] = useState<Record<string, VersionOrigin>>({});
  const [projects, setProjects] = useState<NarrativeProject[]>([]);
  const [collectTarget, setCollectTarget] = useState<LibraryFile | null>(null);
  /** 这个条目里已被作者确认为定稿的产物（事实源在后端 `_entry.json.assets[]`）。 */
  const [confirmed, setConfirmed] = useState<ConfirmedAsset[]>([]);
  const [openVersions, setOpenVersions] = useState<string | null>(null);
  /** 收起来的环节文件夹（默认全开：进条目就是来看东西的）。 */
  const [closedBuckets, setClosedBuckets] = useState<string[]>([]);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const setFocusedFile = useNarrativeStore((s) => s.setFocusedFile);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchRunFiles(taskKey)
      .then((groups) => {
        if (cancelled) return;
        setPaths(groups.flatMap((g) => g.files.map((f) => `${g.group}/${f}`)));
      })
      .catch(() => {
        if (!cancelled) setPaths([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  // 溯源与文件清单分开拉：一个失败/慢不该挡住文件本身的展示，标注只是锦上添花。
  useEffect(() => {
    let cancelled = false;
    fetchVersionOrigins(taskKey).then((origins) => {
      if (!cancelled) setVersionOrigins(origins);
    });
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  useEffect(() => {
    void listProjects().then(setProjects);
    return subscribeProjects(setProjects);
  }, []);

  // 确认状态是这个条目自己的事实（_entry.json.assets[]），与项目归档无关，所以按 taskKey 单独拉。
  useEffect(() => {
    let cancelled = false;
    listConfirmedAssets(taskKey)
      .then((assets) => {
        if (!cancelled) setConfirmed(assets);
      })
      .catch(() => {
        if (!cancelled) setConfirmed([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  const resources = useMemo(() => buildLibraryContents(paths), [paths]);

  /** 已被收进任一项目的产物路径——收过的文件在卡片上标出来，避免重复收集。 */
  const collectedPaths = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      for (const a of p.assets) if (a.taskKey === taskKey) set.add(a.path);
    }
    return set;
  }, [projects, taskKey]);

  const { flashed, mention } = useMention();
  const toHost = composerTarget() === "host";

  const mentionAssistant = useCallback(
    (assistantId: string) => {
      const item = findCatalogItem(assistantId);
      if (!item) return;
      const label = t(item.labelKey) === item.labelKey ? item.label : t(item.labelKey);
      mention(`assistant:${assistantId}`, () =>
        sendRoleToComposer({
          name: label,
          category: item.category,
          catalogId: item.id,
          stepId: item.stepId,
          modeId: item.modeId,
        }),
      );
    },
    [t, mention],
  );

  /** @ 按钮的即时反馈：送去哪、成没成，都只说实际发生的那一种。 */
  const mentionTitle = useCallback(
    (key: string, idle: string) => {
      if (flashed?.key !== key) return t(idle);
      if (flashed.delivery === "failed") return t("lib.copyFailed");
      return t(flashed.delivery === "host" ? "lib.mentioned" : "lib.copied");
    },
    [flashed, t],
  );

  /**
   * 确认 / 撤销确认一份产物。
   *
   * 确认是"这一份是定稿，下游生成就引用它"，与收进项目库（归档到哪个柜子）是两件事，
   * 所以这里不碰 projectVault。版本号只在确认的是历史版那张卡时给：那种情况用户要的
   * 就是钉住这一稿；折叠卡上的当前版路径本身是稳定的，跟随最新才是他要的。
   */
  const toggleConfirm = useCallback(
    async (file: LibraryFile, version?: number) => {
      const next = isConfirmed(confirmed, file.path)
        ? await unconfirmAsset(taskKey, file.path)
        : await confirmAsset(taskKey, file.path, version);
      setConfirmed(next);
    },
    [confirmed, taskKey],
  );

  const collect = useCallback(
    async (projectId: string, categoryId: string | null) => {
      const file = collectTarget;
      if (!file) return;
      await collectAsset(
        projectId,
        { taskKey, path: file.path, name: file.name, contentType: file.type },
        categoryId,
      );
      setCollectTarget(null);
    },
    [collectTarget, taskKey],
  );

  const collectIntoNewProject = useCallback(async () => {
    const file = collectTarget;
    if (!file) return;
    const title = prompt(t("vault.newProjectPrompt"));
    if (!title?.trim()) return;
    const project = await createProject(title);
    await collectAsset(
      project.id,
      { taskKey, path: file.path, name: file.name, contentType: file.type },
      null,
    );
    setCollectTarget(null);
  }, [collectTarget, t, taskKey]);

  /**
   * 类别在这一跑里的位次。
   * 席位映射到它的主步骤，主步骤在 stepOrder 里的下标即位次；这一跑没走过的（比如用户
   * 上传那一类，或老管线遗留产物）排在走过的之后，但仍保住花名册里的相对次序。
   */
  const rank = useCallback(
    (def: LibraryContents["buckets"][number]["def"]) => {
      const step = def.seatId ? seatPrimaryStep(def.seatId) : null;
      const i = step ? stepOrder.indexOf(step) : -1;
      return i >= 0 ? i : stepOrder.length + CONTENT_TYPES.findIndex((d) => d.id === def.id);
    },
    [stepOrder],
  );

  const renderCard = (entry: FileEntry, file: LibraryFile, label: string) => {
    const collected = collectedPaths.has(file.path);
    const focused = focusedFile?.taskKey === taskKey && focusedFile.path === file.path;
    const multi = entry.versions.length > 1;
    const done = isConfirmed(confirmed, file.path);
    const versionN = entry.versions.find((v) => v.file.path === file.path)?.n;
    return (
      <div
        className={`pi-card${collected ? " is-picked" : ""}${focused ? " is-focused" : ""}`}
        title={file.path}
      >
        <button
          type="button"
          className="pi-at"
          title={mentionTitle(`file:${file.path}`, toHost ? "lib.mentionFile" : "lib.copyFile")}
          aria-label={t(toHost ? "lib.mentionFile" : "lib.copyFile")}
          onClick={() =>
            mention(`file:${file.path}`, () =>
              sendFileToComposer({
                entryKey: taskKey,
                path: file.path,
                name: file.name,
                contentType: file.type ?? undefined,
              }),
            )
          }
        >
          {flashed?.key === `file:${file.path}` && flashed.delivery !== "failed" ? (
            <Check size={10} aria-hidden />
          ) : (
            <AtSign size={10} aria-hidden />
          )}
        </button>
        {/* 定位到平台系统文件区（规范里资产右键三动作的第三项）。独立形态没有
            文件区可定位，此时整个按钮不渲染，而不是渲染成一个点了没反应的死键。 */}
        {canLocateInContentBrowser() && (
          <button
            type="button"
            className="pi-at"
            title={t("lib.locateFile")}
            aria-label={t("lib.locateFile")}
            onClick={() =>
              void locateInContentBrowser({
                entryKey: taskKey,
                path: file.path,
                name: file.name,
              })
            }
          >
            <Crosshair size={10} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="pi-card__open"
          onClick={() => setFocusedFile({ taskKey, path: file.path, name: file.name })}
        >
          <FileText size={13} className="pi-card__icon" aria-hidden />
          <span className="pi-card__name">{label}</span>
        </button>
        {multi && (
          <button
            type="button"
            className={`pi-vers${openVersions === entry.name ? " is-open" : ""}`}
            title={t("task.versions", { n: entry.versions.length })}
            aria-label={t("task.versions", { n: entry.versions.length })}
            onClick={() => setOpenVersions(openVersions === entry.name ? null : entry.name)}
          >
            <History size={11} aria-hidden />
            <em>{entry.versions.length}</em>
          </button>
        )}
        {/* 确认定稿：勾了下游生成才会引用这一份，与收进项目库是两件正交的事。 */}
        <button
          type="button"
          className={`pi-star${done ? " picked" : ""}`}
          title={done ? t("asset.unconfirm") : t("asset.confirm")}
          aria-label={done ? t("asset.unconfirm") : t("asset.confirm")}
          onClick={() => void toggleConfirm(file, versionN && versionN > 0 ? versionN : undefined)}
        >
          <CheckCircle2 size={12} />
        </button>
        <button
          type="button"
          className={`pi-star${collected ? " picked" : ""}`}
          title={collected ? t("vault.collectAgain") : t("vault.collect")}
          aria-label={collected ? t("vault.collectAgain") : t("vault.collect")}
          onClick={() => setCollectTarget(file)}
        >
          <FolderPlus size={12} />
        </button>
      </div>
    );
  };

  /** 收进哪个项目：一列项目，每个项目下摊开它的类别，点哪一行就收进哪儿。 */
  const renderCollect = () => (
    <div className="tf-collect" role="dialog" aria-label={t("vault.collect")}>
      <header className="tf-collect__head">
        <span className="tf-collect__title">{t("vault.collectInto", { name: collectTarget?.name ?? "" })}</span>
        <button
          type="button"
          className="tf-collect__close"
          aria-label={t("nav.input.close")}
          onClick={() => setCollectTarget(null)}
        >
          <X size={12} aria-hidden />
        </button>
      </header>
      <div className="tf-collect__body">
        {projects.length === 0 && <p className="pi-hint">{t("vault.noProjectYet")}</p>}
        {projects.map((p) => (
          <div key={p.id} className="tf-collect__project">
            <button
              type="button"
              className="tf-collect__row"
              onClick={() => void collect(p.id, null)}
            >
              <ChevronDown size={11} aria-hidden />
              <span>{p.title}</span>
              <em>{t("vault.uncategorized")}</em>
            </button>
            {p.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className="tf-collect__row tf-collect__row--cat"
                onClick={() => void collect(p.id, c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        ))}
        <button type="button" className="tf-collect__new" onClick={() => void collectIntoNewProject()}>
          <Plus size={11} aria-hidden />
          {t("vault.newProject")}
        </button>
      </div>
    </div>
  );

  /** 键权层 M2：把 origin 翻成一句人话，接在"第 N 版"后面。没有溯源就什么都不加。 */
  const originSuffix = useCallback(
    (origin: VersionOrigin | undefined): string => {
      if (!origin) return "";
      switch (origin.kind) {
        case "manual_edit":
          return ` · ${t("task.version.origin.manualEdit")}`;
        case "restore_original":
          return ` · ${t("task.version.origin.restoreOriginal")}`;
        case "polish_seat":
          return ` · ${t("task.version.origin.polishSeat", { seat: origin.seatId ?? "" })}`;
        case "qa_repair":
          return ` · ${t("task.version.origin.qaRepair", { n: origin.findingIds?.length ?? 0 })}`;
        default:
          return "";
      }
    },
    [t],
  );

  const renderEntries = (files: LibraryFile[]) => (
    <div className="pi-cards">
      {groupVersions(files).map((entry) => {
        // 选择器紧跟在按下收藏键的那一份下面。它问的是"这一份放进哪个项目"，
        // 钉在面板底部时中间可能隔着十几行别的文件，用户得自己把问题和答案连起来。
        const owns = !!collectTarget && entry.versions.some((v) => v.file.path === collectTarget.path);
        return (
          <Fragment key={entry.file.path}>
            <div className="pi-entry">
              {renderCard(entry, entry.file, entry.name)}
              {/* 历史版按需摊开：当前版已在上面，这里只列更旧的几稿。 */}
              {openVersions === entry.name && entry.versions.length > 1 && (
                <div className="pi-history">
                  {entry.versions.slice(1).map((v) => (
                    <div key={v.file.path}>
                      {renderCard(
                        entry,
                        v.file,
                        `${t("task.version", { n: v.n })}${originSuffix(versionOrigins[v.file.path])}`,
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {owns && renderCollect()}
          </Fragment>
        );
      })}
    </div>
  );

  /** 一个环节文件夹：标题条可点，点了把这一夹收起来。 */
  const renderBucket = (id: string, label: string, files: LibraryFile[], assistantId?: string) => {
    const open = !closedBuckets.includes(id);
    return (
      <div key={id} className={`pi-bucket${open ? "" : " is-closed"}`}>
        <div className="pi-bucket__title">
          {assistantId && (
            <button
              type="button"
              className="pi-at"
              title={t("lib.mentionAssistant")}
              aria-label={t("lib.mentionAssistant")}
              onClick={() => mentionAssistant(assistantId)}
            >
              <AtSign size={10} aria-hidden />
            </button>
          )}
          <button
            type="button"
            className="pi-bucket__toggle"
            aria-expanded={open}
            title={open ? t("entry.fold") : t("entry.unfold")}
            onClick={() =>
              setClosedBuckets((prev) => (open ? [...prev, id] : prev.filter((x) => x !== id)))
            }
          >
            {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
            <span>{label}</span>
          </button>
          <em className="pi-bucket__count">{files.length}</em>
        </div>
        {open && renderEntries(files)}
      </div>
    );
  };

  const renderResources = ({ buckets, loose }: LibraryContents) => {
    // 只留这一跑真产出东西的类别：任务是一次具体的活儿，空位没有信息量。
    const filled = buckets.filter((b) => b.files.length > 0).sort((a, b) => rank(a.def) - rank(b.def));
    const total = loose.length + filled.reduce((n, b) => n + b.files.length, 0);
    // 条目底下直接就是这一跑走过的环节，不再套一层"产物"的壳：那层壳既不分组也不筛，
    // 只是把每个文件夹往里推了一格。
    return (
      <section className="pi-section">
        {total === 0 && <div className="pi-empty">{t("task.files.empty")}</div>}

        {filled.map(({ def, files }) =>
          renderBucket(def.id, t(def.labelKey), files, def.assistantId),
        )}

        {/* 归不到任何助手的（老管线产物、中间件）直挂任务下：对它们只有两级。 */}
        {loose.length > 0 && renderBucket("__loose", t("task.files.loose"), loose)}
      </section>
    );
  };

  if (loading) return <div className="history-loading">{t("tms.history.loading")}</div>;

  return (
    <div className="project-inside">
      {renderResources(resources)}
    </div>
  );
}
