import { describe, it, expect } from "vitest";
import { deriveDeterministicSceneNumbers, type StagedScene } from "../graph/scene-numbering.js";
import { applyDeterministicSceneNumbers } from "../steps/script-generation.js";
import type { ScriptChapter } from "../../types/index.js";

describe("deriveDeterministicSceneNumbers（C1 吸收：三维 staging → 确定性场号）", () => {
  it("相邻场景三维全同则同场号", () => {
    const scenes: StagedScene[] = [
      { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" },
      { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" },
    ];
    expect(deriveDeterministicSceneNumbers(scenes)).toEqual(["1", "1"]);
  });

  it("任一维变化则场号+1", () => {
    const scenes: StagedScene[] = [
      { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" },
      { location: "王宫大殿", time_of_day: "夜", indoor_outdoor: "内" }, // 仅 time_of_day 变
      { location: "城墙", time_of_day: "夜", indoor_outdoor: "外" },
    ];
    expect(deriveDeterministicSceneNumbers(scenes)).toEqual(["1", "2", "3"]);
  });

  it("不复用铁律：回到早先三维状态全同的场景仍取新场号，不回退复用旧号", () => {
    const scenes: StagedScene[] = [
      { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" }, // 1
      { location: "城墙", time_of_day: "日", indoor_outdoor: "外" }, // 2
      { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" }, // 回到场1的三维状态 → 仍是新场号 3，不是 1
    ];
    expect(deriveDeterministicSceneNumbers(scenes)).toEqual(["1", "2", "3"]);
  });

  it("未标注三维状态时退化为只按 location 分组，仍确定性、仍不复用", () => {
    const scenes: StagedScene[] = [
      { location: "森林" },
      { location: "森林" },
      { location: "村庄" },
      { location: "森林" }, // 回到森林，中间隔着村庄 → 新场号
    ];
    expect(deriveDeterministicSceneNumbers(scenes)).toEqual(["1", "1", "2", "3"]);
  });

  it("空输入返回空数组", () => {
    expect(deriveDeterministicSceneNumbers([])).toEqual([]);
  });

  it("同一序列重复调用结果逐字相同（可复现是硬要求）", () => {
    const scenes: StagedScene[] = [
      { location: "A", time_of_day: "日", indoor_outdoor: "内" },
      { location: "B", time_of_day: "夜", indoor_outdoor: "外" },
      { location: "A", time_of_day: "日", indoor_outdoor: "内" },
    ];
    expect(deriveDeterministicSceneNumbers(scenes)).toEqual(deriveDeterministicSceneNumbers(scenes));
  });
});

function chapter(id: string, scenes: Array<Partial<ScriptChapter["scenes"][number]>>): ScriptChapter {
  return {
    chapter_id: id,
    node_id: id,
    plot_node_id: id,
    chapter_type: "rising",
    title: id,
    conflict: { type: "", tension_level: 5, stakes: "", turning_point: "" },
    character_arcs: [],
    scenes: scenes.map((s, i) => ({
      scene_id: s.scene_id ?? `placeholder-${i}`,
      location: s.location ?? "",
      time_of_day: s.time_of_day,
      indoor_outdoor: s.indoor_outdoor,
      atmosphere: "",
      camera_direction: "",
      bgm: "",
      content: [],
    })),
    prev_node: [],
    next_node: [],
    narrative_stage: "",
  };
}

describe("applyDeterministicSceneNumbers（跨章节全局收尾）", () => {
  it("按章节顺序展平后统一编号，跨章节场号全局唯一且不复用", () => {
    const chapters: ScriptChapter[] = [
      chapter("c1", [
        { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" },
        { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" }, // 同场
      ]),
      chapter("c2", [
        { location: "城墙", time_of_day: "夜", indoor_outdoor: "外" }, // 新场
        { location: "王宫大殿", time_of_day: "日", indoor_outdoor: "内" }, // 回到 c1 的状态，仍新场号
      ]),
    ];
    applyDeterministicSceneNumbers(chapters);
    expect(chapters[0]!.scenes.map((s) => s.scene_id)).toEqual(["1", "1"]);
    expect(chapters[1]!.scenes.map((s) => s.scene_id)).toEqual(["2", "3"]);
  });

  it("模型给的 scene_id 一律被覆盖（跨章节唯一性不能靠模型自己保证）", () => {
    const chapters: ScriptChapter[] = [
      chapter("c1", [{ scene_id: "s1", location: "A" }]),
      chapter("c2", [{ scene_id: "s1", location: "B" }]), // 模型两章都给了 "s1"
    ];
    applyDeterministicSceneNumbers(chapters);
    expect(chapters[0]!.scenes[0]!.scene_id).not.toBe(chapters[1]!.scenes[0]!.scene_id);
  });
});
