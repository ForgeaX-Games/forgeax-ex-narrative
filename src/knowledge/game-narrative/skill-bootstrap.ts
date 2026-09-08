/**
 * skill-bootstrap.ts
 * ─────────────────────────────────────────────────────────────────
 * 统一在此处 side-effect import 所有 tier 索引文件，触发各 NarrativeSkill
 * 实例自动调用 registerSkill(...) 完成注册。
 *
 * 设计要点：
 *   - skill-loader.ts 仅暴露查询/注册函数，不主动导入 skill 文件，避免循环依赖。
 *   - bootstrap 文件由 step / pipeline 入口侧 import 一次即可（pipeline.ts 已包含）。
 *   - 新增 tier 或顶层 skill 集合时只需在这里多加一行 import。
 */
import "./skills/tier1/index.js";
import "./skills/tier2/index.js";
import "./skills/tier3/index.js";
import "./skills/tier4-narrative-card/index.js";

// E4: long-tail catch-all. Must run AFTER all hand-written tier skills so that
// genres with bespoke skills win over the auto-generated stubs.
import "./skills/long-tail-genres.js";

// B-M1: 同步加载 md skill（174 个 md 文件中 P0 子集 + 风格 specialist），
// 作为 ts skill 未覆盖时的 fallback。立即触发以暴露加载错误。
import { ensureMdSkillsLoaded } from "./md-skill-loader.js";
ensureMdSkillsLoaded();
