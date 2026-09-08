/**
 * vn-v2/_shared.ts
 * ─────────────────────────────────────────────────────────────────
 * 影游叙事 v2 专属管线（tpl-vn-v2）9 个 step 的共享工具与统一约定。
 *
 * 与 MyFile/提示词/影游生成方案.md + MyFile/提示词/影游叙事生成提示词/00_README.md 对齐：
 *   - 编号体系：场=<数字>，情节点=<数字>.<数字>，分镜=<数字>.<数字>-<数字>
 *   - 三维场状态：location_name + time_of_day(日|夜) + indoor_outdoor(内|外)
 *   - 五要素融合为单段叙述（content 字段）
 *   - 结局标签：H/B/O（大写）
 *   - 选项标签：A/B/C/D
 *   - QTE：仅保留 branch_qte（决策型，影响剧情，与 options 互斥）；演出型 performance 已全局停用
 */
import type { NarrativeContext, VnBranchedBeat } from "../../../types/index.js";
import { chunkArray } from "../../graph/topo-sort.js";
import { runParallel, type ParallelTask } from "../../runtime/parallel-runner.js";

/**
 * 从正文首句派生一个简短标题（后端兜底）。
 * 仅当 LLM 未产出 title 时启用；正常情况下用 LLM 给的真标题。前端读不到 title 时的
 * 兜底逻辑与此同源，两端一致。
 */
export function deriveBeatTitleFromContent(content: string | undefined, fallback: string): string {
  const text = (content ?? "").trim();
  if (!text) return fallback;
  const first = text.split(/[。！？!?\n;；，,]/)[0]?.trim() ?? "";
  const base = first || text;
  const MAX = 14;
  return base.length > MAX ? base.slice(0, MAX) : base;
}

/* ════════════════════════════════════════════════════════════════════════
 *  复杂度档位 → VN 节点预算（与前端 COMPLEXITY_LEVELS 挡位对齐）
 *  ────────────────────────────────────────────────────────────────────────
 *  前端 5 档（极简/短篇/标准/丰富/史诗）。VN 是固定 3 幕结构，故把"总节点数"
 *  落到 每幕场数 × 每场情节点数（线性拍数）+ 剧情树总拍上限（含分支/结局）。
 *
 *  ⚠ 史诗(5) 后端默认接「丰富(4)」预算：史诗在前端是"100+ 不限"，但单次整树
 *     生成受 LLM 输出 token 上限约束，"不限"会有被截断风险。封顶到丰富既贴近
 *     前端语义，又规避截断。
 * ──────────────────────────────────────────────────────────────────────── */
export interface VnScaleBudget {
  level: number;
  label: string;
  /** 每幕场数范围 [min, max]（VN 固定 3 幕） */
  scenesPerAct: [number, number];
  /** 每场情节点（线性拍）数范围 [min, max] */
  beatsPerScene: [number, number];
  /** 剧情树（G-01）全树 beat 总数上限（含主线 + 分支后果 + 局部/全局结局） */
  treeBeats: number;
}

/**
 * 1-4 档预算表；史诗(5) 在 resolveVnComplexity 处映射到丰富(4)。
 *
 * ⚠ 关键关系（与前端挡位 5-10 / 15-25 / 35-50 / 75-100 对齐）：
 *   - treeBeats = 该档「总节点数」上限，对齐前端挡位（≈16 / 26 / 50 / 100）。
 *   - E1-03/04 只产**黄金线（理想线，全答对的那条单路）**，G-01 在其上**长出**分支轨迹
 *     （答错/答偏的后果链、挣扎回归链、下坠链）+ 局部/全局结局拍。
 *   - 黄金线**只是脊、是少数派**：线性拍数（scenesPerAct × beatsPerScene × 3 幕）刻意压到
 *     treeBeats 的 ~45-50%，让 G-01 拿到 ~50-55% 的"分支/结局名额"——分支轨迹才是树的主体，
 *     而非"主线 + 几个装饰分支"。
 *   线性上限（3 幕）：极简 ≤12 / 短篇 12 / 标准 ≤27 / 丰富 ≤48，分别给分支留 ~4 / 14 / 23 / 52 名额。
 */
