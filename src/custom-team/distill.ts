/**
 * custom-team/distill.ts — 两个蒸馏专家的执行链
 *
 * ─────────────────────────────────────────────────────────────────
 * 链路
 * ─────────────────────────────────────────────────────────────────
 *   用户声明的书籍分组
 *     └─ 逐组跑 IP 提炼管线（runIngest → runExtractAndGenerate，runGeneration=false）
 *          └─ 模板 + 算子摘要
 *     ├─ （2.4.2）作者上传资料
 *     └─ （2.4.2）百科娘检索作者公开资料
 *          └─ 一次蒸馏调用 → DistilledProfile → 落盘 ready
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么每一步外部依赖都是接缝
 * ─────────────────────────────────────────────────────────────────
 * 提炼一本书要跑几十次 LLM 调用、写十几个目录。若蒸馏直接硬调 orchestrator，
 * 这条链就只能靠"投一本真书跑一小时"来验证，等于没有测试。所以提炼、检索、
 * 蒸馏调用三处都留成参数，默认实现在 ip-dna-bridge.ts。
 */
import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import { extractJSON } from "../pipeline/runtime/llm-client.js";
import type { BookGroup, DistilledProfile, TeamRecord } from "./types.js";
import {
  authorAdvisorSystemPrompt,
  bookTemplateSystemPrompt,
  distillUserPrompt,
  SKILL_TARGET_SEATS,
  type BookEvidence,
  type DistillEvidence,
} from "./distill-prompts.js";
import { markDistilling, markFailed, markReady } from "./store.js";

/** 一本书的提炼接缝：跑 IP 提炼管线，回摘要。 */
export type BookExtractor = (book: BookGroup) => Promise<BookEvidence>;

/** 作者公开资料检索接缝（百科娘）。 */
export type AuthorInfoRetriever = (authorName: string) => Promise<string>;

/** 作者上传资料读取接缝（把文件名读成正文）。 */
export type AuthorMaterialReader = (fileNames: string[]) => Promise<string>;

export interface DistillDeps {
  llm: LLMClient;
  extractBook: BookExtractor;
  retrieveAuthorInfo?: AuthorInfoRetriever;
  readAuthorMaterials?: AuthorMaterialReader;
  cwd?: string;
}

/** 校验（抛错触发 LLM 重试）。 */
export function validateProfile(raw: string): void {
  const parsed = extractJSON<Record<string, unknown>>(raw);
  if (!parsed.displayName || !String(parsed.displayName).trim()) {
    throw new Error("缺 displayName");
  }
  if (!Array.isArray(parsed.signatureTraits) || parsed.signatureTraits.length === 0) {
    throw new Error("signatureTraits 不能为空：没有风格签名的助手等于没蒸馏出东西");
  }
  const skills = parsed.stageSkills;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    throw new Error("stageSkills 必须是「席位 id → 技能段」的对象");
  }
  if (Object.keys(skills as object).length === 0) {
    throw new Error("stageSkills 不能为空：一个技能都注入不了的 profile 没有用处");
  }
}

const SKILL_SEAT_IDS = new Set(SKILL_TARGET_SEATS.map((s) => s.seatId));

/**
 * 归一化蒸馏产物。
 *
 * 两处硬性过滤：
 *   - stageSkills 的键必须是**可注入的席位 id**。模型爱写 `all` / `plot_generation`
 *     （step id）/ 自造的席位名，留着它们会让注入静默命中不了任何席位；
 *   - 结构骨架与方法论按形态择一保留。两个都留会让 2.4.2 的顾问带上某一本书的骨架，
 *     那正是跨作品蒸馏要避免的东西。
 */
