import { useEffect, useState } from "react";
import { FolderOpen, ListChecks } from "lucide-react";
import { TaskPanel } from "./TaskPanel";
import { ProjectVault } from "./ProjectVault";
import { useNarrativeStore, type LeftSection } from "../../store/narrativeStore";
import { listProjects, subscribeProjects, type NarrativeProject } from "../../lib/projectVault";
import { useNarrativeRuntime } from "../runtime/NarrativeRuntimeProvider";
import { describeEntryStatus } from "../../lib/entryStatusLabel";
import { useT } from "../../i18n";

/**
 * 左栏「创作档案」：最左一条竖图标条切换任务管理与项目管理，右边是当前那一块的内容。
 *
 * 分家的理由——任务是系统的账（一次对话开启的生成，产物按助手花名册自动归类，用户改不了），
 * 项目是用户的柜子（自建标题、标签、类别，条目可以从多个任务里挑）。
 * 以前两者挤在一个「项目」概念里，于是资产只能是某一跑资源的子集，跨任务收集无从谈起。
 *
 * 切换器是竖条而不是两个并列按钮，理由不是省地方，是这两块**互斥**：一次只看得见一块。
 * 竖条一次只点亮一枚，形状本身就说了"二选一"；并列按钮读起来像"两样都能开"，那是
 * 右栏三族工具的语义（它们不冲突，可以同时往画布上放）。于是第三层左边只放一句
 * 当前分区名，回答"我在哪一块"，动作归竖条。
 *
 * 四层标题与右栏逐层对齐：第一层插件名「叙事工坊」、第二层区域名（在 App 的 pane
 * header 里）、第三层这句分区名、第四层注释。第四层没选中条目时说这一块是干什么的，
 * 选中之后让位给路径与状态——那时用户要的是「我在看哪一份」，不是概览。
 */
export function LeftPane() {
  const t = useT();
  const section = useNarrativeStore((s) => s.leftSection);
  const setSection = useNarrativeStore((s) => s.setLeftSection);
  const openedTaskKey = useNarrativeStore((s) => s.openedTaskKey);
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const openedProjectId = useNarrativeStore((s) => s.openedProjectId);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  // 三层信息架构的第三层要报"条目数量"，任务列表本身只在 owner 侧的 runtime 里
  // （wb 为 null 时是非 owner 分栏，退化为不报数量，不影响路径/选中态那部分）。
  const wb = useNarrativeRuntime();
  const displayHistory = wb?.displayHistory ?? [];

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
  const itemCount = section === "tasks" ? displayHistory.length : projects.length;

  // 第四层：从当前这一块往下拼到最深那一级；
  // 选中的是任务时再补一段该任务的状态（未开始/运行中/已完成/中断/失败等，
  // 复用 TaskPanel 徽标同一套措辞，见 lib/entryStatusLabel.ts）——项目没有这套
  // 运行态，不硬凑一个假状态。
  const crumbs: string[] = [];
  let statusSuffix: string | null = null;
  if (section === "tasks") {
    const key = openedTaskKey ?? activeEntryKey;
    if (key) {
      crumbs.push(t("left.tasks"), key);
      if (focusedFile?.taskKey === key) crumbs.push(focusedFile.name);
      const entry = displayHistory.find((e) => e.key === key);
      if (entry) statusSuffix = describeEntryStatus(entry, t);
    }
  } else if (openedProjectId) {
    const title = projects.find((p) => p.id === openedProjectId)?.title;
    crumbs.push(t("left.projects"), title ?? openedProjectId);
  }
  // 什么都没选中时，这一行的位置用来交代这一块是干什么的、第一次来该做什么——
  // 原先只写一句"未选中任何条目"，把最容易需要指引的那一刻浪费掉了。
  const overview = t(
    itemCount === 0 ? `left.note.${section}.empty` : `left.note.${section}`,
    { n: itemCount },
  );
  const annotation = crumbs.length > 0
    ? [crumbs.join(" / "), statusSuffix].filter(Boolean).join(" · ")
    : overview;

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
        {/* 第三层：只报当前这一块的名字，切换动作在左边那条竖条上。 */}
        <div className="left-pane__section">{sectionLabel}</div>
        {/* 路径挤不下时压缩的是中间几段，最深那一级必须完整——那才是"我在看什么"的答案。 */}
        <div className="left-pane__path" title={annotation}>
          {crumbs.length > 0 ? (
            <>
              {crumbs.map((c, i) => (
                <span
                  key={`${c}-${i}`}
                  className={`left-pane__crumb${i === crumbs.length - 1 ? " is-leaf" : ""}`}
                >
                  {i > 0 && <em className="left-pane__sep">/</em>}
                  {c}
                </span>
              ))}
              {statusSuffix && <span className="left-pane__annotation">{` · ${statusSuffix}`}</span>}
            </>
          ) : (
            <span className="left-pane__annotation is-overview">{overview}</span>
          )}
        </div>
        <div className="left-pane__body">
          {section === "tasks" ? <TaskPanel /> : <ProjectVault />}
        </div>
      </div>
    </div>
  );
}
