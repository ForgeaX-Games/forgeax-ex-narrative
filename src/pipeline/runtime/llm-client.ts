import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeout?: number;
  responseFormat?: "text" | "json";
  /** Override instance content locale for this call. */
  contentLocale?: ContentLocale;
}

/** 多模态图像分块（Gemini inlineData）。data 为 base64 字符串或 Buffer。 */
export interface ImagePart {
  mimeType: string;
  data: string | Buffer;
}

export interface LLMClientConfig {
  apiKey?: string;
  proxyUrl?: string;
  /** Bearer token for LiteLLM proxy (`LITELLM_PROXY_KEY`). */
  proxyApiKey?: string;
  /**
   * 借用宿主 agent 的模型。最后一条路：用户一把 key 都没配时用它，
   * 代价与能力差见 host-agent.ts 的 HOST_AGENT_LIMITS。
   */
  hostAgent?: HostAgentSpec;
  defaultModel?: string;
  /** UI locale — when "en", all LLM outputs are instructed to use English. */
  contentLocale?: ContentLocale;
}

import { getDefaultModel, getHostAgentCommand } from "../../utils/plugin-env.js";
import type { ContentLocale } from "../../types/index.js";
import { finalizeSystemPrompt, finalizeUserPrompt } from "./content-locale.js";
import { runHostAgent, type HostAgentSpec } from "./host-agent.js";
const DEFAULT_MODEL = getDefaultModel();
const DEFAULT_TIMEOUT = 300_000;
/**
 * Gemini 2.5 Flash / Pro 单次 generate 输出 token 硬上限。
 * 这是模型物理上限（传更大也只会输出到 64K），全代码库统一引用此值。
 * 短输出步骤不会因为 maxOutputTokens 设大而多消耗 token —— 计费按实际输出。
 */
export const MODEL_OUTPUT_MAX_TOKENS = 65_536;
const DEFAULT_MAX_TOKENS = MODEL_OUTPUT_MAX_TOKENS;
const DEFAULT_RETRIES = 3;

/**
 * 检测 JSON 字符串是否被截断（基于括号配平）。
 * 仅做廉价检测，不验证语义；语义校验交给上层 extractJSON。
 *
 * 触发条件：
 *  - 输入空字符串 → 抛错
 *  - 末尾不是 } 或 ] → 抛错
 *  - 大括号 / 中括号未配平 → 抛错
 *
 * 抛错时由 callWithRetry 自动重试 3 次，错误信息回灌给 LLM。
 */