const VN_COMPLEXITY_BUDGET: Record<number, VnScaleBudget> = {
  1: { level: 1, label: "极简", scenesPerAct: [1, 2], beatsPerScene: [2, 2], treeBeats: 16 },
  2: { level: 2, label: "短篇", scenesPerAct: [2, 2], beatsPerScene: [2, 2], treeBeats: 26 },
  3: { level: 3, label: "标准", scenesPerAct: [3, 3], beatsPerScene: [2, 3], treeBeats: 50 },
  4: { level: 4, label: "丰富", scenesPerAct: [4, 4], beatsPerScene: [3, 4], treeBeats: 100 },
};

/**
 * 解析有效复杂度档位（1-4）：
 *   - 来源优先级：global_control_params.complexity（RPG 权威）→ ctx.complexity（VN 注入）→ 默认 3 标准
 *   - 史诗(5) → 丰富(4)：后端默认封顶，规避单次整树输出截断
 */
export function resolveVnComplexity(ctx: NarrativeContext): number {
  const raw =
    ctx.global_control_params?.complexity ??
    (ctx as { complexity?: number }).complexity ??
    3;
  let n = Math.round(Number(raw));
  if (!Number.isFinite(n)) n = 3;
  n = Math.max(1, Math.min(5, n));
  if (n === 5) n = 4; // 史诗默认接丰富
  return n;
}

/** 取当前 run 的 VN 节点预算（已处理史诗→丰富封顶）。 */
export function getVnBudget(ctx: NarrativeContext): VnScaleBudget {
  return VN_COMPLEXITY_BUDGET[resolveVnComplexity(ctx)] ?? VN_COMPLEXITY_BUDGET[3]!;
}

/**
 * 黄金线（线性拍）预算 —— 场/情节点解耦后 vn-beats 不再经"场"分层，
 * 直接按幕产情节点。把原 `scenesPerAct × beatsPerScene` 折算为**每幕线性拍数区间**，
 * 语义与旧预算等价（treeBeats 不变，仍由 G-01 在黄金线上长出分支）。
 */
export function getLinearBeatBudget(ctx: NarrativeContext): { perAct: [number, number] } {
  const b = getVnBudget(ctx);
  return {
    perAct: [b.scenesPerAct[0] * b.beatsPerScene[0], b.scenesPerAct[1] * b.beatsPerScene[1]],
  };
}

/** v2 管线统一的"原创性"提示（保留原文 vs 二创新增）。 */
export const ORIGINALITY_NOTE = `
## 原创性约束
- 已有原文（用户上传剧本中已有的台词 / 描写 / 角色名 / 场景命名）：一字不改
- 新增内容（影游化改造时新增的分支、结局、QTE 等）：可基于剧情逻辑进行二创
`.trim();

/** v2 管线统一的"五要素融合"提示。 */
export const FIVE_ELEMENT_NOTE = `
## 内容字段（content）写作规范
- 五要素必须齐全：人物（characters）/ 情境（situation）/ 动机（motivation）/ 行为（action）/ 结果（outcome）
- 输出形态：融合为单段中文叙述，可读性优先（不要拆成五个独立字段）
- 长度建议：场 80-150 字 / 情节点 50-100 字 / 幕详见各 step
`.trim();

/** v2 管线统一的"编号体系"提示。 */
export const NUMBERING_NOTE = `
## 编号体系（严格遵守）
- 幕（act）：汉字"一"/"二"/"三"
- 场（scene）：纯数字字符串，**全局严格递增且唯一，绝不复用**（"1", "2", "3"... 一路 +1）；支线场号也用全局递增数字，通过 is_main_line 字段区分
  · ⚠ 回到同名地点也用新场号：剧情上"回到"先前出现过的地点（三维状态与某早先场相同）时，**必须取全局最大场号 +1，绝不复用那个早先场的场号**
  · 否则会出现两个"场 1"→ 两套 "1.x" 撞号 beat → 剧情树残缺。场号只表示剧情推进顺序；同名地点的资产复用由 location_name 字段承担，不靠复用场号
- 情节点（beat）：<场号>.<场内序号>（"1.1", "1.2", "2.1"...）；**全篇唯一，纯数字**
- 分镜（shot）：<情节点号>-<镜号>（"1.1-1", "1.1-2"...）
- 选项 UI 标签：A/B/C/D（仅显示用，**严禁拼进 beat_id**）
  · ❌ 违例：把选项/QTE 结果塞进 id —— "5.2_A" / "5.2_B" / "7.1_S" / "3.1a" 都非法
  · ✅ 正确：beat_id 永远是 "5.2" 这种纯「场.序」，分支差异走 next_nodes[].label 与 condition
- 结局标签：H（happy）/ B（bad）/ O（open），全大写
`.trim();

