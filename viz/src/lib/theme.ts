/**
 * 主题解析：决定 `<html data-theme>` 取什么值，`fx-tokens.css` 据此换整套语义色。
 */

export type Theme = "light" | "dark";

const DARK = "(prefers-color-scheme: dark)";

/**
 * 跟随宿主外观。在 Codex 的内置浏览器里这条媒体查询反映的是 Codex 自己的外观
 * 设置而不是操作系统的——实测系统为浅色时它仍报 dark——这正是我们要的：工坊
 * 嵌在宿主里，应当跟宿主一致，而不是跟宿主之外的系统一致。
 *
 * 宿主没有表态时按浅色走，这是设计规范的默认。
 */
function hostPrefers(): Theme {
  return window.matchMedia?.(DARK).matches ? "dark" : "light";
}

/** `?theme=light|dark` 强制覆盖，给宿主显式指定和本地验收两套主题用。 */
function override(): Theme | null {
  const value = new URLSearchParams(location.search).get("theme");
  return value === "light" || value === "dark" ? value : null;
}

export function resolveTheme(): Theme {
  return override() ?? hostPrefers();
}

/** 在 React 挂载前调用，避免先渲染一帧错主题再跳色。 */
export function applyTheme(): void {
  document.documentElement.setAttribute("data-theme", resolveTheme());
  // 宿主可以在运行中切换外观，工坊得跟着走。显式指定过就不再跟随。
  if (override()) return;
  window.matchMedia?.(DARK).addEventListener("change", () => {
    document.documentElement.setAttribute("data-theme", hostPrefers());
  });
}
