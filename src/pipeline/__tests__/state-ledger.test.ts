/**
 * 状态账本折叠：从"每个节点改了什么"到"走到这里时世界什么样"。
 *
 * 这里盯三件事，都是它作为**账本**必须成立的性质：
 *   1. 按路径累积 —— 旁支上的事在玩家的故事里没发生；
 *   2. 折叠次序由图决定，不由数组顺序决定 —— 同一棵树每次折出同一份快照；
 *   3. 漏填与"确实无变更"分得开 —— 这是补全机制唯一的依据。
 */
import { describe, expect, it } from "vitest";
import {
  buildBaselineCharacters,
  buildBaselineItems,
  collectDeltas,
  computeWorldSnapshot,
  detectMissingDeltas,
  plotsToLedgerNodes,
  renderWorldSnapshot,
  validateStateConsistency,
  type LedgerNode,
} from "../graph/state-ledger.js";
import type {
  CharacterSheet,
  GameItem,
  PlotNode,
  StateChange,
  WorldStateLedger,
} from "../../types/index.js";

function ledger(deltas: WorldStateLedger["deltas"]): WorldStateLedger {
  return {
    baseline: {
      spacetime: { time: "元年", location: "村口" },
      characters: [
        {
          name: "阿零",
          psychology: { personality: "沉默", persona_base: "铁匠之子" },
          physical: { body: "少年", attire: "粗布" },
          power_level: "初始",
          relationships: [],
        },
      ],
      items: [
        { name: "断剑", location: "祠堂", acquired: false, durability: "permanent", condition: "锈蚀" },
      ],
      world_state: "旧王已死",
      plot_state: "序章",
    },
    deltas,
  };
}

function change(over: Partial<StateChange>): StateChange {
  return { dimension: "character", subject: "阿零", attribute: "power_level", to: "入门", ...over };
}

describe("状态账本：按路径累积", () => {
  // A → B → D、A → C → D：两条来路，D 是汇聚点
  const nodes: LedgerNode[] = [
    { id: "A", prevIds: [] },
    { id: "B", prevIds: ["A"] },
    { id: "C", prevIds: ["A"] },
    { id: "D", prevIds: ["B", "C"] },
  ];

  it("只应用目标节点这条来路上的变更，旁支不算", () => {
    const snap = computeWorldSnapshot(
      ledger([
        { beat_id: "B", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "入门" })] },
        { beat_id: "C", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "走岔" })] },
      ]),
      "B",
      nodes,
    );
    expect(snap.characters[0].power_level).toBe("入门");
  });

  it("汇聚点看得见两条来路的变更", () => {
    const snap = computeWorldSnapshot(
      ledger([
        {
          beat_id: "B",
          spacetime: { time: "未指定", location: "未指定" },
          changes: [change({ attribute: "physical.attire", to: "皮甲" })],
        },
        {
          beat_id: "C",
          spacetime: { time: "未指定", location: "未指定" },
          changes: [change({ dimension: "item", subject: "断剑", attribute: "acquired", to: "是" })],
        },
      ]),
      "D",
      nodes,
    );
    expect(snap.characters[0].physical.attire).toBe("皮甲");
    expect(snap.items[0].acquired).toBe(true);
  });

  it("没走到的节点的变更不影响开场快照", () => {
    const snap = computeWorldSnapshot(
      ledger([
        { beat_id: "D", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "宗师" })] },
      ]),
      "A",
      nodes,
    );
    expect(snap.characters[0].power_level).toBe("初始");
  });
});

describe("状态账本：折叠次序由图决定", () => {
  /**
   * 这一组是搬迁时改掉的那个缺陷。归档版按 deltas 数组下标顺序应用——影游 beats 单批
   * 生成，数组碰巧就是拓扑序；L3 情节分批并发生成后合并，数组顺序由批次返回次序决定。
   * 于是同一棵树跑两遍可能折出不同的快照，而账本的全部价值就在于它是确定的。
   */
  const chain: LedgerNode[] = [
    { id: "n1", prevIds: [] },
    { id: "n2", prevIds: ["n1"] },
    { id: "n3", prevIds: ["n2"] },
  ];
  const deltas: WorldStateLedger["deltas"] = [
    { beat_id: "n3", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "宗师" })] },
    { beat_id: "n1", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "入门" })] },
    { beat_id: "n2", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "小成" })] },
  ];

  it("deltas 数组乱序时，快照仍按图的上下游折", () => {
    expect(computeWorldSnapshot(ledger(deltas), "n3", chain).characters[0].power_level).toBe("宗师");
  });

  it("数组顺序换了，同一个目标折出同一份快照", () => {
    const a = computeWorldSnapshot(ledger(deltas), "n3", chain);
    const b = computeWorldSnapshot(ledger([...deltas].reverse()), "n3", chain);
    expect(b).toEqual(a);
  });

  it("汇聚点排在两条来路之后（长短不一的来路也是）", () => {
    // A → B → C → D 与 A → D：D 的深度要取最长那条，否则 B/C 会排到 D 后面
    const nodes: LedgerNode[] = [
      { id: "A", prevIds: [] },
      { id: "B", prevIds: ["A"] },
      { id: "C", prevIds: ["B"] },
      { id: "D", prevIds: ["C", "A"] },
    ];
    const snap = computeWorldSnapshot(
      ledger([
        { beat_id: "C", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ dimension: "plot", subject: "主线", attribute: "stage", to: "中段" })] },
        { beat_id: "D", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ dimension: "plot", subject: "主线", attribute: "stage", to: "收束" })] },
      ]),
      "D",
      nodes,
    );
    expect(snap.plot_progress).toBe("收束");
  });
});