/**
 * 场/情节点解耦后的"拓扑序 beat_id"提示（§4.6c）。
 * 故事结构只由情节点 DAG 承载、情节点用**拓扑序临时 id**（不含场号）；
 * 最终 `场.序` 由剧情树拓扑定稿后的确定性场号导出统一分配。
 */
export const TOPO_BEAT_ID_NOTE = `
## 情节点编号（拓扑序，非场号）
- 每个情节点 beat_id = "b" + 递增数字（"b1", "b2", "b3"...），**全篇唯一、纯拓扑序**
- ⚠ beat_id **不含场号**：场是拍摄分组、由系统在剧情树定稿后按三维状态自动导出，你无需（也不要）编场号
- 选项 UI 标签仍是 A/B/C/D（仅显示用，严禁拼进 beat_id）
- 结局标签：H（happy）/ B（bad）/ O（open），全大写
`.trim();

/**
 * 场/情节点解耦后的"三维 staging"提示（§4.6c）：每个情节点自带三维状态，
 * 供系统在剧情树定稿后按"相邻同三维=同场、任一维变=切新场"确定性导出场号。
 */
export const STAGING_NOTE = `
## 三维 staging（每个情节点必填，供系统导出拍摄分组"场"）
- location_name：地点名称（具体到可拍摄/可渲染的实景）
- time_of_day："日" 或 "夜"
- indoor_outdoor："内" 或 "外"
- 只需**如实标注每个情节点发生的地点/时段/内外**；无需关心"场"如何切分（系统按三维相邻变化自动分组）
`.trim();

/** v2 管线统一的"三维场状态"提示。 */
export const SCENE_STATE_NOTE = `
## 三维场状态（场切分的唯一依据）
- location_name：地点名称（具体到可拍摄/可渲染的实景）
- time_of_day："日" 或 "夜"
- indoor_outdoor："内" 或 "外"
- 切场规则：任意一维变化 ⟹ 必须切新场号
- 不复用铁律：剧情"回到"某个先前出现过的同名地点（三维状态与早先某场全同）时，**仍取全局最大场号 +1，绝不复用旧场号**
  · 自检：把所有场号按出现顺序抄成序列，必须严格等于 1, 2, 3, 4...（一路 +1）；出现 "1,2,3,2" 这类复用即为错，须重排
`.trim();

/**
 * 把上传剧本的关键元数据拼成一段 prompt（给 E1/E2 step 引用）。
 * 当用户没有上传剧本时返回空串。
 */
export function buildUploadedScriptSnippet(ctx: NarrativeContext): string {
  const u = ctx.uploaded_script;
  if (!u?.content) return "";
  return `## 用户上传剧本
- 格式：${u.format}（约 ${u.char_count} 字）
${u.description ? `- 描述：${u.description}\n` : ""}
（原文已通过 user_input 拼接传入，请作为创作的核心参考。）`;
}

/** 简短的 stream-emit 类型（与其他 step 一致）。 */
export type StreamEmit = ((chunk: string, accumulated: string) => void) | undefined;

export function getStreamEmit(ctx: NarrativeContext): StreamEmit {
  return (ctx as Record<string, unknown>)._streamEmit as StreamEmit;
}

/* ════════════════════════════════════════════════════════════════════════
 * 线性段（segment）切分 + 段间拓扑波次 —— G-02/G-03 的并行/分批基础设施
 * ════════════════════════════════════════════════════════════════════════
 *
 * 为什么不用"场"做 G-02/G-03 的并行单元：分支后 scene_id 退化成"地点/状态标签"，
 * 同场可能混入不同分支线的 beat，而真正需要前后续接的相邻 beat 反而跨场。正确的轴是
 * **依赖关系**（对齐 RPG 的 topologicalWaves "分支并行 + 单线串行"）：
 *   - 把剧情树拆成**线性段**（一串由"出度=1 且 后继入度=1"边连成的 beat 链）；
 *   - 段内连续 beat 同批生成（续接最佳）；
 *   - 互不依赖的段 → 同波并行；有依赖的段 → 波次串行，前驱段产出作续接上下文。
 */

