import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initLocaleSync } from "./i18n";
import { installSlugFetchHeader } from "./lib/pane";
import { applyTheme } from "./lib/theme";
import "./styles/index.css";

// 挂载前先定主题，否则会先画一帧默认色再跳。
applyTheme();
initLocaleSync();
// 双模式路径映射（M-A）：把平台喂进 iframe URL 的 slug 转成后端请求头，见
// src/lib/pane.ts 与后端 src/runtime/artifact-root.ts 的对应实现。
installSlugFetchHeader();

const pane = new URLSearchParams(location.search).get("pane");
if (pane === "left" || pane === "center") {
  document.body.setAttribute("data-pane", pane);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
