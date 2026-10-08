/**
 * ip-dna/generation-seed.ts —— A→B 类型化交接契约（T4）。
 *
 * 把"理解管线(A) → 生成管线(B)"的交接从"往 ctx 上散戳多个字段 + 下游短路防覆盖"
 * 显式化为一份类型化契约 `GenerationSeed`：
 *   - orchestrator 产出 GenerationSeed（唯一事实源，可序列化、可单测）；
 *   - hydrateContextFromSeed 是【唯一】把种子注入 NarrativeContext 的地方（消除散戳）；
 * 种子与原作的关系判定（isIpDnaSeeded / 忠实度 / 结构是否可改）住在 ./fidelity.ts。
 */
import type {
  NarrativeContext,
  UploadedScript,
  NodeBudgetOverride,
  GlobalControlParams,
} from "../types/index.js";
import type {
  NarrativeIpDna,
  NarrativeTemplate,
  StoryTimestamp,
  AdaptationDirective,
  UserAssetManifest,
  LayeredOperators,
} from "../types/narrative-ip-dna.js";
import type { LongMemoryLedger } from "./phase5-polish.js";
import { mapTemplateToContext } from "./phase2-extract.js";
import { DEFAULT_COMPLEXITY_TIER } from "../pipeline/runtime/layer-threshold-config.js";
import { inferStructureFromTopology } from "../knowledge/narrative-axes/infer-structure.js";

/**
 * A→B 生成种子：理解管线交给生成管线的完整、显式契约。
 */
export interface GenerationSeed {
  storyTitle: string;
  storyTimestamp: StoryTimestamp;
  /** 游戏单元顶层聚合 template（A→B 映射源）。 */
  topTemplate: NarrativeTemplate;
  /** 游戏单元 scoped IP DNA 切片（生成期算子注入就地消费）。 */
  scopedDna: NarrativeIpDna;
  /** 分层算子桶（§3.2 top/mid/leaf/global），供生成期按环节所属层选池注入。 */
  operatorLayers?: LayeredOperators;
  /** 长记忆一致性账本（§10）。 */
  ledger: LongMemoryLedger;
  adaptationDirective?: AdaptationDirective;
  assetManifest?: UserAssetManifest;
  /** 最终用户输入（已含 KAG 关系简报追加，如有）。 */
  userInput: string;
  uploadedScript?: UploadedScript;
  complexity?: number;
  /** 各层节点预算覆盖。 */
  nodeBudgetOverride?: NodeBudgetOverride;
  /** KAG 关系网络注入简报（如有）。 */
  relationNetwork?: string;
}

/**
 * 【唯一】把 GenerationSeed 水合为生成期 NarrativeContext。
 * 所有"理解→生成"的字段注入都收敛在此（消除 orchestrator 里散戳 ctx）。
 */
export function hydrateContextFromSeed(seed: GenerationSeed): NarrativeContext {
  const ctx = mapTemplateToContext(seed.topTemplate, {
    user_input: "",
    story_title: seed.storyTitle,
    story_timestamp: seed.storyTimestamp,
    narrativeIpDna: seed.scopedDna,
    adaptation_directive: seed.adaptationDirective,
    user_asset_manifest: seed.assetManifest,
  });

  (ctx as Record<string, unknown>)._long_memory_ledger = seed.ledger;
  if (seed.operatorLayers) {
    (ctx as Record<string, unknown>)._operator_layers = seed.operatorLayers;
  }
  ctx.user_input = seed.userInput;
  if (seed.uploadedScript) ctx.uploaded_script = seed.uploadedScript;
  if (seed.complexity != null) ctx.complexity = seed.complexity;

  // 预算无条件生效。这里曾加 `seed.family === "rpg"` 的前置条件，而缺省家族是 vn ——
  // 于是缺省路径下改编选的体量算了也白算，生成期读不到节点预算。
  if (seed.nodeBudgetOverride) {
    const gcp: GlobalControlParams = {
      // 档位是 1-5 的整数枚举（极简…史诗），不是 0-1 连续量。旧默认值 0.5 会被下游
      // Math.round 压成 1（极简），于是没带 complexity 的改编一律产出极简体量。
      complexity: seed.complexity ?? DEFAULT_COMPLEXITY_TIER,
      deviation: 0,
      node_budget_override: seed.nodeBudgetOverride,
    };
    ctx.global_control_params = gcp;
  }
  if (seed.relationNetwork) ctx.relation_network = seed.relationNetwork;

  /**
   * 原作的结构就是这次改编的结构轴。
   *
   * 平时结构靠三轴投票选，IP 改编不需要投——原作长什么样已经摆在提炼出来的 plot_tree
   * 里了。缺这一行的后果在真实跑里看得见：一部八段线性的原作，改编出来是一棵带分叉与
   * 合流的树，因为生成侧拿不到原作形状，只能按缺省结构参数长。
   *
   * 只在没人指定时写：用户显式选了结构（"我就要把这本线性小说改成多结局"）是正当需求，
   * 原作形状不该盖过它。数字分不清形状时 `inferStructureFromTopology` 返回 null，
   * 那时也维持原样——猜错的结构会去调制分支率，比不猜代价大。
   */
  if (!ctx.narrative_axes?.structure) {
    const inferred = inferStructureFromTopology(seed.topTemplate?.story_structure?.topology);
    if (inferred) ctx.narrative_axes = { ...ctx.narrative_axes, structure: inferred };
  }

  return ctx;
}

