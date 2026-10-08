/**
 * content-check.ts — 内容检查助手（席位 2.5.16）
 *
 * ─────────────────────────────────────────────────────────────────
 * 与结构检查席（2.5.15）的分工
 * ─────────────────────────────────────────────────────────────────
 * 结构检查是**确定性**的：分支是否配对、结局是否可达、单元长度是否失衡，都是图上的事实，
 * 不需要模型。本席相反——改编还原、创作忠实、逻辑自洽、吃书防范、世界观适配、
 * 角色弧光适配、世界状态自洽、设定回收，八项全是内容判断，只能由模型读文本得出
 * （第七项"世界状态自洽"是 C1 从归档的 `vn_state_ledger` 吸收的业务功能，第八项
 * "设定回收"是 F2 从 F1 质量基线反推新增，见 `CONTENT_CHECK_CRITERIA` 的注释）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 只审不修（席位表 autoRepair: false）
 * ─────────────────────────────────────────────────────────────────
 * 报告里每条问题必须给出**定位**（节点 id + 原文片段）与**建议**，但不动产物。
 * 内容问题的修法往往有多种，且常常需要回到上游重生成（比如世界观本身就没交代清楚），
 * 让检查席顺手改文只会把"哪里出了问题"这个信息埋掉。修由打磨四席或重生成负责。
 */
import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../runtime/llm-client.js";
import { extractJSON } from "../runtime/llm-client.js";
import { userInstructionsBlock } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt } from "../runtime/prompt-composer.js";
import type { PromptComposer } from "../runtime/prompt-composer.js";
import type { PreflightResult } from "../blueprint/types.js";
import { findingId, mergeFindingStatuses, type QaFinding } from "../qa/findings.js";

/**
 * 席位表 2.5.16 点名的六项，逐字保留以便与席位表对照。后两项是两轮各自新增：
 *
 * 第七项"世界状态自洽"是 C1（VN v2 吸收）新增：归档的 `vn_state_ledger` 曾用一个
 * 独立 step 加 `WorldStateLedger` 数据结构逐节点记账防"吃书"，但那是运行方式；
 * 业务功能——"跨节点的世界状态必须自洽，后文不能推翻前文既定事实"——本就是
 * "吃书防范"这项检查该管的事，只是原表述偏"设定层面的吃书"（人物关系/能力边界/
 * 世界规则被悄悄改写），没有明确覆盖"状态层面的漂移"（角色位置、持有物、已知
 * 信息、已发生事件这类会随剧情推进而变化的动态状态）。加这一项把动态状态自洽
 * 单独点出来，不新增 step、不新增数据结构，见 `docs/legacy-salvage.md` 与
 * `src/pipeline/_archive/vn-v2/README.md`。
 *
 * 第八项"设定回收"是 F2（`docs/quality-baseline-f1.md` 缺陷 4.1）新增：F1 基线
 * 跑出来的九项发现里，最严重的一类是——世界观已经写明"某伏笔将在某处回收"，
 * 情节席却没有对照着写，这类缺失原有七项都不专门管（"逻辑自洽"查因果，"世界观
 * 适配"查有没有越界，都不等于查"该出现的东西出现了没有"）。这里单独列一项，
 * 逼模型主动去比对世界观里那些显式的回收计划，而不是被动等矛盾自己冒出来。
 */
export const CONTENT_CHECK_CRITERIA = [
  "改编还原",
  "创作忠实",
  "逻辑自洽",
  "吃书防范",
  "世界观适配",
  "角色弧光适配",
  "世界状态自洽",
  "设定回收",
] as const;

export type ContentCheckCriterion = (typeof CONTENT_CHECK_CRITERIA)[number];

/**
 * 本席的一条问题，就是两席共用的 `QaFinding`。
 *
 * 内容问题一律走定点重写（改命中的那个节点的正文），所以 `repairKind` 恒为
 * `content`；只有落在 "global" 上的跨节点问题没有单一重写目标，不给自动修。
 */
