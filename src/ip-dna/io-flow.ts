/**
 * 端到端阶段 I/O 契约（I/O Flow）—— 蓝图 §5「端到端流程与各阶段 I/O」的可执行编码。
 *
 * 把"标准化 → 体量判断/拆解 → ①裁剪范围 → ②游戏单元分配 → ③scoped 提取 → 生成 → 改写"
 * 各阶段的输入/输出字段固化为结构化契约表，作为各 Phase 实现的对照基准，
 * 并保证 input/output 全程共用同一 story_timestamp（§6.0）。
 */

import type { NarrativeContext } from "../types/index.js";

/** 流程阶段标识（与 todo / Phase 对齐）。 */
export type StageId =
  | "phase0_input_foundation"  // 输入地基：归档 _original + 资产清单
  | "phase1_understanding"     // 输入理解/标准化：层级树 + 体量判断/拆解
  | "phase2b_adapt_confirm"    // 改编三步确认：裁剪范围 + 游戏单元分配 + 触发提取
  | "phase2_ipdna_extract"     // scoped IP DNA 提取：三件套 + 聚合 + 映射
  | "phase2c_gen_adapt"        // 生成：管线适配（单品/系列、vn 开放幕数）
  | "phase4_rewrite";          // 改写：定点修改 + 影响面重算

/**
 * 单阶段 I/O 契约。inputs/outputs 用 NarrativeContext 字段名 + atlas key 表达，
 * 便于与 data-atlas 交叉校验。
 */
export interface StageContract {
  stage: StageId;
  title: string;
  /** 读取的上下文字段 / 文件来源。 */
  inputs: string[];
  /** 写出的上下文字段 / 落盘产物。 */
  outputs: string[];
  /** 落盘目录（相对 input 根 / output 根）。 */
  persistTo: string;
  /** 关键约束。 */
  invariants: string[];
}

export const IO_FLOW: readonly StageContract[] = [
  {
    stage: "phase0_input_foundation",
    title: "输入地基（仅后端）",
    inputs: ["用户上传文件(多模态/压缩包/不限量)"],
    outputs: ["user_asset_manifest", "story_timestamp", "story_title?"],
    persistTo: "input/<时间戳>_<故事名>/_original/",
    invariants: [
      "按完整故事时间戳归档，input/output 共用同一 story_timestamp",
      "生成结构化用户资产参考清单（UserAssetManifest）",
    ],
  },
  {
    stage: "phase1_understanding",
    title: "输入理解 / 标准化",
    inputs: ["user_asset_manifest", "_original 文件"],
    outputs: ["narrativeIpDna(轻量层级树: 序号/标题/边界)"],
    persistTo: "input/<时间戳>_<故事名>/_processing/",
    invariants: [
      "移植重写 agentos 三提取管线为 TS",
      "体量水准线判断 → 超阈值按格式拆解 → 再标准化",
      "层级树先轻量（仅骨架），三件套延后到 phase2 scoped 提取",
    ],
  },
  {
    stage: "phase2b_adapt_confirm",
    title: "改编三步确认（前置）",
    inputs: ["narrativeIpDna(层级树)"],
    outputs: ["adaptation_directive(adaptation_scope + game_unit_plan + dimensions)"],
    persistTo: "input/<时间戳>_<故事名>/_processing/",
    invariants: [
      "①嵌套裁剪 adaptation_scope ②game_unit_plan ③触发 scoped 提取",
      "默认体量≈25节点/25000字/20分钟；末单元<25并入前一单元",
      "硬区间(部/卷/册)+软区间(章)；子仓库无对话功能则默认全量",
    ],
  },
  {
    stage: "phase2_ipdna_extract",
    title: "游戏单元 IP DNA（scoped 提取）",
    inputs: ["adaptation_directive", "_processing 标准化文件"],
    outputs: ["narrativeIpDna(scoped: 三件套全 JSON)", "→映射 NarrativeContext 生成字段"],
    persistTo: "input/<时间戳>_<故事名>/_extraction_output/",
    invariants: [
      "层级化提取最小叙事单元三件套 → summary 递归聚合顶层 template + 算子池",
      "story_structure 对齐剧情树模型（01_story-tree-and-screenplay）",
      "三件套(template/operators/metadata.json)每层每文件夹必有",
    ],
  },
  {
    stage: "phase2c_gen_adapt",
    title: "生成（管线适配）",
    inputs: ["scoped narrativeIpDna → NarrativeContext"],
    outputs: ["B 套生成字段(story_framework→...→jrpg_script/quest_graph)"],
    persistTo: "output/<时间戳>_<故事名>/",
    invariants: [
      "单品: 完整内容=游戏单元(剧情树); 系列: 部=游戏单元↔rpg L0/vn P0",
      "vn 开放幕数 + 复杂度/节点数量控制；每单元剧情树≥25节点",
      "输出与输入同一 story_timestamp",
      "消费算子的环节注入三视角算子（一步法同台，算子方案落盘 output/.../算子方案/）",
    ],
  },
  {
    stage: "phase4_rewrite",
    title: "改写（定点修改 + 影响面重算）",
    inputs: ["已有 narrativeIpDna/NarrativeContext", "用户改写指令"],
    outputs: ["更新的字段 + 受影响下游重生成"],
    persistTo: "output/<时间戳>_<故事名>/",
    invariants: [
      "改写影响面沿 data-atlas downstream 链推导（computeImpactSet）",
      "影响面扩展到输入资产全链路",
    ],
  },
] as const;

export const IO_FLOW_INDEX: ReadonlyMap<StageId, StageContract> = new Map(
  IO_FLOW.map((s) => [s.stage, s]),
);

/**
 * 取/补全完整故事时间戳（§6.0）——保证 input/output 全程共用同一主键。
 * 已有则原样返回；否则按现有 server.ts formatTimestamp 同款规则由当前时间生成。
 */
export function ensureStoryTimestamp(ctx: Pick<NarrativeContext, "story_timestamp">): string {
  if (ctx.story_timestamp) return ctx.story_timestamp;
  return formatTimestamp(new Date().toISOString());
}

/** 与 api/server.ts formatTimestamp 对齐：ISO → 文件名安全紧凑串。 */
export function formatTimestamp(iso: string): string {
  return iso.replace(/T/, "_").replace(/[:.]/g, "-").replace(/Z$/, "");
}
