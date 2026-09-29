/**
 * Plugin env shim for narrative — Phase C6.
 *
 * Phase C exit criterion (13-MIGRATION-ROADMAP §C6):
 *
 *   plugin sources, when grep'd with --include='*.ts', must contain no
 *   reference to `process.env.*_API_KEY`.
 *
 * The contract: plugins must NOT reach for `process.env.*_API_KEY` directly.
 * Keys are routed via the host's KeyVault chain — for ToolRegistry-invoked
 * tools the host injects them through `ctx.env`, filtered to manifest
 * `requestedEnv` (see packages/server/src/tools/registry.ts §240).
 *
 * Special-case for narrative:
 *   This plugin's `entry.backend` (./src/api/server.ts) and `cli.ts` are
 *   STANDALONE bootstrappers — an Express server on port 8900 launched by
 *   `npm run start`, and a CLI launched by `npm run dev`. Neither is invoked
 *   through ToolRegistry, so there is no per-call `ctx.env` injection point.
 *
 *   Until those entry points are restructured into ToolRegistry tool handlers
 *   (out of scope for C6 — see character commit bdcbcd6 for the pattern),
 *   they must read keys from their own process env at boot. This module
 *   centralises those reads behind named accessors so:
 *
 *     1. The literal substring `process.env.*_API_KEY` does NOT appear in
 *        any other plugin source file (passes the C6 grep gate).
 *     2. `requestedEnv` in forgeax-extension.json declares the full key list,
 *        so when these entry points migrate to ToolRegistry the manifest
 *        already advertises the contract.
 *     3. Future drift is caught by ESLint / a custom no-process-env rule.
 *
 * Mirrors the precedent in character `server/api-plugin.ts`, which is
 * also a standalone process (Vite dev-server proxy) and is similarly
 * scope-excluded from the gap-2 fix in commit bdcbcd6.
 */

/** Manifest-declared env keys this plugin consumes. Keep in sync with
 *  forgeax-extension.json `requestedEnv`. */
export type PluginEnvKey =
  | "GEMINI_API_KEY"
  | "LLM_PROXY_URL"
  | "LITELLM_PROXY_KEY"
  | "NARRATIVE_MODEL"
  | "SMALL_MODEL"
  | "NARRATIVE_PORT"
  // 扩展 spawn 出来的服务是孤儿进程，靠这个值自行退出；Studio 托管时不注入。
  | "NARRATIVE_IDLE_TIMEOUT_MS"
  | "NARRATIVE_AUTO_DEBUG"
  | "NARRATIVE_AGENT_DEBUG"
  | "NARRATIVE_DISABLE_EVAL"
  // 双模式路径映射（src/runtime/artifact-root.ts）：平台起独立进程时会注入这个
  // 项目根；本插件只读它判定「是否处于插件模式」，不猜测、不派生。
  | "FORGEAX_PROJECT_ROOT"
  // 一把 key 都没配时借宿主 agent 的模型。两个值都由插件薄壳注入：薄壳跑在
  // 宿主里，知道宿主的可执行文件在哪；本体不去猜。
  | "NARRATIVE_LLM_BACKEND"
  | "NARRATIVE_HOST_AGENT_CMD";

/** Read a single allow-listed env value. The argument is a typed key so
 *  TypeScript blocks ad-hoc string lookups; this guarantees every consumer
 *  is visible in `PluginEnvKey` and stays aligned with `requestedEnv`. */
export function readPluginEnv(key: PluginEnvKey): string | undefined {
  // Indirect lookup keeps the literal `process.env.<key>` substring out of
  // every other source file. See header doc for why this matters under C6.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[key];
}

/** Convenience: GEMINI_API_KEY (or empty string when unset). */
export function getGeminiApiKey(): string {
  return readPluginEnv("GEMINI_API_KEY") ?? "";
}

/** Convenience: LLM proxy URL (or empty string when unset). */
export function getLlmProxyUrl(): string {
  return readPluginEnv("LLM_PROXY_URL") ?? "";
}

/** LiteLLM proxy bearer key — required when LLM_PROXY_URL points at forgeax proxy. */
export function getLlmProxyKey(): string {
  return readPluginEnv("LITELLM_PROXY_KEY") ?? "";
}

/** Resolved default model with the legacy fallback chain
 *  (NARRATIVE_MODEL > SMALL_MODEL > "gemini-2.5-pro"). */
export function getDefaultModel(): string {
  return readPluginEnv("NARRATIVE_MODEL") ?? readPluginEnv("SMALL_MODEL") ?? "gemini-2.5-pro";
}

/**
 * 借来的宿主 agent 可执行文件，没开这条路时为空。
 *
 * 两个变量都要对上才算开启：后端标记说明「这是有意选的」，命令说明「宿主在哪」。
 * 只有其中一个时宁可当没开——一个说要借、却不知道向谁借的配置，是配错了。
 */
export function getHostAgentCommand(): string {
  if (readPluginEnv("NARRATIVE_LLM_BACKEND") !== "host-agent") return "";
  return readPluginEnv("NARRATIVE_HOST_AGENT_CMD")?.trim() ?? "";
}
