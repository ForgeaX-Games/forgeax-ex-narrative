/**
 * scene-export-vn.test.ts —— 场/情节点解耦（§4.6c）确定性场号导出单测
 * ─────────────────────────────────────────────────────────────────
 * 验证 exportScenesAndRenumber：把拓扑序 id 的纯情节点 DAG 按 DFS 序 + 三维相邻变化
 * 编场号、重写 id 与所有边引用为 `场.序`、派生 scenes（含 location_id）。
 *
 * 封存（C1，2026-08）：随 vn_branched_beats 一并搬进 `_archive/vn-v2/`——这里验证的
 * 是分支 DAG（pivot/branch_origin_beat）专属的编号算法，与通用架构下线性章节的
 * 确定性场号（见 `../../scene-numbering.ts` 及其 `__tests__/scene-numbering.test.ts`，
 * 由本文件同一批"三维相邻变化即换场"的思路吸收而来）是两套不同的数据形状，
 * 不能合并只能分别封存/新建。仅保留代码供查证历史算法用，不再随主测试套件跑。
 */
import { describe, it, expect } from "vitest";
import { exportScenesAndRenumber } from "../vn-branched-beats.js";
import type { VnBranchedBeats, VnBranchedBeat } from "../../../../types/index.js";

function beat(partial: Partial<VnBranchedBeat> & { beat_id: string }): VnBranchedBeat {
  return {
    scene_id: "",
    content: partial.beat_id,
    prev_nodes: [],
    next_nodes: [],
    is_main_line: true,
    is_ending: false,
    location_name: "地点A",
    time_of_day: "日",
    indoor_outdoor: "内",
    ...partial,
  } as VnBranchedBeat;
}

describe("exportScenesAndRenumber", () => {
  it("线性同三维 → 单场，序号 1..N；id 全部重写为 场.序", () => {
    const result: VnBranchedBeats = {
      acts: [],
      scenes: [],
      endings: [{ ending_id: "END_H1", label: "H", title: "好结局", content: "" }],
      beats: [
        beat({ beat_id: "b1", act_id: "一", next_nodes: [{ to: "b2", kind: "linear" }] }),
        beat({ beat_id: "b2", act_id: "一", prev_nodes: ["b1"], next_nodes: [{ to: "b3", kind: "linear" }] }),
        beat({ beat_id: "b3", act_id: "一", prev_nodes: ["b2"], next_nodes: [{ to: "END_H1", kind: "linear" }] }),
      ],
    };
    exportScenesAndRenumber(result);
    expect(result.beats.map((b) => b.beat_id)).toEqual(["1.1", "1.2", "1.3"]);
    // 边引用同步重写，ending 引用保持不变
    expect(result.beats[0].next_nodes[0].to).toBe("1.2");
    expect(result.beats[2].next_nodes[0].to).toBe("END_H1");
    expect(result.beats[1].prev_nodes).toEqual(["1.1"]);
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ scene_id: "1", act_id: "一", location_id: "loc-1" });
  });

  it("三维变化处切新场；离开后回到同名地点取新场号（不复用）", () => {
    const result: VnBranchedBeats = {
      acts: [],
      scenes: [],
      endings: [{ ending_id: "END_O1", label: "O", title: "开放", content: "" }],
      beats: [
        beat({ beat_id: "b1", location_name: "客栈", time_of_day: "日", indoor_outdoor: "内", next_nodes: [{ to: "b2", kind: "linear" }] }),
        // 地点变 → 新场
        beat({ beat_id: "b2", location_name: "山道", time_of_day: "日", indoor_outdoor: "外", prev_nodes: ["b1"], next_nodes: [{ to: "b3", kind: "linear" }] }),
        // 回到客栈（同名但离开后回归）→ 又一个新场
        beat({ beat_id: "b3", location_name: "客栈", time_of_day: "日", indoor_outdoor: "内", prev_nodes: ["b2"], next_nodes: [{ to: "END_O1", kind: "linear" }] }),
      ],
    };
    exportScenesAndRenumber(result);
    expect(result.beats.map((b) => b.beat_id)).toEqual(["1.1", "2.1", "3.1"]);
    expect(result.scenes.map((s) => s.scene_id)).toEqual(["1", "2", "3"]);
    // 同名地点 loc-id 复用（资产复用由 location_name 承担，与场号无关）
    const loc1 = result.scenes.find((s) => s.scene_id === "1")!.location_id;
    const loc3 = result.scenes.find((s) => s.scene_id === "3")!.location_id;
    expect(loc1).toBe(loc3);
  });

  it("分支：pivot 各选项走不同三维 → 各自新场，边引用全部重写", () => {
    const result: VnBranchedBeats = {
      acts: [],
      scenes: [],
      endings: [
        { ending_id: "END_H1", label: "H", title: "H", content: "" },
        { ending_id: "END_B1", label: "B", title: "B", content: "" },
        { ending_id: "END_O1", label: "O", title: "O", content: "" },
      ],
      beats: [
        beat({
          beat_id: "b1", location_name: "广场", pivot_kind: "choice",
          next_nodes: [
            { to: "b2", kind: "choice", label: "A" },
            { to: "b3", kind: "choice", label: "B" },
          ],
        }),
        beat({ beat_id: "b2", location_name: "密林", prev_nodes: ["b1"], branch_origin_beat: "b1", is_main_line: false, next_nodes: [{ to: "END_H1", kind: "linear" }] }),
        beat({ beat_id: "b3", location_name: "地牢", prev_nodes: ["b1"], branch_origin_beat: "b1", is_main_line: false, next_nodes: [{ to: "END_B1", kind: "linear" }] }),
      ],
    };
    exportScenesAndRenumber(result);
    const ids = new Set(result.beats.map((b) => b.beat_id));
    // 全部 场.序 格式且唯一
    expect([...ids].every((id) => /^\d+\.\d+$/.test(id))).toBe(true);
    expect(ids.size).toBe(3);
    // branch_origin_beat 同步重写为 场.序（指向 b1 的新 id）
    const root = result.beats.find((b) => b.prev_nodes.length === 0)!;
    const branchChild = result.beats.find((b) => b.branch_origin_beat);
    expect(branchChild!.branch_origin_beat).toBe(root.beat_id);
    // pivot 的两个选项目标都被重写到存活 beat
    expect(root.next_nodes.every((e) => ids.has(e.to))).toBe(true);
  });
});
