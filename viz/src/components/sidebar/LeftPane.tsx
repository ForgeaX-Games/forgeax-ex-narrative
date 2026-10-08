import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, ListChecks } from "lucide-react";
import { TaskPanel } from "./TaskPanel";
import { ProjectVault } from "./ProjectVault";
import { useNarrativeStore, type LeftSection } from "../../store/narrativeStore";
import { listProjects, subscribeProjects, type NarrativeProject } from "../../lib/projectVault";
import { useNarrativeRuntime } from "../runtime/NarrativeRuntimeProvider";
import { describeEntryStatus } from "../../lib/entryStatusLabel";
import { useT } from "../../i18n";

/**
 * 左栏「创作档案」：任务库与项目库**并列**，上下两栏同时可见。
 *
 * 分家的理由——任务是系统的账（一次对话开启的生成，产物按助手花名册自动归类，用户改不了），
 * 项目是用户的柜子（自建标题、标签、类别，条目可以从多个任务里挑）。
 * 以前两者挤在一个「项目」概念里，于是资产只能是某一跑资源的子集，跨任务收集无从谈起。
 *
 * ## 为什么从竖条二选一改成并列
 *
 * 此前是一条竖图标条切换，论据是"这两块互斥，一次只看得见一块"。那个论据站不住：
 * 双库之间最要紧的动作是**把任务里的产物归档进项目**——那是一个从左边挑、放到右边的
 * 动作，两边同时看得见才做得动。互斥恰好挡住了这两块存在的理由。
 *
 * 并列不是平分：拿着焦点的那一栏占大头，另一栏留出足够看清列表的高度。两栏都能折起来，
 * 折叠是用户临时要地方，不是在两者之间做选择——折完另一栏自动吃掉空出来的高度。
 *
 * 四层标题与右栏逐层对齐：第一层插件名「叙事工坊」、第二层区域名（在 App 的 pane
 * header 里）、第三层各库自己的分区头、第四层注释。第四层没选中条目时说当前焦点那一库
 * 是干什么的，选中之后让位给路径与状态——那时用户要的是「我在看哪一份」，不是概览。
 */
export function LeftPane() {
  const t = useT();
  /**
   * `leftSection` 的语义随并列一起变了：从"在看哪一块"变成"焦点在哪一块"。
   * 两块现在都看得见，所以它只决定谁占大头、以及第四层路径行报谁——中间栏的注释
   * （CenterNote）读的也是这一个意思。
   */
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

  // 项目标题在本地库里，分区头的计数与路径行都要它。两栏同时在场，所以无条件订阅
  // ——从前只在"看项目那一块"时订阅，现在项目库一直看得见，不订阅就一直是 0。
  const [projects, setProjects] = useState<NarrativeProject[]>([]);
  useEffect(() => {
    void listProjects().then(setProjects);
    return subscribeProjects(setProjects);
  }, []);

  /** 折起来的库。折叠是临时腾地方，所以默认全开，也不记进 store。 */
  const [collapsed, setCollapsed] = useState<Record<LeftSection, boolean>>({
    tasks: false,
    projects: false,
  });

  const counts: Record<LeftSection, number> = {
    tasks: displayHistory.length,
    projects: projects.length,
  };

  // 第四层：从当前焦点那一库往下拼到最深那一级；
  // 焦点在任务时再补一段该任务的状态（未开始/运行中/已完成/中断/失败等，
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
    counts[section] === 0 ? `left.note.${section}.empty` : `left.note.${section}`,
    { n: counts[section] },
  );
  const annotation = crumbs.length > 0
    ? [crumbs.join(" / "), statusSuffix].filter(Boolean).join(" · ")
    : overview;

  const shelves: { id: LeftSection; label: string; Icon: typeof ListChecks }[] = [
    { id: "tasks", label: t("left.tasks"), Icon: ListChecks },
    { id: "projects", label: t("left.projects"), Icon: FolderOpen },
  ];

  return (
    <div className="left-pane">
      {/* 第四层：路径行在两栏之上，它报的是当前焦点，不属于任何一栏。 */}
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
      <div className="left-pane__shelves">
        {shelves.map(({ id, label, Icon }) => {
          const isCollapsed = collapsed[id];
          const hasFocus = section === id;
          return (
            <section
              key={id}
              className={`left-shelf${hasFocus ? " has-focus" : ""}${isCollapsed ? " is-collapsed" : ""}`}
            >
              {/* 第三层：各库自己的分区头。点标题取焦点（决定谁占大头），点箭头折叠。 */}
              <div className="left-shelf__head">
                <button
                  type="button"
                  className="left-shelf__title"
                  aria-pressed={hasFocus}
                  onClick={() => setSection(id)}
                >
                  <Icon size={14} aria-hidden />
                  <span>{label}</span>
                  <em className="left-shelf__count">{counts[id]}</em>
                </button>
                <button
                  type="button"
                  className="left-shelf__fold"
                  aria-expanded={!isCollapsed}
                  aria-label={label}
                  title={label}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
                >
                  {isCollapsed ? <ChevronRight size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                </button>
              </div>
              {!isCollapsed && (
                <div className="left-shelf__body">
                  {id === "tasks" ? <TaskPanel /> : <ProjectVault />}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
