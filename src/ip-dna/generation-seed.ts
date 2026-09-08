/**
 * ip-dna/generation-seed.ts —— A→B 类型化交接契约（T4）。
 *
 * 把"理解管线(A) → 生成管线(B)"的交接从"往 ctx 上散戳多个字段 + 下游短路防覆盖"
 * 显式化为一份类型化契约 `GenerationSeed`：
 *   - orchestrator 产出 GenerationSeed（唯一事实源，可序列化、可单测）；
 *   - hydrateContextFromSeed 是【唯一】把种子注入 NarrativeContext 的地方（消除散戳）；
 *   - isIpDnaSeeded 给下游（如 user-preference-analysis 短路）一个显式判定。
 */
import type {
  NarrativeContext,
  UploadedScript,
  TargetStructure,
  GlobalControlParams,
  VnUnitActMap,
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
import type { PipelineFamily } from "./phase2c-gen-adapt.js";
import { mapTemplateToContext } from "./phase2-extract.js";

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
  /** 管线家族（rpg/vn），决定节点控制映射方式。 */
  family: PipelineFamily;
  /** RPG 节点数控制（family=rpg 时生效）。 */
  targetStructure?: TargetStructure;
  /** VN 开放幕数（family=vn 时生效）。 */
  vnActCount?: number;
  /** 章→幕锚定映射（P1-1，family=vn 且 IP 改编时生效）：每幕锚定源最小叙事单元供密度展开。 */
  unitToActMap?: VnUnitActMap;
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

  if (seed.family === "rpg" && seed.targetStructure) {
    const gcp: GlobalControlParams = {
      complexity: seed.complexity ?? 0.5,
      deviation: 0,
      target_structure: seed.targetStructure,
    };
    ctx.global_control_params = gcp;
  }
  if (seed.vnActCount != null) ctx.vn_target_act_count = seed.vnActCount;
  // P1-1：章→幕锚定映射注入（仅 IP 改编 VN 有）；幕数以映射为准，供 vn-segment-confirm 忠实分幕。
  if (seed.unitToActMap && seed.unitToActMap.acts.length > 0) {
    ctx.vn_unit_act_map = seed.unitToActMap;
    ctx.vn_target_act_count = seed.unitToActMap.acts.length;
  }
  if (seed.relationNetwork) ctx.relation_network = seed.relationNetwork;

  return ctx;
}

/**
 * 显式判定：该 ctx 是否由 IP DNA 种子水合而来。
 * 下游 step（如 user-preference-analysis）据此短路，避免覆盖 A→B 预置参数。
 */
export function isIpDnaSeeded(ctx: NarrativeContext): boolean {
  return !!ctx.narrativeIpDna;
}
