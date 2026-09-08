/**
 * useSecondaryPipelineStreams — 次管线 SSE 消费（Phase-2 M8）
 *
 * 同一条目下多管线各起一个 run，各有独立 SSE。主管线仍由 useNarrativeStream 独占
 * （它驱动 phase / 取消 / auto-attach / 结果回填，语义不能多头）；次管线只需要
 * 「本轨推进到哪一步」这一件事，写进 pipelineRuns[pipelineId] 供状态栏多 lane 渲染。
 *
 * 所以这里刻意不碰 runningRunId、activeResult、phase —— 次管线跑完不改变全局态，
 * 只把自己那条 lane 标为 completed/failed。
 */
import { useEffect, useRef } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import { API_BASE } from "./useNarrativeStream";

export function useSecondaryPipelineStreams(): void {
  const pipelineRuns = useNarrativeStore((s) => s.pipelineRuns);
  const markPipelineRunStep = useNarrativeStore((s) => s.markPipelineRunStep);
  const updatePipelineRun = useNarrativeStore((s) => s.updatePipelineRun);
  const sourcesRef = useRef<Map<string, EventSource>>(new Map());

  // 依赖只取「需要连的 lane 集合」的指纹，避免 pipelineRuns 每帧变化导致重连。
  const laneKey = Object.values(pipelineRuns)
    .filter((l) => !l.primary && l.status === "running")
    .map((l) => `${l.pipelineId}:${l.runId}`)
    .sort()
    .join("|");

  useEffect(() => {
    const wanted = new Map(
      Object.values(useNarrativeStore.getState().pipelineRuns)
        .filter((l) => !l.primary && l.status === "running")
        .map((l) => [l.pipelineId, l.runId] as const),
    );

    for (const [pid, es] of sourcesRef.current) {
      if (!wanted.has(pid)) {
        es.close();
        sourcesRef.current.delete(pid);
      }
    }

    for (const [pid, runId] of wanted) {
      if (sourcesRef.current.has(pid)) continue;
      const es = new EventSource(`${API_BASE}/api/narrative/stream/${runId}`);
      sourcesRef.current.set(pid, es);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as {
            type?: string;
            status?: string;
            stepId?: string;
            error?: string;
          };
          if (data.type === "done") {
            es.close();
            sourcesRef.current.delete(pid);
            const ok = data.status === "completed";
            const lane = useNarrativeStore.getState().pipelineRuns[pid];
            updatePipelineRun(pid, {
              status: ok ? "completed" : "failed",
              runningStepId: null,
              failedStepId: ok ? null : (lane?.runningStepId ?? null),
              error: ok ? undefined : (data.error ?? "pipeline failed"),
            });
            return;
          }
          if (data.type === "streaming" || !data.stepId) return;
          if (data.status === "running" || data.status === "completed") {
            markPipelineRunStep(pid, data.stepId, data.status);
          }
        } catch {
          /* 单帧解析失败不影响本流后续帧 */
        }
      };

      es.onerror = () => {
        // SSE 自带重连；这里只在服务端已结束（流被关闭）时收手。
        if (es.readyState === EventSource.CLOSED) {
          sourcesRef.current.delete(pid);
        }
      };
    }
  }, [laneKey, markPipelineRunStep, updatePipelineRun]);

  useEffect(() => {
    const sources = sourcesRef.current;
    return () => {
      for (const es of sources.values()) es.close();
      sources.clear();
    };
  }, []);
}
