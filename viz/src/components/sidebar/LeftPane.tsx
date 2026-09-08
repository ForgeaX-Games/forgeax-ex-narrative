import { useEffect, useState } from "react";
import { FolderOpen, ListChecks } from "lucide-react";
import { TaskPanel } from "./TaskPanel";
import { ProjectVault } from "./ProjectVault";
import { useNarrativeStore, type LeftSection } from "../../store/narrativeStore";
import { listProjects, subscribeProjects, type NarrativeProject } from "../../lib/projectVault";
import { useT } from "../../i18n";

/**
 * 左栏：最左一条竖图标条切换任务管理与项目管理，右边是当前那一块的内容。
 *
 * 分家的理由——任务是系统的账（一次对话开启的生成，产物按助手花名册自动归类，用户改不了），
 * 项目是用户的柜子（自建标题、标签、类别，条目可以从多个任务里挑）。
 * 以前两者挤在一个「项目」概念里，于是资产只能是某一跑资源的子集，跨任务收集无从谈起。
 *
 * 切换器做成竖条纯图标而非横向标签页：左栏本来就窄，横标签一占就是一整行，
 * 而竖条只吃掉最左那一列，正文宽度基本不损失。
 *
 * 标题分三级，与右栏一一对应：顶层「叙事工坊」（在 App 的 pane header 里），
 * 第二层是当前这一块的名字，第三层是选中条目的路径注释——用户在三级树里越钻越深，
 * 光看正文很容易忘了自己身处哪一层，路径行就是那根线。
 */
export function LeftPane() {
  const t = useT();
  const section = useNarrativeStore((s) => s.leftSection);
  const setSection = useNarrativeStore((s) => s.setLeftSection);
  const openedTaskKey = useNarrativeStore((s) => s.openedTaskKey);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const openedProjectId = useNarrativeStore((s) => s.openedProjectId);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);

  // 项目标题只在本地库里，路径行要显示它就得订阅一份（列表本身很短，代价可忽略）。
  const [projects, setProjects] = useState<NarrativeProject[]>([]);
  useEffect(() => {
    if (section !== "projects") return;
    void listProjects().then(setProjects);
    return subscribeProjects(setProjects);
  }, [section]);

  const rail: { id: LeftSection; label: string; Icon: typeof ListChecks }[] = [
    { id: "tasks", label: t("left.tasks"), Icon: ListChecks },
    { id: "projects", label: t("left.projects"), Icon: FolderOpen },
  ];

  const sectionLabel = section === "tasks" ? t("left.tasks") : t("left.projects");

  // 第三层：从当前这一块往下拼到最深那一级，没选中就明说没选中。
  const crumbs: string[] = [];
  if (section === "tasks") {
    const key = openedTaskKey ?? activeEntryKey;
    if (key) {
      crumbs.push(t("left.path.tasks"), key);
      if (focusedFile?.taskKey === key) crumbs.push(focusedFile.name);
    }
  } else if (openedProjectId) {
    const title = projects.find((p) => p.id === openedProjectId)?.title;
    crumbs.push(t("left.path.projects"), title ?? openedProjectId);
  }
  const path = crumbs.length > 0 ? crumbs.join(" / ") : t("left.path.none");

  return (
    <div className="left-pane">
      <nav className="left-rail" role="tablist" aria-label={t("left.aria")}>
        {rail.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            aria-label={label}
            title={label}
            className={`left-rail__btn${section === id ? " is-active" : ""}`}
            onClick={() => setSection(id)}
          >
            <Icon size={16} aria-hidden />
          </button>
        ))}
      </nav>
      <div className="left-pane__main">
        <div className="left-pane__section">{sectionLabel}</div>
        {/* 路径挤不下时压缩的是中间几段，最深那一级必须完整——那才是"我在看什么"的答案。 */}
        <div className="left-pane__path" title={path}>
          {crumbs.length > 0 ? (
            crumbs.map((c, i) => (
              <span
                key={`${c}-${i}`}
                className={`left-pane__crumb${i === crumbs.length - 1 ? " is-leaf" : ""}`}
              >
                {i > 0 && <em className="left-pane__sep">/</em>}
                {c}
              </span>
            ))
          ) : (
            <span className="left-pane__crumb is-leaf">{path}</span>
          )}
        </div>
        <div className="left-pane__body">
          {section === "tasks" ? <TaskPanel /> : <ProjectVault />}
        </div>
      </div>
    </div>
  );
}
