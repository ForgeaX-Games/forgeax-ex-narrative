/**
 * 分栏嵌入模式。
 *
 * 平台把 viz 挂成两个独立 iframe：Sidebar 用 `?pane=left`，MainArea 用 `?pane=center`，
 * 各有一份 JS 上下文与 zustand store，只靠 BroadcastChannel 同步 SYNC_KEYS。
 * 独立运行时没有 pane 参数，两栏都在同一文档里（full）。
 */
export type PaneMode = "left" | "center" | "full";

export function getPaneMode(): PaneMode {
  if (typeof window === "undefined") return "full";
  const p = new URLSearchParams(window.location.search).get("pane");
  if (p === "left" || p === "center") return p;
  return "full";
}

/**
 * 写操作的归属方：left 与 full 都是 owner，center 只读 + 发命令。
 *
 * 分栏时两个文档会各自跑一遍 effect，若都执行 startRun / saveEntry / fetchHistory，
 * 同一个动作会落两次盘。归属固定在 left 侧，center 通过 store.pendingCommand 请求执行。
 */
export function isRuntimeOwner(): boolean {
  return getPaneMode() !== "center";
}

/**
 * 平台已经把当前 game slug 喂进了 iframe URL（`StandaloneExtensionIframe.tsx`
 * 多游戏切片：`?slug=<encoded>`，与 `pane` 同一份 query string），只是叙事这边
 * 从没读过它。补读出来，随后端请求带上，后端才能按请求解析出插件模式的 slug
 * （双模式路径映射，`src/runtime/artifact-root.ts`）。独立运行时没有这个参数，
 * 返回 undefined——后端据此落回独立模式，取值与迁移前完全一致。
 */
export function getActiveSlug(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("slug") ?? undefined;
}

/** 请求头名（与后端 `narrativeArtifactContextMiddleware` 约定一致）。 */
export const SLUG_HEADER = "X-Forgeax-Slug";

/**
 * 全局装一次 `window.fetch` 拦截：给发往叙事自己后端的请求补上 slug 请求头。
 * 选择在这一层拦截而不是逐个改造 ~20 处调用点——viz 里所有请求都是
 * `fetch(\`${API_BASE}/api/narrative/...\`)` 这种相对路径裸调用，没有统一的
 * 客户端封装，装一次拦截器比逐点改造改动面小得多，也不会漏改。
 */
export function installSlugFetchHeader(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __forgeaxSlugFetchInstalled?: boolean };
  if (w.__forgeaxSlugFetchInstalled) return;
  w.__forgeaxSlugFetchInstalled = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const slug = getActiveSlug();
    if (!slug || !url.includes("/api/narrative")) return nativeFetch(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(SLUG_HEADER, slug);
    return nativeFetch(input, { ...init, headers });
  }) as typeof window.fetch;
}