export type ContentCheckFinding = QaFinding;

export interface ContentCheckReport {
  verdict: "pass" | "warn" | "fail";
  summary: string;
  findings: ContentCheckFinding[];
  /** 每项检查的覆盖情况：没查（无据可查）也要如实说明，不能算通过。 */
  coverage: Array<{ criterion: string; checked: boolean; reason?: string }>;
  checkedAt: string;
}

/** 送检的节点正文。逐节点带 id，报告才定位得回来。 */
function buildReviewMaterial(ctx: NarrativeContext): string {
  const plots = ctx.plots_generated?.plots ?? [];
  if (plots.length === 0) return "";
  return plots
    .map((p) => `### 节点 ${p.node_id}\n${p.content}`)
    .join("\n\n");
}

export const CONTENT_CHECK_COMPOSER: PromptComposer = {
  stepId: "content_check",
  blocks: {
    role: `你是内容审校。你不改稿，只出报告——每条问题都要能被作者一眼定位并判断要不要改。

你的报告有一个硬要求：**每条问题都必须附原文片段**。说"某处逻辑不通"而不指出是哪句，
等于让作者重读全文；那样的报告不如不出。`,
    task_spec: `## 八项检查

1. **改编还原**：若有源作品，改编后的内容是否还原了源作的关键事实与关系。
   源作没提到的情节可以有，但不能与源作已确立的事实冲突。
2. **创作忠实**：是否忠于本作自己定下的设定与前文。前文说过的事，后文不能翻案。
3. **逻辑自洽**：因果链是否成立。角色的动机、信息掌握、时间与空间是否说得通——
   尤其是"角色为什么知道这件事"。
4. **吃书防范**：是否出现与前文矛盾的设定改写（吃书）。人物关系、能力边界、
   世界规则被悄悄改掉的，全部列出。
5. **世界观适配**：内容是否落在世界观允许的范围内。技术水平、社会形态、
   超自然规则不能越界。
6. **角色弧光适配**：角色此刻的言行是否处在他弧光的相应阶段。
   没有铺垫的性格突变要列出。
7. **世界状态自洽**：逐节点追踪会随剧情变化的动态状态——角色所在位置、持有的
   道具、已知的信息、已发生的事件——后续节点必须建立在这些状态之上，不能悄悄
   无视（例如角色明明不在场却对某事做出反应，或道具已经用掉/交出却在后文
   仍被当作持有）。这与第 4 项的区别：吃书防范查的是**静态设定**被推翻
   （人物关系/能力边界/世界规则），本项查的是**动态状态**被无视（位置/持有物/
   信息/事件的时间线）。
8. **设定回收**：世界观正文（尤其是历史脉络类槽位）里如果写明了具体的伏笔与
   回收计划（例如"某物件将在某阶段回收，揭示某信息"），逐条核对：这个回收有没有
   发生？发生的位置、参与人数、回收的具体信息点，是否与世界观原文写的限定词
   一致（"第一幕终盘"不等于开篇，"团队全员"不等于主角一人）？世界观里写了但
   全部送检节点里都找不到对应回收的，必须报告；对不上限定词的算 error，
   完全没有对应内容的也算 error（不要因为"至少沾边"就降级成 warn）。

## 报告要求

- 每条问题给：criterion（属于上面哪一项）、nodeId、severity、issue、excerpt（原文片段）、suggestion；
- severity=error 表示不改会出戏或前后矛盾；warn 表示可接受但更好可以更好；
- 八项都要在 coverage 里交代查了没查。无据可查的（如没有源作品时的"改编还原"）
  写 checked=false 并说明理由 —— 不能因为没查就算通过。`,
    cot: `## 机制与流程
1. 先看有没有源作品与前置设定：这决定"改编还原"与"创作忠实"能不能查。
2. 逐节点通读，边读边记与已知设定冲突的地方，先记位置再判性质。
3. 归类到八项。同一处可能同时属于多项，按最主要的一项记一次，不要重复计数。
4. 逐条补原文片段与建议；建议要具体到"改哪句、怎么改"或"回到哪席重生成"。
5. **判定"吃书"或"越界"之前，先回到本次送检材料里附的世界观/角色档案原文，
   逐字确认原文到底是怎么写的**——不要凭对题材的常识印象去判断"这个角色应该
   没有这个能力"。F1 基线里出现过一次假阳性：把角色档案里已经写明的水属性
   技能判成了"设定不符"，原因就是没有回查原文。这一步不能省。
6. 自检：有没有把"我不喜欢这种写法"当成问题？审的是自洽与适配，不是审美；
   有没有漏查第 8 项"设定回收"——这项最容易被跳过，因为它要求主动去世界观里
   找线索，而不是被动等矛盾自己冒出来。`,
    output_schema: `## 输出格式（严格 JSON）
{
  "verdict": "pass | warn | fail",
  "summary": "一句话总述",
  "findings": [{
    "criterion": "逻辑自洽",
    "nodeId": "节点ID 或 global",
    "severity": "error",
    "issue": "问题描述",
    "excerpt": "原文片段（原样摘录，不要改写）",
    "suggestion": "怎么改"
  }],
  "coverage": [{ "criterion": "改编还原", "checked": false, "reason": "本次没有源作品" }]
}`,
    material: (ctx: NarrativeContext): string => {
      const material = buildReviewMaterial(ctx);
      return material
        ? `## 送检内容（故事情节，逐节点）\n${material}`
        : "## 送检内容\n（没有可检查的情节：情节席还没产出）";
    },
    worldview: (ctx: NarrativeContext): string =>
      ctx.worldview_structure
        ? `## 世界观设定（适配性判据）\n${JSON.stringify(ctx.worldview_structure, null, 2)}`
        : "",
    characters: (ctx: NarrativeContext): string => {
      const sheets = ctx.detailed_character_sheets ?? [];
      if (sheets.length === 0) return "";
      const brief = sheets.map((c) => ({
        name: c.name,
        label: c.label,
        arc: c.character_arc_spectrum,
        motivation: c.psychological_drivers?.core_motivation,
      }));
      return `## 角色档案（弧光判据）\n${JSON.stringify(brief, null, 2)}`;
    },
    source: (ctx: NarrativeContext): string => {
      const uploaded = ctx.uploaded_script?.content;
      if (!uploaded?.trim()) return "## 源作品\n（本次没有源作品：改编还原一项无据可查）";
      const excerpt = uploaded.length > 8000 ? `${uploaded.slice(0, 8000)}\n……（截断）` : uploaded;
      return `## 源作品原文（改编还原与吃书判据）\n${excerpt}`;
    },
    user_instructions: (ctx: NarrativeContext): string => userInstructionsBlock(ctx),
  },
  systemBlockOrder: ["role", "task_spec", "cot", "output_schema"],
  userBlockOrder: ["material", "source", "worldview", "characters", "user_instructions"],
  skillSlots: [],
};