/** 段切分计划。 */
export interface SegmentPlan {
  /** 每段是有序 beat 列表（链上顺序）。 */
  segments: VnBranchedBeat[][];
  /** 段索引的拓扑波次：同波互不依赖（可并行），波间串行。 */
  waves: number[][];
  /** 每段段头的"外部前驱 beat_id"（来自其它段，用于跨段续接上下文）。 */
  headPredIds: string[][];
}

/**
 * 把剧情树 beats 切成线性段并排出拓扑波次。
 * 仅沿"前向边"（linear/choice/branch_qte）切分；merge_back 是回环，不计入续接/依赖。
 */
export function decomposeSegments(beats: VnBranchedBeat[]): SegmentPlan {
  const byId = new Map(beats.map((b) => [b.beat_id, b]));
  const isBeat = (id: string): boolean => byId.has(id);

  // beat→beat 前向边（去重、去 ending、去自指、去 merge_back）
  const outs = new Map<string, string[]>();
  const preds = new Map<string, string[]>();
  for (const b of beats) { outs.set(b.beat_id, []); preds.set(b.beat_id, []); }
  for (const b of beats) {
    const seen = new Set<string>();
    for (const e of b.next_nodes ?? []) {
      const to = e.to;
      if (e.kind === "merge_back") continue;
      if (!isBeat(to) || to === b.beat_id || seen.has(to)) continue;
      seen.add(to);
      outs.get(b.beat_id)!.push(to);
      preds.get(to)!.push(b.beat_id);
    }
  }
  const outdeg = (id: string): number => outs.get(id)?.length ?? 0;
  const indeg = (id: string): number => preds.get(id)?.length ?? 0;

  // 段头 = 入度≠1（root / 汇流）或 唯一前驱出度≠1（分支子节点）
  const isHead = (id: string): boolean => {
    if (indeg(id) !== 1) return true;
    const p = preds.get(id)![0];
    return outdeg(p) !== 1;
  };

  const segOf = new Map<string, number>();
  const segments: VnBranchedBeat[][] = [];
  const startSegment = (headId: string): void => {
    if (segOf.has(headId)) return;
    const idx = segments.length;
    const seg: VnBranchedBeat[] = [];
    segments.push(seg);
    let cur: string | undefined = headId;
    while (cur && !segOf.has(cur)) {
      seg.push(byId.get(cur)!);
      segOf.set(cur, idx);
      if (outdeg(cur) === 1) {
        const nxt: string = outs.get(cur)![0];
        if (indeg(nxt) === 1 && !segOf.has(nxt)) { cur = nxt; continue; }
      }
      cur = undefined;
    }
  };

  // 先按 tree 顺序处理所有段头，再兜底处理纯环里未访问的 beat（保证全覆盖）
  for (const b of beats) if (isHead(b.beat_id)) startSegment(b.beat_id);
  for (const b of beats) if (!segOf.has(b.beat_id)) startSegment(b.beat_id);

  // 段头外部前驱
  const headPredIds = segments.map((seg) => preds.get(seg[0].beat_id) ?? []);

  // 段依赖图：beat p→b 且分属不同段 ⟹ 段(p)→段(b)
  const segAdj: number[][] = segments.map(() => []);
  const segIndeg = new Array(segments.length).fill(0);
  const segEdgeSeen = new Set<string>();
  for (const b of beats) {
    const sb = segOf.get(b.beat_id)!;
    for (const p of preds.get(b.beat_id) ?? []) {
      const sp = segOf.get(p)!;
      if (sp === sb) continue;
      const key = `${sp}->${sb}`;
      if (segEdgeSeen.has(key)) continue;
      segEdgeSeen.add(key);
      segAdj[sp].push(sb);
      segIndeg[sb] += 1;
    }
  }

  // Kahn 波次
  const localIndeg = [...segIndeg];
  const waves: number[][] = [];
  let q = segments.map((_, i) => i).filter((i) => localIndeg[i] === 0);
  while (q.length > 0) {
    waves.push(q);
    const nq: number[] = [];
    for (const i of q) for (const j of segAdj[i]) if (--localIndeg[j] === 0) nq.push(j);
    q = nq;
  }
  // 环（理论上仅 merge_back 残留制造，已被排除；兜底）：未入波次的段统一作末波
  const placed = new Set(waves.flat());
  const leftover = segments.map((_, i) => i).filter((i) => !placed.has(i));
  if (leftover.length > 0) waves.push(leftover);

  return { segments, waves, headPredIds };
}

