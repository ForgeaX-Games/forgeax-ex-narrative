/**
 * ip-dna/fidelity.ts —— 这次生成与原作是什么关系。
 *
 * 三个判定在一起，因为它们是同一个问题的逐级细化：有没有原作（`isIpDnaSeeded`）→
 * 原作算什么（`contentFidelityOf`）→ 原作的结构能不能改（`sourceStructureIsBinding`）。
 * 分开放会让第三问在不同层各答一遍，而它必须只有一个答案（见该函数注释）。
 *
 * 本文件只依赖类型：`phase2-extract` 与 `generation-seed` 互为上下游，判定若住在
 * 其中任一侧，另一侧引用就成环。
 */
import type { NarrativeContext } from "../types/index.js";
import type { ContentFidelity } from "../types/narrative-ip-dna.js";
import { DEFAULT_CONTENT_FIDELITY } from "../types/narrative-ip-dna.js";

/**
 * 显式判定：该 ctx 是否由 IP DNA 种子水合而来。
 * 下游 step（如 user-preference-analysis）据此短路，避免覆盖 A→B 预置参数。
 */
export function isIpDnaSeeded(ctx: NarrativeContext): boolean {
  return !!ctx.narrativeIpDna;
}

const FIDELITY_TIERS: readonly ContentFidelity[] = ["faithful", "balanced", "bold", "creative"];

/**
 * 校验外部传入的档位。不认识的值返回 undefined（由调用方落到缺省档），不抛错：
 * 拼错一个档位不该让整次改编起不来，而按缺省档跑出来的结果用户看得见、说得清。
 *
 * 收在这里是为了让每个入口用同一套判据 —— 各写一遍的后果是某个入口偷偷多认一个
 * 拼法，于是同一个档位在两条路上跑出两种行为。
 */
export function parseContentFidelity(raw: unknown): ContentFidelity | undefined {
  return typeof raw === "string" && (FIDELITY_TIERS as readonly string[]).includes(raw)
    ? (raw as ContentFidelity)
    : undefined;
}

/**
 * 本次改编的内容忠实度。非 IP 路径也答得出（拿不到指令就是缺省档），这样调用方
 * 不必先判一次"是不是 IP"再判一次档位。
 */
export function contentFidelityOf(ctx: NarrativeContext): ContentFidelity {
  return ctx.adaptation_directive?.content_fidelity ?? DEFAULT_CONTENT_FIDELITY;
}

/**
 * 原作的结构在这次改编里是不可改的蓝本吗 —— 只有 `faithful` 档是。
 *
 * L0 的 seeded 模式与 L1/L2 的注入路由都问这一个判据，不各自判一遍：那三层描述的是
 * 同一棵树，答案分歧就意味着 L0 照搬了原作章节、L1 却按自己的想法重铺了一遍，
 * 拿到的树既不是原作的也不是新编的。
 *
 * 为什么 `balanced`（缺省档）不算：它明确允许"重排节奏、合并次要情节、调整支线与
 * 结局实现"，而注入是确定性映射 + 不跑规划，正好把这些自由全部取消。缺省档按 faithful
 * 跑的后果不是"更保真"，是用户没要求照搬却只拿到原作拓扑的换皮。
 */
export function sourceStructureIsBinding(ctx: NarrativeContext): boolean {
  return isIpDnaSeeded(ctx) && contentFidelityOf(ctx) === "faithful";
}
