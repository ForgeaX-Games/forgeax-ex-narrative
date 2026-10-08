/**
 * custom-team/ip-dna-bridge.ts — 蒸馏对 IP 提炼管线与百科娘的默认接线
 *
 * 两个蒸馏专家都要求「复用IP提炼管线（IP提炼专家）」。本文件就是那个"复用"：
 * 把 `runIngest → runExtractAndGenerate` 跑成一本书的模板 + 算子摘要，
 * 蒸馏专家只吃摘要，不碰原文。
 *
 * `runGeneration: false` 是要点：提炼到"读懂这本书"就停。继续往下生成会为每本书
 * 白跑一整条叙事管线——蒸馏根本用不到那些产物。
 */
import type { IncomingFile } from "../ip-dna/phase0-foundation.js";
import type { LLMClient } from "../pipeline/runtime/llm-client.js";
import type { NarrativeIpDna, NarrativeOperator, NarrativeTemplate } from "../types/narrative-ip-dna.js";
import type { BookEvidence } from "./distill-prompts.js";
import type { BookGroup } from "./types.js";

/** 提炼一本书需要的文件本体，由调用方（API 层）按 BookGroup.files 提供。 */
export type BookFileProvider = (book: BookGroup) => IncomingFile[];

export interface BridgeOptions {
  llm: LLMClient;
  provideFiles: BookFileProvider;
  cwd?: string;
}

/** 模板摘要：只取"这本书是怎么搭的"，不铺全文字段。 */
export function templateDigest(template: NarrativeTemplate | undefined): string {
  if (!template) return "（提炼未产出模板）";
  const ce = template.core_elements ?? {};
  const lines = [
    ce.subject ? `题材：${ce.subject}` : "",
    ce.theme ? `主题：${ce.theme}` : "",
    ce.core_conflict ? `核心冲突：${ce.core_conflict}` : "",
    ce.literature_style ? `文学风格：${ce.literature_style}` : "",
    ce.emotion_experience ? `情感体验：${ce.emotion_experience}` : "",
    template.story_structure ? `结构：${JSON.stringify(template.story_structure)}` : "",
    template.summary ? `梗概：${template.summary}` : "",
  ].filter(Boolean);
  return lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "（模板字段为空）";
}

/**
 * 算子摘要：名称 + 定义 + 用法，最多 40 条。
 *
 * 上限不是省 token：一本长篇能提出几百个算子，全铺进去会让蒸馏变成"从噪声里找信号"，
 * 归纳出的技能反而更泛。取前 40 条（提炼侧已按层级归纳过，靠前的更宏观）。
 */
export function operatorDigest(operators: readonly NarrativeOperator[]): {
  text: string;
  uids: string[];
} {
  const picked = operators.slice(0, 40);
  if (picked.length === 0) return { text: "（提炼未产出算子）", uids: [] };
  const text = picked
    .map((op) => `- [${op.uid}] ${op.name}：${op.definition}${op.usage_guide ? `（用法：${op.usage_guide}）` : ""}`)
    .join("\n");
  return { text, uids: picked.map((op) => op.uid).filter(Boolean) };
}

/** 从层级树收集全部算子（树上各节点各有一份）。 */
export function collectOperators(dna: NarrativeIpDna): NarrativeOperator[] {
  const out: NarrativeOperator[] = [];
  const seen = new Set<string>();
  for (const node of Object.values(dna.nodes ?? {})) {
    for (const op of node.operators ?? []) {
      if (op.uid && seen.has(op.uid)) continue;
      if (op.uid) seen.add(op.uid);
      out.push(op);
    }
  }
  return out;
}

/**
 * 默认提炼实现：一本书跑一次完整提炼（不生成）。
 *
 * 动态 import orchestrator 而非顶层导入：它把 phase0–phase5 全家族拉进依赖图，
 * 而只想读 profile 的调用方（如注入路径、API 列表）不该为此付加载代价。
 */
export function createBookExtractor(opts: BridgeOptions): (book: BookGroup) => Promise<BookEvidence> {
  return async function extractBook(book: BookGroup): Promise<BookEvidence> {
    const files = opts.provideFiles(book);
    if (files.length === 0) throw new Error(`《${book.title}》没有可提炼的文件`);

    const { runIngest, runExtractAndGenerate } = await import("../ip-dna/orchestrator.js");
    const ingest = await runIngest({
      files,
      title: book.title,
      llm: opts.llm,
      cwd: opts.cwd,
      // 蒸馏只要"读懂"，不要多模态转写的额外成本；纯文本材料本就走不到那条路。
      deferMultimodal: true,
    });

    const result = await runExtractAndGenerate(
      {
        title: book.title,
        story_timestamp: ingest.story_timestamp,
        llm: opts.llm,
        cwd: opts.cwd,
        runGeneration: false,
      },
      {
        story_timestamp: ingest.story_timestamp,
        title: ingest.title,
        manifest: ingest.manifest,
        fullText: ingest.fullText,
        media_type: ingest.media_type,
        dna: ingest.dna,
        hydrated: ingest.hydrated,
      },
    );

    const rootTemplate = result.dna.nodes?.[result.dna.rootId]?.template
      ?? result.gameUnits[0]?.topTemplate;
    const ops = operatorDigest(collectOperators(result.dna));

    return {
      title: book.title,
      bookUid: book.bookUid,
      templateDigest: templateDigest(rootTemplate),
      operatorDigest: ops.text,
      operatorUids: ops.uids,
      ipDnaRunId: `${result.story_timestamp}_${result.title}`,
    };
  };
}

/**
 * 默认作者资料检索实现：复用百科娘席位（2.5.1）。
 *
 * 这正是 2.4.2 排在百科娘之后的原因——作者的公开资料不在用户的上传里，
 * 只能检索。没有联网通道时百科娘会如实标注退化，蒸馏侧因此不会把
 * "模型记忆里的作者印象"当成检索到的事实。
 */
export function createAuthorInfoRetriever(llm: LLMClient): (author: string) => Promise<string> {
  return async function retrieveAuthorInfo(author: string): Promise<string> {
    const { encyclopediaRetrieval } = await import("../pipeline/steps/encyclopedia.js");
    const ctx = {
      user_input: `作家 ${author} 的创作经历、创作观与代表作`,
      encyclopedia_topic: `作家 ${author}`,
    } as unknown as import("../types/index.js").NarrativeContext;

    await encyclopediaRetrieval(ctx, llm);
    const doc = ctx.encyclopedia_doc;
    if (!doc) return "";
    if (!doc.channels.web) {
      // 明确告诉蒸馏专家这次没联网，否则它会把纯本地那轮的输出当外部资料采信。
      return `（本次没有联网通道，以下仅为本地可得信息）\n${doc.summary}`;
    }
    const entries = doc.entries.map((e) => `- ${e.term}：${e.detail}`).join("\n");
    return [doc.summary, entries].filter(Boolean).join("\n");
  };
}