/** runBySegments 的单批生成回调签名。 */
export interface SegmentRunOptions<T> {
  beats: VnBranchedBeat[];
  /** 单次 LLM 调用的 beat 上限（维持各步现状：G-02=10 / G-03=8）。 */
  maxBeatsPerCall: number;
  /** 同波并行度。 */
  concurrency: number;
  /** 生成一批：leadIn = 跨段前驱续接产出，prior = 同段更早批的产出。返回该批每 beat 的产物。 */
  runBatch: (batch: VnBranchedBeat[], leadIn: T[], prior: T[]) => Promise<T[]>;
  /** 该批失败时的逐 beat 降级占位（保拓扑不断链）。 */
  placeholder: (beat: VnBranchedBeat) => T;
  /** 从产物取回 beat_id（用于装配与续接查找）。 */
  idOf: (item: T) => string;
  /** 每段完成回调（流式进度）。 */
  onProgress?: (done: number, total: number, label: string) => void;
  /** 单批失败告警收集。 */
  onWarn?: (msg: string) => void;
}

/**
 * 按线性段执行：波次串行、波内段并行、段内按 maxBeatsPerCall 切子批串行。
 * 跨段续接：段头的外部前驱产出（已在更早波次完成）作为 leadIn 喂入该段首批。
 * 返回的产物**按入参 beats 的原始顺序**装配（缺失自动补占位），保证下游顺序稳定、不丢节点。
 */
export async function runBySegments<T>(opts: SegmentRunOptions<T>): Promise<T[]> {
  const { segments, waves, headPredIds } = decomposeSegments(opts.beats);
  const done = new Map<string, T>();
  const total = opts.beats.length;
  let completed = 0;

  for (const wave of waves) {
    const tasks: ParallelTask<void>[] = wave.map((segIdx, k) => ({
      id: `seg#${segIdx}`,
      sequenceIndex: k,
      run: async () => {
        const seg = segments[segIdx];
        // 跨段续接：段头外部前驱的产出（前序波次已就绪）
        const leadIn = headPredIds[segIdx]
          .map((id) => done.get(id))
          .filter((x): x is T => x !== undefined);
        const subBatches = seg.length > opts.maxBeatsPerCall
          ? chunkArray(seg, opts.maxBeatsPerCall)
          : [seg];
        const segProduced: T[] = [];
        for (let bi = 0; bi < subBatches.length; bi++) {
          const batch = subBatches[bi];
          // 段内续接：本段已生成的上文（首批用跨段 leadIn，后续批用段内 prior）
          const prior = bi === 0 ? [] : segProduced.slice();
          const lead = bi === 0 ? leadIn : [];
          try {
            const items = await opts.runBatch(batch, lead, prior);
            segProduced.push(...items);
          } catch (e) {
            opts.onWarn?.(
              `段#${segIdx} 子批 ${bi + 1}/${subBatches.length} 生成失败，已降级保留拓扑：${(e as Error).message}`,
            );
            for (const b of batch) segProduced.push(opts.placeholder(b));
          }
        }
        for (const item of segProduced) done.set(opts.idOf(item), item);
        completed += seg.length;
        opts.onProgress?.(completed, total, `seg#${segIdx}`);
      },
    }));
    await runParallel(tasks, opts.concurrency);
  }

  // 按原始 beats 顺序装配，缺失补占位（防御：某 beat 从未被任一段覆盖）
  return opts.beats.map((b) => done.get(b.beat_id) ?? opts.placeholder(b));
}