export function normalizeProfile(
  parsed: unknown,
  record: TeamRecord,
  evidence: DistillEvidence,
): DistilledProfile {
  const raw = (parsed ?? {}) as Record<string, unknown>;
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter((s) => s.trim().length > 0) : [];

  const stageSkills: Record<string, string> = {};
  const skillsRaw = (raw.stageSkills ?? {}) as Record<string, unknown>;
  for (const [seatId, skill] of Object.entries(skillsRaw)) {
    if (!SKILL_SEAT_IDS.has(seatId)) continue;
    const text = String(skill ?? "").trim();
    if (text) stageSkills[seatId] = text;
  }

  const evidenceUids = new Set(evidence.books.flatMap((b) => b.operatorUids));
  const claimedUids = asStrings(raw.operatorUids);
  // 只保留证据里真有的 uid：模型编出来的 uid 会让"这条技能从哪来"这个追溯彻底失真。
  const operatorUids = claimedUids.filter((uid) => evidenceUids.has(uid));

  const isBook = record.kind === "book_template";
  return {
    displayName: String(raw.displayName ?? "").trim()
      || (isBook ? `《${record.source}》模板创作助手` : `${record.source}创作顾问`),
    summary: String(raw.summary ?? "").trim(),
    signatureTraits: asStrings(raw.signatureTraits),
    taboos: asStrings(raw.taboos),
    ...(isBook
      ? { structureTemplate: String(raw.structureTemplate ?? "").trim() || undefined }
      : { methodology: String(raw.methodology ?? "").trim() || undefined }),
    stageSkills,
    operatorUids,
  };
}

/** 收集蒸馏证据：逐本提炼 + （2.4.2）作者资料两路。 */
export async function collectEvidence(
  record: TeamRecord,
  deps: DistillDeps,
): Promise<{ evidence: DistillEvidence; books: BookGroup[] }> {
  const books: BookGroup[] = [];
  const bookEvidence: BookEvidence[] = [];

  for (const book of record.books) {
    // 一本挂了不放弃其余：三本书里一本编码坏了，仍然值得按两本蒸馏，
    // 但要在 summary 证据不足那条纪律里体现出来（提示词已交代）。
    try {
      const ev = await deps.extractBook(book);
      bookEvidence.push(ev);
      books.push({ ...book, ipDnaRunId: ev.ipDnaRunId ?? book.ipDnaRunId });
    } catch (e) {
      console.error(`[蒸馏] 《${book.title}》提炼失败：${(e as Error).message}`);
      books.push(book);
    }
  }

  const evidence: DistillEvidence = { books: bookEvidence };

  if (record.kind === "author_advisor") {
    if (record.authorMaterials.length > 0 && deps.readAuthorMaterials) {
      try {
        evidence.authorMaterials = await deps.readAuthorMaterials(record.authorMaterials);
      } catch (e) {
        console.warn(`[蒸馏] 作者资料读取失败：${(e as Error).message}`);
      }
    }
    if (record.useEncyclopedia && deps.retrieveAuthorInfo) {
      try {
        evidence.encyclopedia = await deps.retrieveAuthorInfo(record.source);
      } catch (e) {
        // 检索失败退化为"没有检索结果"，提示词里已明令此时不得用记忆补充。
        console.warn(`[蒸馏] 百科娘检索失败：${(e as Error).message}`);
      }
    }
  }

  return { evidence, books };
}

/**
 * 跑一次蒸馏，落盘 profile。
 *
 * 状态机由本函数独占推进：distilling → ready / failed。调用方不要自己改状态，
 * 否则会出现"跑挂了但状态还停在 distilling"的僵态，用户只能看着转圈。
 */
export async function distillTeam(
  record: TeamRecord,
  deps: DistillDeps,
): Promise<TeamRecord> {
  if (record.books.length === 0 && record.authorMaterials.length === 0) {
    return markFailed(record.id, "没有任何材料：请先声明书籍分组或上传作者资料", deps.cwd) ?? record;
  }

  markDistilling(record.id, deps.cwd);
  try {
    const { evidence, books } = await collectEvidence(record, deps);
    if (evidence.books.length === 0 && !evidence.authorMaterials && !evidence.encyclopedia) {
      throw new Error("提炼与检索都没有产出可用证据");
    }

    const system = record.kind === "book_template"
      ? bookTemplateSystemPrompt(record)
      : authorAdvisorSystemPrompt(record);
    const raw = await deps.llm.callWithRetry(
      system,
      distillUserPrompt(record, evidence),
      { responseFormat: "json", temperature: 0.4 },
      validateProfile,
    );

    const profile = normalizeProfile(extractJSON(raw), record, evidence);
    // 书籍分组带回 ipDnaRunId 后要一起落盘，否则下次没法回到提炼产物。
    const withRuns = markReady(record.id, profile, deps.cwd);
    if (withRuns) {
      const { saveTeam } = await import("./store.js");
      return saveTeam({ ...withRuns, books }, deps.cwd);
    }
    return record;
  } catch (e) {
    return markFailed(record.id, (e as Error).message, deps.cwd) ?? record;
  }
}
