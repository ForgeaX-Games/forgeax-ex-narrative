import { useCallback, useEffect, useMemo, useState } from "react";
import { AtSign, ChevronDown, ChevronLeft, ChevronRight, FileText, Plus, Trash2, X } from "lucide-react";
import {
  addCategory,
  collectAsset,
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
import { sendFileToComposer } from "../../lib/bridge";
import { fetchRunFiles } from "../../hooks/useNarrativeStream";
import { buildLibraryContents, CONTENT_TYPES, type LibraryFile } from "../../lib/contentTypes";
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
 * 中间层不预铺。新建类别时把单品助手花名册当**选项**递过去（省得每次手打「角色档案」），
 * 也可以直接自己起名；落下来的一律是普通自建类别，能改名能删。
 * 铺满二十个空格子是任务侧不该做的事，在用户自己的柜子里更不该做。
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

  const mentionAsset = useCallback((asset: ProjectAsset) => {
    sendFileToComposer({
      entryKey: asset.taskKey,
      path: asset.path,
      name: asset.name,
      contentType: asset.contentType ?? undefined,
    });
  }, []);

  // ── 项目内部：资产管理 ──────────────────────────────────────────────────
  if (opened) {
    const categories = opened.categories;
    /** 建类别时递给用户的选项：花名册里还没被这个项目用掉的那些名字。 */
    const catOptions = CONTENT_TYPES.map((def) => t(def.labelKey)).filter(
      (name) => !categories.some((c) => c.name === name),
    );

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
              title={t("lib.mentionFile")}
              aria-label={t("lib.mentionFile")}
              onClick={() => mentionAsset(a)}
            >
              <AtSign size={10} aria-hidden />
            </button>
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
              <option value="">{t("vault.uncategorized")}</option>
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
          void collectAsset(
            opened.id,
            { taskKey, path: file.path, name: file.name, contentType: file.type },
            categoryId,
          );
          setPickInto(null);
        }}
      />
    );

    const uncategorized = opened.assets.filter((a) => {
      if (a.categoryId === null) return true;
      // 花名册改名或用户删了自建类别后，孤儿资产退回未归类而不是凭空消失。
      return !categories.some((c) => c.id === a.categoryId);
    });

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

              {/* 中间层由用户自己开：给花名册当选项，也接受自己起的名字。 */}
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
                  {catOptions.length > 0 && (
                    <>
                      <p className="pi-hint">{t("vault.categoryOptions")}</p>
                      <div className="pi-catadd__opts">
                        {catOptions.map((name) => (
                          <button
                            key={name}
                            type="button"
                            className="pi-catadd__opt"
                            onClick={() => submitCategory(name)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
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
