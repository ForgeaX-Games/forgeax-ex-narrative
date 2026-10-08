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

/**
 * 结构的**拓扑参数** —— 让「结构规定故事的框架和走向」这句话在代码里成立。
 *
 * 为什么必须有这一组字段：从前每个结构 code 只有 name / summary / stageHints
 * 四段文案，三轴辛苦综合出一个「鱼骨」之后，这个结论只能进提示词当描述，
 * 对树真正长什么样**零影响** —— 分支率与聚合倾向全由体量档位单独决定
 * （layer-threshold-config.ts 的 COMPLEXITY_PROFILES 只以 complexity 为键）。
 * 于是投票再精确，线性结构和网状结构生成出来的树是一模一样的形状。
 *
 * 这不是新立第五套枚举：外部剧本契约里的四个拓扑词
 * （纯树状 / 胖尾 / Y 型速决 / 线性主干+稀疏关键分叉）正是这些参数的取值语汇，
 * `tree` 与 `fishbone` 本来就同名同义。参数补在既有的 12 个 code 上，
 * 结构轴仍是唯一的结构事实源。
 */
export interface StructureTopology {
  /** 主干形态：单主干 / 多线并行 / 回环 / 离散无主干。 */
  spine: "single" | "parallel" | "cyclic" | "scattered";
  /**
   * 分支密度调制系数，乘到体量给出的目标分支率上。
   * 1 = 不调制；线性 0.15 表示「同样的体量下，线性结构该长出的分叉只有基准的一成半」。
   */
  branchDensity: number;
  /**
   * 聚合倾向调制系数，乘到体量给出的聚合倾向上。
   * > 1 表示「分了要收回来」（鱼骨的侧骨必回主骨），< 1 表示「分了就不回头」（树状的多结局）。
   */
  mergeAffinity: number;
  /** 单个分叉点该开几条路线（最少 2）。视角轮替、网状这类结构天然宽于 2。 */
  branchWidth: number;
  /** 分叉点落在父节点序列的什么位置：早分（Y 型）/ 中段 / 临近结局（胖尾）。 */
  branchPlacement: "early" | "middle" | "late";
  /** 结局数量倾向。 */
  endings: "single" | "few" | "many";
  /**
   * 一句话拓扑画像，写进结构控制提示词。
   *
   * 必须与上面的数值同向：确定性代码按数值 enforce，LLM 的结构规划按这句话来，
   * 两边说的不是一回事时，enforce 会把模型刚规划好的形状改掉，白费一轮调用。
   */
  shape: string;
}

export interface StoryStructureEntry {
  code: StoryStructureCode;
  name: string;
  /** 一句话简介 */
  summary: string;
  /** 四个环节各自的落地指引 */
  stageHints: Readonly<Record<StrategyStage, string>>;
  /** 拓扑参数：该结构对树的形状提出的要求。 */
  topology: StructureTopology;
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
    topology: {
      spine: "single",
      branchDensity: 0.15,
      mergeAffinity: 1.4,
      branchWidth: 2,
      branchPlacement: "late",
      endings: "single",
      shape: "单主干推进，几乎不分叉；万不得已才在临近结局处开一处，且很快收束回主链",
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
    topology: {
      spine: "single",
      branchDensity: 0.7,
      mergeAffinity: 1.6,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "few",
      shape: "线性主干 + 稀疏关键分叉：侧支只承担一件事，走两三个节点就必须回主骨，主骨不被打断",
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
    topology: {
      spine: "single",
      branchDensity: 1.4,
      mergeAffinity: 0.5,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "many",
      shape: "纯树状：分叉之后各走各路、很少重新合流，因此结局数量多",
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
    topology: {
      spine: "parallel",
      branchDensity: 1.2,
      mergeAffinity: 1.5,
      branchWidth: 2,
      branchPlacement: "early",
      endings: "few",
      shape: "多条线从早期就并行推进，中后段交汇；分叉要早，收束要实（交汇点必须是同一个节点）",
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
    topology: {
      spine: "parallel",
      branchDensity: 1.0,
      mergeAffinity: 1.7,
      branchWidth: 3,
      branchPlacement: "early",
      endings: "few",
      shape: "同一事件的多个视角轮替讲述，每轮结束都回到共同事实；分叉宽而浅，不产生真正的路线分歧",
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
    topology: {
      spine: "parallel",
      branchDensity: 1.8,
      mergeAffinity: 1.2,
      branchWidth: 3,
      branchPlacement: "early",
      endings: "many",
      shape: "纵横成网：分叉多、汇聚也多，同一个节点可以由多条不同路径抵达",
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
    topology: {
      spine: "cyclic",
      branchDensity: 0.8,
      mergeAffinity: 1.8,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "few",
      shape: "首尾闭环：分支最终都回到同一个锚点节点，靠回到原处制造宿命感",
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
    topology: {
      spine: "scattered",
      branchDensity: 1.3,
      mergeAffinity: 0.7,
      branchWidth: 3,
      branchPlacement: "early",
      endings: "few",
      shape: "碎片乱序：节点成组而非成链，组间因果弱；分叉宽、收束弱，真相靠玩家拼合",
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
    topology: {
      spine: "scattered",
      branchDensity: 1.5,
      mergeAffinity: 0.6,
      branchWidth: 3,
      branchPlacement: "early",
      endings: "many",
      shape: "自下而上涌现：大量并列的触发点，不预设唯一主干，走向由触发顺序决定",
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
    topology: {
      spine: "single",
      branchDensity: 0.9,
      mergeAffinity: 1.5,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "few",
      shape: "故事套故事：外层框架中嵌入内层，内层讲完必须回到外层的同一个位置继续",
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
    topology: {
      spine: "scattered",
      branchDensity: 0.6,
      mergeAffinity: 0.9,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "single",
      shape: "意识流动：时空自由跳转，但体验主体只有一个，跳转不等于分叉，真分叉很少",
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
    topology: {
      spine: "single",
      branchDensity: 1.0,
      mergeAffinity: 1.0,
      branchWidth: 2,
      branchPlacement: "middle",
      endings: "few",
      shape: "分段采用不同子结构：前段用线性把人物与世界立稳，后段再开分叉；两段衔接处必须交代清楚",
    },
  },
];

const BY_CODE = new Map<string, StoryStructureEntry>(STORY_STRUCTURES.map((s) => [s.code, s]));

export function getStoryStructure(code: string | null | undefined): StoryStructureEntry | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

/**
 * 中性拓扑：三轴都没给出倾向（结构为 null）时用它。
 *
 * 不默认成 linear 或 tree —— 那等于在「没有依据」的情况下替用户选了一个结构。
 * 所有调制系数为 1 意味着「完全按体量档位的基准来」，与接入结构参数之前的行为一致。
 */
export const NEUTRAL_TOPOLOGY: StructureTopology = {
  spine: "single",
  branchDensity: 1,
  mergeAffinity: 1,
  branchWidth: 2,
  branchPlacement: "middle",
  endings: "few",
  shape: "",
};

/** 取该结构的拓扑参数；结构未定时返回中性拓扑（全函数，调用方不必判空）。 */
export function getStructureTopology(code: string | null | undefined): StructureTopology {
  return getStoryStructure(code)?.topology ?? NEUTRAL_TOPOLOGY;
}

export function isStoryStructureCode(code: string): code is StoryStructureCode {
  return BY_CODE.has(code);
}