export function assertJsonNotTruncated(raw: string, label: string): void {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`[${label}] LLM 返回空字符串，疑似超时/截断`);
  }
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== "}" && lastChar !== "]") {
    const stripped = trimmed.replace(/```\s*$/g, "").trim();
    const lastCharStripped = stripped[stripped.length - 1];
    if (lastCharStripped !== "}" && lastCharStripped !== "]") {
      throw new Error(
        `[${label}] LLM 输出疑似被截断（末尾不是 } 或 ]，最后 30 字符: ${stripped.slice(-30)})`,
      );
    }
  }
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }
  if (braceDepth !== 0 || bracketDepth !== 0) {
    throw new Error(
      `[${label}] JSON 括号未配平（{ 差 ${braceDepth}，[ 差 ${bracketDepth}），疑似被截断`,
    );
  }
}

/** 一条检索来源。title/uri 都可能缺，取决于模型回的 groundingChunks。 */
export interface WebSource {
  title?: string;
  uri?: string;
}

export interface WebSearchResult {
  text: string;
  /** 模型这次实际引用的网页来源；为空表示它没有真的检索。 */
  citations: WebSource[];
}

/** 从 groundingMetadata 里抽来源清单，按 uri 去重（同一页常被多次引用）。 */
function extractCitations(response: GenerateContentResponse): WebSource[] {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const chunk of chunks) {
    const web = (chunk as { web?: { uri?: string; title?: string } }).web;
    if (!web?.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ uri: web.uri, title: web.title });
  }
  return sources;
}

export class LLMClient {
  private client: GoogleGenAI | null;
  private proxyUrl: string | null;
  private proxyApiKey: string | null;
  private hostAgent: HostAgentSpec | null;
  private defaultModel: string;
  private contentLocale: ContentLocale;

  constructor(config: LLMClientConfig) {
    const model = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultModel = model;
    this.contentLocale = config.contentLocale ?? "zh";
    this.proxyUrl = config.proxyUrl?.replace(/\/+$/, "") ?? null;
    this.proxyApiKey = config.proxyApiKey?.trim() || null;
    this.hostAgent = null;

    if (this.proxyUrl) {
      this.client = null;
      if (!this.proxyApiKey) {
        throw new Error(
          "LLMClient proxy mode requires LITELLM_PROXY_KEY (LiteLLM proxy auth)",
        );
      }
    } else if (config.apiKey) {
      this.client = new GoogleGenAI({ apiKey: config.apiKey });
    } else {
      // 排在最后，且在这里兜底而不是在八个构造点各写一遍：「两把 key 都没有就借
      // 宿主的模型」是一句关于本类的话，八处各表述一次只会各自漂移。
      const command = config.hostAgent?.command || getHostAgentCommand();
      if (!command) {
        throw new Error("LLMClient requires apiKey, proxyUrl+proxyApiKey, or a host agent");
      }
      this.client = null;
      this.hostAgent = { command };
    }
  }

  /**
   * 这条通道是不是在借宿主的模型。
   *
   * 供 doctor 与产物元数据交代："这份内容是宿主模型生成的，不是叙事自带 key
   * 生成的"——两者的质量和成本不一样，混在一起看会得出错的结论。
   */
  get usesHostAgent(): boolean {
    return this.hostAgent !== null;
  }

  private async _callViaHostAgent(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
    images?: readonly ImagePart[],
  ): Promise<string> {
    return runHostAgent(this.hostAgent!, systemPrompt, userPrompt, {
      model: options.model,
      timeoutMs: options.timeout ?? DEFAULT_TIMEOUT,
      json: options.responseFormat === "json",
      images,
    });
  }

  private resolveLocale(options: LLMCallOptions): ContentLocale {
    return options.contentLocale ?? this.contentLocale;
  }

  private preparePrompts(
    systemPrompt: string,
    userPrompt: string,
    locale: ContentLocale,
  ): [string, string] {
    return [
      finalizeSystemPrompt(systemPrompt, locale),
      finalizeUserPrompt(userPrompt, locale),
    ];
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
  ): Promise<string> {
    const locale = this.resolveLocale(options);
    const [sp, up] = this.preparePrompts(systemPrompt, userPrompt, locale);
    if (this.hostAgent) {
      return this._callViaHostAgent(sp, up, options);
    }
    if (this.proxyUrl) {
      return this._callViaProxy(sp, up, options);
    }
    return this._callViaSdk(sp, up, options);
  }

  private async _callViaSdk(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const config: Record<string, unknown> = {};

    if (options.temperature !== undefined)
      config.temperature = options.temperature;
    config.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.responseFormat === "json")
      config.responseMimeType = "application/json";

    const response: GenerateContentResponse = await this.client!.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        ...config,
      },
    });

    const text = response.text;
    if (!text) throw new Error("LLM returned empty response");
    return text;
  }

  /**
   * 是否具备联网检索通道。
   *
   * 只有直连 Gemini SDK 那条路有：联网靠模型侧的 googleSearch 工具，而代理是
   * OpenAI 兼容的 /chat/completions，表达不了这个工具。调用方据此决定"只用本地源"
   * 还是"本地 + 联网"，并把实际用了哪些通道写进产物 —— 悄悄退化成纯本地
   * 会让一份凭记忆编的资料看起来像检索来的。
   */
  get supportsWebSearch(): boolean {
    return this.client !== null;
  }

  /**
   * 借宿主模型时的失败原话，跟代理那条路用同一个句式，方便调用方统一交代。
   * 宿主虽然自己会上网，但它不回 groundingChunks，拿不到来源就不能声称检索过。
   */
  private static readonly HOST_AGENT_NO_SEARCH =
    "callWithWebSearch requires the direct Gemini path (host agent returns no citable sources)";

  /**
   * 联网检索式调用（Gemini googleSearch grounding）。
   *
   * 返回正文与来源清单两样。来源为空**不是**错误，而是"模型这次没真去检索"的信号，
   * 由调用方决定如何交代——把没有来源的输出当检索结果用，等于把幻觉标成事实。
   *
   * 不设 responseMimeType：工具调用与强制 JSON mime 不能同时用，所以这里一律文本，
   * 结构化留给调用方的后续一轮（或 extractJSON 容错解析）。
   */
  async callWithWebSearch(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
  ): Promise<WebSearchResult> {
    if (!this.supportsWebSearch) {
      throw new Error(
        this.hostAgent
          ? LLMClient.HOST_AGENT_NO_SEARCH
          : "callWithWebSearch requires the direct Gemini path (proxy mode has no search tool)",
      );
    }
    const locale = this.resolveLocale(options);
    const [sp, up] = this.preparePrompts(systemPrompt, userPrompt, locale);

    const response: GenerateContentResponse = await this.client!.models.generateContent({
      model: options.model ?? this.defaultModel,
      contents: [{ role: "user", parts: [{ text: up }] }],
      config: {
        systemInstruction: sp,
        maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text;
    if (!text) throw new Error("LLM returned empty response");
    return { text, citations: extractCitations(response) };
  }

  /**
   * 多模态调用（图像 + 文本 → 文本）。用于 Phase1 图片/视频帧理解（§3.4 多模态提取）。
   * 把图像作为 inlineData parts 与文本一起喂给模型，返回模型文本输出。
   * 走与 call 相同的 SDK / proxy 双通道；无多模态支持时由上层降级。
   */
  async callWithImages(
    systemPrompt: string,
    userPrompt: string,
    images: ImagePart[],
    options: LLMCallOptions = {},
  ): Promise<string> {
    const locale = this.resolveLocale(options);
    const [sp, up] = this.preparePrompts(systemPrompt, userPrompt, locale);
    if (this.hostAgent) {
      return this._callViaHostAgent(sp, up, options, images);
    }
    const toBase64 = (d: string | Buffer): string =>
      typeof d === "string" ? d : d.toString("base64");
    const parts: Array<Record<string, unknown>> = [
      ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: toBase64(img.data) } })),
      { text: up },
    ];
    const model = options.model ?? this.defaultModel;

    const config: Record<string, unknown> = {};
    if (options.temperature !== undefined) config.temperature = options.temperature;
    config.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.responseFormat === "json") config.responseMimeType = "application/json";

    if (this.proxyUrl) {
      const timeout = options.timeout ?? DEFAULT_TIMEOUT;
      const body = {
        contents: [{ role: "user", parts }],
        systemInstruction: { parts: [{ text: sp }] },
        generationConfig: config,
      };
      const url = `${this.proxyUrl}/v1/gemini/generateContent/${model}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!resp.ok) {
          const detail = await resp.text().catch(() => "");
          throw new Error(`Proxy returned ${resp.status}: ${detail}`);
        }
        const data = (await resp.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error("LLM returned empty response");
        return text;
      } finally {
        clearTimeout(timer);
      }
    }

    const response: GenerateContentResponse = await this.client!.models.generateContent({
      model,
      contents: [{ role: "user", parts: parts as never }],
      config: { systemInstruction: sp, ...config },
    });
    const text = response.text;
    if (!text) throw new Error("LLM returned empty response");
    return text;
  }

  private async _callViaProxy(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    // ForgeaX LiteLLM proxy exposes OpenAI-compat `/v1/chat/completions`.
    // Legacy `/v1/gemini/generateContent/*` routes return 404 as of 2026-06.
    const url = `${this.proxyUrl}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.proxyApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Proxy returned ${resp.status}: ${detail}`);
      }

      const data = await resp.json() as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        const msg = data.error?.message ?? "LLM returned empty response";
        throw new Error(msg);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async *callStream(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
  ): AsyncGenerator<string> {
    const locale = this.resolveLocale(options);
    const [sp, up] = this.preparePrompts(systemPrompt, userPrompt, locale);
    if (this.hostAgent) {
      yield* LLMClient._simulateStream(await this._callViaHostAgent(sp, up, options));
    } else if (this.proxyUrl) {
      yield* this._streamViaProxy(sp, up, options);
    } else {
      yield* this._streamViaSdk(sp, up, options);
    }
  }

  /**
   * 把一次整段返回切成小块吐出来，给打字机效果用。
   *
   * 代理和宿主 agent 都只有非流式接口，但上层是按流写的；与其在上层分叉，
   * 不如在这里把"整段"装成"流"。真正的流式只有 SDK 直连那条路有。
   */
  private static async *_simulateStream(result: string): AsyncGenerator<string> {
    if (!result) return;
    const CHUNK = 80;
    for (let i = 0; i < result.length; i += CHUNK) {
      yield result.slice(i, i + CHUNK);
      if (i + CHUNK < result.length) await new Promise((r) => setTimeout(r, 12));
    }
  }

  private async *_streamViaSdk(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): AsyncGenerator<string> {
    const model = options.model ?? this.defaultModel;
    const config: Record<string, unknown> = {};
    if (options.temperature !== undefined) config.temperature = options.temperature;
    config.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.responseFormat === "json") config.responseMimeType = "application/json";

    const stream = await this.client!.models.generateContentStream({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, ...config },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  private async *_streamViaProxy(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): AsyncGenerator<string> {
    // Proxy only exposes generateContent (non-streaming).
    yield* LLMClient._simulateStream(await this._callViaProxy(systemPrompt, userPrompt, options));
  }

  async callStreamFull(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
    onChunk?: (chunk: string, accumulated: string) => void,
    maxRetries = DEFAULT_RETRIES,
  ): Promise<string> {
    let lastError: Error | undefined;
    for (let i = 0; i < Math.max(1, maxRetries); i++) {
      try {
        let accumulated = "";
        for await (const chunk of this.callStream(systemPrompt, userPrompt, options)) {
          accumulated += chunk;
          onChunk?.(chunk, accumulated);
        }
        if (!accumulated) throw new Error("LLM returned empty response (stream)");
        return accumulated;
      } catch (e) {
        lastError = e as Error;
        if (i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
        }
      }
    }
    throw lastError ?? new Error("callStreamFull exhausted all retries");
  }

  async callWithRetry(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
    parseResult?: (raw: string) => unknown,
    onChunk?: (chunk: string, accumulated: string) => void,
  ): Promise<string> {
    const locale = this.resolveLocale(options);
    const effectiveRetries = DEFAULT_RETRIES;
    let lastError: Error | undefined;
    let adjustedUserPrompt = userPrompt;

    const jsonRuleZh =
      "\n\n【格式铁律】你的输出必须是且仅是合法JSON。禁止：注释、省略号(...)、尾逗号、未转义换行符、单引号。数组/对象元素之间必须用逗号分隔。";
    const jsonRuleEn =
      "\n\n【FORMAT】Your output must be valid JSON only. Forbidden: comments, ellipses (...), trailing commas, unescaped newlines, single quotes. Array/object elements must be comma-separated.";

    const effectiveSystemPrompt =
      options.responseFormat === "json"
        ? systemPrompt + (locale === "en" ? jsonRuleEn : jsonRuleZh)
        : systemPrompt;

    // json 模式下，若调用方未自定义 parseResult，自动启用截断校验：
    // 末尾必须是 } 或 ]，且括号配平，否则抛错触发本函数自身的 3 次重试。
    // 这避免了 LLM 输出在 maxOutputTokens 边界被切成半截 JSON 后下游 JSON.parse 直接挂掉的问题。
    const effectiveParseResult =
      parseResult ??
      (options.responseFormat === "json"
        ? (raw: string) => assertJsonNotTruncated(raw, "callWithRetry.json")
        : undefined);

    const retrySuffixZh = (attempt: number, msg: string) =>
      `\n\n⚠️ 上次输出有误（第${attempt}次重试）：${msg}\n请重新生成。严格要求：\n- 输出必须是合法JSON，禁止任何注释、省略号或多余文字\n- 数组元素之间必须有逗号分隔\n- 对象键值对之间必须有逗号分隔\n- 最后一个元素后禁止尾逗号\n- 字符串中的换行符必须用\\n转义`;
    const retrySuffixEn = (attempt: number, msg: string) =>
      `\n\n⚠️ Previous output was invalid (retry ${attempt}): ${msg}\nRegenerate. Requirements:\n- Valid JSON only; no comments, ellipses, or extra prose\n- Commas between array elements and object properties\n- No trailing comma after the last element\n- Escape newlines in strings as \\n`;

    const rejected: string[] = [];
    for (let i = 0; i < effectiveRetries; i++) {
      let raw = "";
      try {
        raw = onChunk
          ? await this.callStreamFull(effectiveSystemPrompt, adjustedUserPrompt, options, onChunk)
          : await this.call(effectiveSystemPrompt, adjustedUserPrompt, options);
        if (effectiveParseResult) effectiveParseResult(raw);
        return raw;
      } catch (e) {
        lastError = e as Error;
        if (raw) rejected.push(raw);
        if (i < effectiveRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
        }
        adjustedUserPrompt =
          userPrompt +
          (locale === "en"
            ? retrySuffixEn(i + 1, lastError.message)
            : retrySuffixZh(i + 1, lastError.message));
      }
    }
    throw new Error(describeRetryExhaustion(lastError, rejected), { cause: lastError });
  }
}

