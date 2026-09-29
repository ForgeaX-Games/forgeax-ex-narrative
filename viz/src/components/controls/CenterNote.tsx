import { useEffect, useState } from "react";
import { useNarrativeStore, useNarrativePhase } from "../../store/narrativeStore";
import { RUN_STATE_LABEL, resolveRunState } from "../../store/runState";
import { listProjects, subscribeProjects, type NarrativeProject } from "../../lib/projectVault";
import { useT } from "../../i18n";

/**
 * 创作空间的第四层注释——与左栏那一行同一职责：说清"眼下看的是哪一份、多大、什么状态"。
 *
 * 它是全界面唯一一处运行状态：原先第一层、左栏第二层、右栏第二层各挂一个状态灯，
 * 同一件事说三遍，现在只留这里。所以每一条分支都得带上状态，不能有哪种视图下它消失。
 *
 * 左栏选的是哪一块，这里答的就是哪一块的问题：
 *  - 项目管理：柜子里有多少份文件；这一块只有文本一种模式，节点视图对它没有意义。
 *  - 任务管理的文本模式关心内容，就报选中那一份产物的名字；没选中则说明铺的是整跑。
 *  - 任务管理的节点模式关心结构，就报管线的规模：编排态数节点与管线条数，
 *    跑起来之后数步骤与完成数。
 */
export function CenterNote() {
  const t = useT();
  const viewMode = useNarrativeStore((s) => s.viewMode);
  const leftSection = useNarrativeStore((s) => s.leftSection);
  const openedProjectId = useNarrativeStore((s) => s.openedProjectId);
  const focusedFile = useNarrativeStore((s) => s.focusedFile);
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  // 订阅连线：管线条数随连线变化，注释要跟着刷新。
  useNarrativeStore((s) => s.composerEdges);
  const getAnchoredPipelines = useNarrativeStore((s) => s.getAnchoredPipelines);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeCanResume = useNarrativeStore((s) => s.activeCanResume);
  const ipDnaGenerating = useNarrativeStore((s) => s.ipDnaGenerating);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const phase = useNarrativePhase();

  // 项目标题与文件数只在本地库里；左栏不在项目管理时不订阅，省掉无谓的请求。
  const [projects, setProjects] = useState<NarrativeProject[]>([]);
  useEffect(() => {
    if (leftSection !== "projects") return;
    void listProjects().then(setProjects);
    return subscribeProjects(setProjects);
  }, [leftSection]);

  // 状态字样取自运行状态机那一份派生，"已暂停（可续跑）"与"已中断（需重开）"因此分得开。
  const runState = resolveRunState({
    activeEntryStatus,
    activeCanResume,
    generating: !!runningRunId || ipDnaGenerating,
    hasDrafts: false,
    pendingFork: false,
  });
  const status = runState === "pending" ? t("app.status.standby") : t(RUN_STATE_LABEL[runState]);
  const note = (body: string) => <span className="cw-note">{`${body} · ${status}`}</span>;

  if (leftSection === "projects") {
    const project = projects.find((p) => p.id === openedProjectId);
    return note(
      project
        ? t("cw.note.project", { name: project.title, n: project.assets.length })
        : t("cw.note.projectNone"),
    );
  }

  if (viewMode === "text") {
    return note(
      focusedFile ? t("cw.note.selected", { name: focusedFile.name }) : t("cw.note.selectNone"),
    );
  }

  // 编排态（未生成）：画布上摆了什么就报什么。
  if (phase === "idle") {
    return note(
      composerNodes.length === 0
        ? t("cw.note.composeEmpty")
        : t("cw.note.compose", {
            n: composerNodes.length,
            pipes: getAnchoredPipelines().length,
          }),
    );
  }

  return note(
    t("cw.note.run", {
      n: activeSteps.length,
      done: activeSteps.filter((s) => s.status === "completed").length,
    }),
  );
}
