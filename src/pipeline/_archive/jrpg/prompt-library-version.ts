/**
 * prompt-library-version.ts — 封存快照（A3，2026-08）
 *
 * 原位于 `src/types/run-manifest.ts`。退役理由与查证过程见
 * [`./README.md`](./README.md) 第四节：`promptLibraryForTemplate` 只按模板 id
 * 后缀分支，而三个 RPG 模板共用同一份步序与 `PromptComposer`，从没有真正的
 * 「V2 精调整体提示词」与之对应；全仓也没有任何生产逻辑读取它分支执行。
 *
 * 本文件只为保留退役前的原貌以便复核，**不再被任何活跃代码 import**。
 * `RunManifest.promptLibrary` 字段本身仍保留在 `run-manifest.ts`（类型改为
 * 字面量 `"v1" | "v2"`），继续读取历史 manifest；新建 manifest 一律写 `"v1"`。
 */
import type { PipelineTemplateCode } from "../../../types/run-manifest.js";

/** V1=槽位化新库按需组装；V2=精调整体调用。 */
export type PromptLibraryVersion = "v1" | "v2";

export function promptLibraryForTemplate(code: PipelineTemplateCode): PromptLibraryVersion {
  // V2 归档族：*-v2 + 历史 tpl-rpg（= tpl-jrpg-v2 别名）
  if (code.endsWith("-v2") || code === "tpl-rpg") return "v2";
  // 新架构朴素代号（tpl-jrpg / tpl-vn / …）→ V1 槽位化库
  return "v1";
}
