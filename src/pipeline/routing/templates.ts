/**
 * Pipeline Templates — D1 降级封存后的最小活跃面（2026-08）
 * ─────────────────────────────────────────────────────────────────
 * 曾经这里是 8 个固定"管线形态"模板（`PIPELINE_TEMPLATES`）的定义本体。
 * 路由归一（mode-routing.ts）之后 template 早已不再决定步序，只剩两件事——
 *   1. 实现作用域：`resolveSeatAgents(seat, { templateId })` 用它挑该席在本品类下的实现
 *      （如 `region_design` 是场景列表席 @tpl-open-world，`vn_screenplay` 是故事情节席 @tpl-vn-v2，
 *      这两个绑定本身也已随 C3/C1 封存，仅作历史举例）；
 *   2. 历史 checkpoint 的读取键：`RunManifest.pipeline_template` 等字段仍需要这个类型
 *      才能给旧存档的 template id 做类型检查。
 * D1（2026-08）把定义本体按管线归属分流搬进了 `_archive/`：三个 RPG 模板
 * （`tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`）→ `_archive/jrpg/templates.ts`；
 * `tpl-vn-v2` → `_archive/vn-v2/templates.ts`；`tpl-vn` → `_archive/vn-v1/templates.ts`；
 * 四个品类特化模板（`tpl-open-world` / `tpl-card-game` / `tpl-fragmented` / `tpl-emergent`）
 * → `_archive/specialized/templates.ts`；其余（`tpl-narrative-card` / `tpl-light`）
 * → `_archive/templates/templates.ts`。查证过程与吸收台账见
 * [`_archive/README.md`](./_archive/README.md)。
 *
 * 活跃代码里只保留下面这一个类型——十余个模块仍 import 它做 `SeatScope.templateId` /
 * `RunManifest.pipeline_template` 一类字段的类型标注，但没有任何一处再读取
 * 对应的模板定义对象。
 */
export type PipelineTemplateId =
  | "tpl-jrpg"            // 新架构 JRPG 预制管线（V1 槽位化提示词库）；定义本体见 _archive/jrpg/templates.ts
  | "tpl-jrpg-v2"         // 归档：原精调 RPG/JRPG 管线（V2 整体提示词）；定义本体见 _archive/jrpg/templates.ts
  | "tpl-rpg"             // [DEPRECATED alias] = tpl-jrpg-v2；历史 checkpoint 兼容；定义本体见 _archive/jrpg/templates.ts
  | "tpl-vn"              // [DEPRECATED] 视觉小说/互动影游（分支树+对话脚本）— 仅兼容历史数据；定义本体见 _archive/vn-v1/templates.ts
  | "tpl-vn-v2"           // 互动影游归档精调（V2）；定义本体见 _archive/vn-v2/templates.ts
  | "tpl-open-world"      // 开放世界 RPG（区域+涌现事件）；定义本体见 _archive/specialized/templates.ts
  | "tpl-card-game"       // 卡牌游戏（卡牌 Lore + 事件池）；定义本体见 _archive/specialized/templates.ts
  | "tpl-fragmented"      // 碎片化叙事（Souls-like / Metroidvania）；定义本体见 _archive/specialized/templates.ts
  | "tpl-emergent"        // 涌现性叙事（4X / 沙盒）；定义本体见 _archive/specialized/templates.ts
  | "tpl-narrative-card"  // Tier4 叙事卡（一步生成）；定义本体见 _archive/templates/templates.ts
  | "tpl-light";          // Tier3 轻量（仅 4 步）；定义本体见 _archive/templates/templates.ts