/** 输出校验（抛错触发 LLM 重试）。 */
export function validateContentCheck(raw: string): void {
  const parsed = extractJSON<Record<string, unknown>>(raw);
  if (!Array.isArray(parsed.findings)) throw new Error("findings 必须是数组");
  if (!Array.isArray(parsed.coverage)) throw new Error("coverage 必须是数组：八项都要交代查了没查");
  for (const f of parsed.findings as Array<Record<string, unknown>>) {
    // 没有原文片段的问题条目等于没定位，作者用不上；在这里挡住比在报告里看到更省事。
    if (!f.excerpt || !String(f.excerpt).trim()) {
      throw new Error(`findings 里有条目缺 excerpt（原文片段）: ${String(f.issue ?? "")}`);
    }
  }
}

/**
 * 归一化报告。
 *
 * verdict 由 findings 的严重度**重算**，不采信模型自述：模型常给一堆 error 却在
 * verdict 上写 pass，而下游（前端红点、闸门）只读 verdict。
 */
export function normalizeContentCheck(parsed: unknown): ContentCheckReport {
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const findings: ContentCheckFinding[] = Array.isArray(raw.findings)
    ? (raw.findings as Array<Record<string, unknown>>).map((f) => {
        const criterion = String(f.criterion ?? "");
        const nodeId = String(f.nodeId ?? "global");
        const issue = String(f.issue ?? "");
        return {
          id: findingId("content", criterion, nodeId, issue),
          criterion,
          nodeId,
          severity: f.severity === "error" ? ("error" as const) : ("warn" as const),
          issue,
          excerpt: String(f.excerpt ?? ""),
          suggestion: String(f.suggestion ?? ""),
          // 跨节点问题没有单一重写目标，定点重写够不着，只报不修。
          ...(nodeId === "global"
            ? {}
            : { repairKind: "content" as const, targetField: "plots_generated" }),
        };
      })
    : [];

  const coverage = Array.isArray(raw.coverage)
    ? (raw.coverage as Array<Record<string, unknown>>).map((c) => ({
        criterion: String(c.criterion ?? ""),
        checked: Boolean(c.checked),
        ...(c.reason ? { reason: String(c.reason) } : {}),
      }))
    : [];
  // 模型漏报的项按"没查"补齐：漏报与查过没问题在报告里必须能区分。
  for (const criterion of CONTENT_CHECK_CRITERIA) {
    if (!coverage.some((c) => c.criterion === criterion)) {
      coverage.push({ criterion, checked: false, reason: "本次报告未交代该项" });
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const verdict: ContentCheckReport["verdict"] =
    errors > 0 ? "fail" : findings.length > 0 ? "warn" : "pass";

  return {
    verdict,
    summary: String(raw.summary ?? `硬问题 ${errors} 项、待关注 ${findings.length - errors} 项`),
    findings,
    coverage,
    checkedAt: new Date().toISOString(),
  };
}

function emptyMaterialReport(): ContentCheckReport {
  return {
    verdict: "warn",
    summary: "没有可检查的内容：情节席还没产出",
    findings: [],
    coverage: CONTENT_CHECK_CRITERIA.map((criterion) => ({
      criterion,
      checked: false,
      reason: "无送检内容",
    })),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 起飞前短路：没有情节就不发请求，让模型在空材料上"审"只会得到一份编出来的报告。
 * runner 与 legacy 共用同一份空报告构造，避免两条路径的"空态"长成两个样子。
 */
export async function contentCheckPreflight(
  ctx: NarrativeContext,
): Promise<PreflightResult | void> {
  if (buildReviewMaterial(ctx)) return;
  return { skip: true, result: emptyMaterialReport() };
}

export async function contentCheck(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  // 没有情节就不发请求：让模型在空材料上"审"，只会得到一份编出来的报告。
  if (!buildReviewMaterial(ctx)) {
    (ctx as Record<string, unknown>).content_check_report = emptyMaterialReport();
    return;
  }

  const raw = await llm.callWithRetry(
    composeSystemPrompt(CONTENT_CHECK_COMPOSER, ctx),
    composeUserPrompt(CONTENT_CHECK_COMPOSER, ctx),
    { responseFormat: "json", temperature: 0.3 },
    validateContentCheck,
  );

  const report = normalizeContentCheck(extractJSON(raw));
  // M3：与结构检查席同一条道理——重跑不能把已处置的 finding 打回待处理。
  // 内容检查是 LLM 现写的文本，措辞多半会变，id 未必总能对上（这本就是内容检查
  // 与确定性的结构检查在这件事上的天然差异），能对上的那些仍按同一规则继承状态。
  const priorFindings = (ctx as Record<string, unknown>).content_check_report as
    | { findings?: QaFinding[] }
    | undefined;
  if (priorFindings?.findings?.length) {
    report.findings = mergeFindingStatuses(priorFindings.findings, report.findings);
  }
  (ctx as Record<string, unknown>).content_check_report = report;
  console.log(`[内容检查] ${report.summary}`);
}
