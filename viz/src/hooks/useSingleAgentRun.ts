/**
 * useSingleAgentRun — 单 agent 试跑 + SSE 观测（Phase-2 M9）
 *
 * 画布上的工程师节点（单步 agent）与专家节点（composite 子 DAG）都可以脱离管线单独跑。
 * 一期只有同步接口：composite 专家一跑十几分钟，UI 只能挂着一个 pending 的请求，
 * 中途状态与子步波次完全不可见。现在后端把单 agent 也做成 run + SSE，
 * 帧形状与管线 run 同构（announce → running/completed → done）。
 *
 * 这里刻意用组件本地态而不写全局 store：单 agent 试跑不是"条目的一次生成"，
 * 不该改 phase / runningRunId / activeResult，否则会污染主流程状态机。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, startSingleAgentStream } from "./useNarrativeStream";

export type AgentRunStepStatus = "pending" | "running" | "completed" | "failed";

export interface AgentRunStep {
  id: string;
  status: AgentRunStepStatus;
  message?: string;
}

export interface AgentRunState {
  status: "idle" | "running" | "completed" | "failed";
  runId: string | null;
  steps: AgentRunStep[];
  error?: string;
}

const IDLE: AgentRunState = { status: "idle", runId: null, steps: [] };

export function useSingleAgentRun(): {
  state: AgentRunState;
  start: (agentId: string, opts?: { userInput?: string; inputs?: Record<string, unknown> }) => void;
  reset: () => void;
} {
  const [state, setState] = useState<AgentRunState>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => close, [close]);

  const start = useCallback(
    (agentId: string, opts: { userInput?: string; inputs?: Record<string, unknown> } = {}) => {
      close();
      setState({ status: "running", runId: null, steps: [{ id: agentId, status: "pending" }] });
      startSingleAgentStream(agentId, opts)
        .then(({ runId }) => {
          setState((s) => ({ ...s, runId }));
          const es = new EventSource(`${API_BASE}/api/narrative/stream/${runId}`);
          sourceRef.current = es;
          es.onmessage = (event) => {
            let frame: {
              type?: string;
              status?: string;
              stepId?: string;
              steps?: string[];
              message?: string;
              error?: string;
            };
            try {
              frame = JSON.parse(event.data);
            } catch {
              return;
            }
            if (frame.type === "pipeline_steps_announce" && frame.steps?.length) {
              const announced = frame.steps;
              setState((s) => ({
                ...s,
                steps: announced.map((id) => ({ id, status: "pending" as const })),
              }));
              return;
            }
            if (frame.type === "done") {
              close();
              setState((s) => ({
                ...s,
                status: frame.status === "completed" ? "completed" : "failed",
                error: frame.status === "completed" ? undefined : (frame.error ?? "agent run failed"),
              }));
              return;
            }
            if (frame.type === "streaming" || !frame.stepId) return;
            const stepId = frame.stepId;
            const status = frame.status as AgentRunStepStatus | undefined;
            if (status !== "running" && status !== "completed" && status !== "failed") return;
            setState((s) => {
              const steps = s.steps.some((x) => x.id === stepId)
                ? s.steps.map((x) => (x.id === stepId ? { ...x, status, message: frame.message } : x))
                : [...s.steps, { id: stepId, status, message: frame.message }];
              return { ...s, steps };
            });
          };
          es.onerror = () => {
            if (es.readyState === EventSource.CLOSED) sourceRef.current = null;
          };
        })
        .catch((err: unknown) => {
          setState({
            status: "failed",
            runId: null,
            steps: [],
            error: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [close],
  );

  const reset = useCallback(() => {
    close();
    setState(IDLE);
  }, [close]);

  return { state, start, reset };
}