describe("状态账本：时空坐标", () => {
  const nodes: LedgerNode[] = [
    { id: "A", prevIds: [], spacetime: { time: "元年春", location: "村口" } },
    { id: "B", prevIds: ["A"] },
    { id: "C", prevIds: ["B"], spacetime: { time: "元年夏", location: "未指定" } },
  ];
  const deltas = collectDeltas(nodes);

  it("没声明时空的节点沿用上游坐标，不把地点抹成未指定", () => {
    const snap = computeWorldSnapshot(ledger(deltas), "B", nodes);
    expect(snap.spacetime).toEqual({ time: "元年春", location: "村口" });
  });

  it("只声明了一半的节点，另一半仍沿用上游", () => {
    const snap = computeWorldSnapshot(ledger(deltas), "C", nodes);
    expect(snap.spacetime).toEqual({ time: "元年夏", location: "村口" });
  });
});

describe("状态账本：漏填与无变更分得开", () => {
  const body = "一段有实质内容的情节正文，长度足够。";

  it("声明了空数组的节点是已填，不送补全", () => {
    expect(detectMissingDeltas([{ id: "A", content: body, changes: [] }])).toEqual([]);
  });

  it("缺字段的节点才送补全", () => {
    expect(detectMissingDeltas([{ id: "A", content: body }]).map((n) => n.id)).toEqual(["A"]);
  });

  it("正文过短的节点不送补全（占位与纯过场不值一次调用）", () => {
    expect(detectMissingDeltas([{ id: "A", content: "略" }])).toEqual([]);
  });
});

describe("状态账本：自洽性告警", () => {
  it("声明的 from 与上次记录的 to 不符时告警", () => {
    const warnings = validateStateConsistency([
      { beat_id: "A", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "入门" })] },
      { beat_id: "B", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ from: "宗师", to: "小成" })] },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("节点 B");
  });

  it("首次出现不写 from 不算告警", () => {
    expect(
      validateStateConsistency([
        { beat_id: "A", spacetime: { time: "未指定", location: "未指定" }, changes: [change({ to: "入门" })] },
      ]),
    ).toEqual([]);
  });
});

describe("状态账本：从通用产物搭基线", () => {
  it("角色基线取档案里类型稳定的三项", () => {
    const sheets = [
      {
        name: "阿零",
        label: "主角",
        role_in_story: "复仇者",
        background_information: "铁匠之子",
        visual_prompt: { zh: "少年，左眼有疤" },
      } as CharacterSheet,
    ];
    expect(buildBaselineCharacters(sheets)).toEqual([
      {
        name: "阿零",
        psychology: { personality: "复仇者", persona_base: "铁匠之子", current_mood: undefined },
        physical: { body: "少年，左眼有疤", attire: "未描述" },
        power_level: "初始",
        relationships: [],
      },
    ]);
  });

  it("道具基线里 initial_owner 落在位置上，acquired 仍是否", () => {
    const items = [
      { name: "断剑", initial_owner: "村长", initial_scene: "祠堂", description: "锈蚀" } as GameItem,
      { name: "灯", initial_owner: null, initial_scene: "祠堂", description: "" } as GameItem,
    ];
    const [sword, lamp] = buildBaselineItems(items);
    expect(sword.location).toBe("村长持有");
    expect(sword.acquired).toBe(false);
    expect(lamp.location).toBe("祠堂");
    expect(lamp.condition).toBe("初始状态");
  });
});

describe("状态账本：L3 情节节点接得上", () => {
  it("node_id / prev_node 就是图的骨架", () => {
    const plots = [
      { node_id: "p1", prev_node: [], state_deltas: [] },
      { node_id: "p2", prev_node: ["p1"], spacetime: { time: "次年", location: "王城" } },
    ] as PlotNode[];
    expect(plotsToLedgerNodes(plots)).toEqual([
      { id: "p1", prevIds: [], spacetime: undefined, changes: [] },
      { id: "p2", prevIds: ["p1"], spacetime: { time: "次年", location: "王城" }, changes: undefined },
    ]);
  });
});

describe("状态账本：渲染", () => {
  it("快照渲成下游提示词能直接引用的文本块", () => {
    const text = renderWorldSnapshot(computeWorldSnapshot(ledger([]), "A", [{ id: "A", prevIds: [] }]));
    expect(text).toContain("元年 · 村口");
    expect(text).toContain("阿零");
    expect(text).toContain("断剑");
    expect(text).toContain("旧王已死");
  });
});