/**
 * 重试全部失败时，把"模型到底吐了什么"一并说出来。
 *
 * 之前这里只把最后一次的异常原样抛出，落到 manifest 里就是一句
 * `Expected double-quoted property name in JSON at position 3237` ——
 * 位置有了、内容没了，事后只能靠重跑去猜是哪种坏法（而重跑往往就好了）。
 * 报错要能自证：附上出错位置附近的原文和每次尝试的长度。
 */
function describeRetryExhaustion(lastError: Error | undefined, rejected: string[]): string {
  const base = lastError?.message ?? "callWithRetry exhausted all retries";
  if (rejected.length === 0) return base;
  const last = rejected[rejected.length - 1];
  const sizes = rejected.map((r) => `${r.length}`).join("/");
  const posMatch = /position (\d+)/.exec(base);
  const pos = posMatch ? parseInt(posMatch[1], 10) : -1;
  const excerpt =
    pos >= 0
      ? last.slice(Math.max(0, pos - 120), pos + 120)
      : last.slice(-240);
  const where = pos >= 0 ? `出错处附近` : `输出末尾`;
  return `${base}（${rejected.length} 次尝试均被拒，输出长度 ${sizes}；${where}: …${excerpt}…）`;
}

/**
 * Attempt to repair common LLM JSON output errors:
 * - Trailing commas before ] or }
 * - Missing commas between elements (e.g. "}\n{" or '"\n"')
 * - Single quotes used as string delimiters
 * - Unescaped control characters inside strings
 */
