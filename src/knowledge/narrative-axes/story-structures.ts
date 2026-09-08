/**
 * 叙事结构轴（12 项）—— 故事的骨架形态。
 *
 * 与另外三轴不同，结构**不是用户的直接选择项**，也不再是一个 agent（v1.4 PRD §4.2.4）。
 * 它由游戏品类 / 叙事类型 / 叙事题材三轴各自的 structureHints 综合推导得出，
 * 推导见 resolve-structure.ts。
 *
 * 注意 code 里的 "linear" / "fragmented" / "emergent" 与 genre-narrative-type.ts 的
 * `NarrativeType` 字面量重名但语义不同：那边是**管线形态族**（怎么生产），
 * 这边是**故事骨架**（怎么讲）。两个枚举互不转换。
 */

export const STORY_STRUCTURE_CODES = [
  "linear",
  "fishbone",
  "tree",
  "multiline",
  "multi-pov",
  "network",
  "loop",
  "fragmented",
  "emergent",
  "nested",
  "stream",
  "hybrid",
] as const;

export type StoryStructureCode = (typeof STORY_STRUCTURE_CODES)[number];

/**
 * 结构策略生效的四个环节（与产品侧叙事结构清单的四列一一对应）。
 * 这里用语义阶段名而非 step id —— step id 到阶段的映射属于提示词层，见 prompt/strategy-slots.ts。
 */
export type StrategyStage = "demand" | "design" | "outline" | "structure";

export interface StoryStructureEntry {
  code: StoryStructureCode;
  name: string;
  /** 一句话简介 */
  summary: string;
  /** 四个环节各自的落地指引 */
  stageHints: Readonly<Record<StrategyStage, string>>;
}

export const STORY_STRUCTURES: readonly StoryStructureEntry[] = [
  {
    code: "linear",
    name: "线性结构",
    summary: "单线时间/因果推进",
    stageHints: {
      demand: "预判线性适配性",
      design: "确立线性基调、落盘策略",
      outline: "单线组织宏观走向",
      structure: "主链细化、弱分支",
    },
  },
  {
    code: "fishbone",
    name: "鱼骨结构",
    summary: "主骨事件 + 两侧细骨互推",
    stageHints: {
      demand: "预判鱼骨适配性",
      design: "确立主骨事件轴",
      outline: "主骨节点 + 侧支挂点",
      structure: "主骨—细骨双层展开",
    },
  },
  {
    code: "tree",
    name: "树状结构",
    summary: "多分支如主干枝干",
    stageHints: {
      demand: "预判树状适配性",
      design: "确立分支基调",
      outline: "主干 + 主要分支",
      structure: "剧情树分叉与结局分布",
    },
  },
  {
    code: "multiline",
    name: "多线交织",
    summary: "多线并行最终交织",
    stageHints: {
      demand: "预判多线适配性",
      design: "确立多线并行策略",
      outline: "各线走向 + 交汇点",
      structure: "各线分支 + 交织编排",
    },
  },
  {
    code: "multi-pov",
    name: "多视角交织",
    summary: "同一事件多视角反复讲述、拼凑真相",
    stageHints: {
      demand: "预判多视角适配性",
      design: "确立视角矩阵 + 真相拼图",
      outline: "各视角版本 + 信息差布局",
      structure: "视角轮替编排 + 真相收束校验",
    },
  },
  {
    code: "network",
    name: "网状结构",
    summary: "多线纵横成网",
    stageHints: {
      demand: "预判网状适配性",
      design: "确立网状复杂度",
      outline: "节点网 + 关键枢纽",
      structure: "网状连接与路径收束",
    },
  },
  {
    code: "loop",
    name: "循环结构",
    summary: "首尾闭环、宿命感",
    stageHints: {
      demand: "预判循环适配性",
      design: "确立循环母题",
      outline: "循环锚点与回环",
      structure: "回环节点 + 闭合校验",
    },
  },
  {
    code: "fragmented",
    name: "碎片化",
    summary: "片段乱序、需拼凑",
    stageHints: {
      demand: "预判碎片适配性",
      design: "确立碎片母题 + 线索",
      outline: "碎片集合 + 线索埋点",
      structure: "乱序编排 + 拼合线索",
    },
  },
  {
    code: "emergent",
    name: "涌现性",
    summary: "自下而上生成意义",
    stageHints: {
      demand: "预判涌现适配性",
      design: "确立涌现规则/要素",
      outline: "要素池 + 触发条件",
      structure: "事件节点 + 涌现判定",
    },
  },
  {
    code: "nested",
    name: "嵌套结构",
    summary: "故事套故事多层",
    stageHints: {
      demand: "预判嵌套适配性",
      design: "确立内外层框架",
      outline: "外层框架 + 内层入口",
      structure: "内外层剧情树嵌套",
    },
  },
  {
    code: "stream",
    name: "意识流",
    summary: "意识流动、破时空",
    stageHints: {
      demand: "预判意识流适配性",
      design: "确立意识流基调",
      outline: "意识锚点与跳转",
      structure: "非线性内心节点编排",
    },
  },
  {
    code: "hybrid",
    name: "混合结构",
    summary: "多结构组合",
    stageHints: {
      demand: "预判主导结构 + 组合",
      design: "确立主导 + 组合方案",
      outline: "分段分配子结构",
      structure: "分段应用 + 衔接校验",
    },
  },
];

const BY_CODE = new Map<string, StoryStructureEntry>(STORY_STRUCTURES.map((s) => [s.code, s]));

export function getStoryStructure(code: string | null | undefined): StoryStructureEntry | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

export function isStoryStructureCode(code: string): code is StoryStructureCode {
  return BY_CODE.has(code);
}