function repairJSON(text: string): string {
  let s = text;
  // Remove trailing commas: ,] or ,}
  s = s.replace(/,\s*([\]}])/g, "$1");
  // Insert missing commas: }\s*{ or ]\s*[ or "value"\s*"key" patterns
  s = s.replace(/}\s*\n\s*{/g, "},\n{");
  s = s.replace(/]\s*\n\s*\[/g, "],\n[");
  s = s.replace(/"\s*\n(\s*")/g, '",\n$1');
  // Fix: value followed by key without comma (e.g. "foo": "bar"\n"baz":)
  s = s.replace(/"(\s*)\n(\s*"[^"]+"\s*:)/g, '",$1\n$2');
  // Replace single quotes with double (only outside already-double-quoted strings)
  // Conservative: only fix obvious patterns like {'key': 'value'}
  if (!s.includes('"')) {
    s = s.replace(/'/g, '"');
  }
  return s;
}

function safeParse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const repaired = repairJSON(text);
    return JSON.parse(repaired) as T;
  }
}

export function parseJSON<T = unknown>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return safeParse<T>(cleaned);
}

export function extractJSON<T = unknown>(raw: string): T {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return safeParse<T>(match[1].trim());
  try {
    return safeParse<T>(raw.trim());
  } catch {
    const jsonStart = raw.search(/[{[]/);
    if (jsonStart >= 0) {
      const isArray = raw[jsonStart] === "[";
      const jsonEnd = raw.lastIndexOf(isArray ? "]" : "}");
      if (jsonEnd > jsonStart) {
        return safeParse<T>(raw.slice(jsonStart, jsonEnd + 1));
      }
    }
    throw new Error(`No valid JSON found in response: ${raw.slice(0, 200)}`);
  }
}
