/**
 * templates.ts — 封存快照（D1，2026-08）
 *
 * 原 `pipeline/templates.ts` 里"其余"两个模板的定义——`tpl-narrative-card`
 * （Tier4 叙事卡，一步生成）与 `tpl-light`（Tier3 轻量管线）。这两个 id 不属于
 * 三条精心设计过的老管线（jrpg / vn-v2 / vn-v1）也不属于四个品类特化模板
 * （specialized），单独归在这里。也承载原 `PIPELINE_TEMPLATES` 的公共外壳
 * （`PipelineTemplate` 接口形状、`getPipelineTemplate`/`resolveTemplateSteps`
 * 两个查表函数）——见本文件底部说明为何这两个函数未随文件本体一起保留为
 * 可运行代码。
 *
 * 本文件不再被任何活跃代码 import。`PipelineTemplateId` 类型本身仍保留在
 * 活跃的 `../../templates.ts` 里（历史 checkpoint 读取键），两个 id 字面量
 * 继续可用。
 */
import { STEP_IDS as S } from "../../routing/modes.js";
import type { PipelineTemplateId } from "../../routing/templates.js";

interface ArchivedPipelineTemplate {
  id: PipelineTemplateId;
  label: string;
  description: string;
  steps: Array<string | string[]>;
  optionalSteps?: string[];
  tiers: Array<"tier1" | "tier2" | "tier3" | "tier4">;
}

const PREF = [S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS];
const BASE = [...PREF, S.INITIAL_PLAN, S.WORLDVIEW];

export const OTHER_TEMPLATES: Record<"tpl-narrative-card" | "tpl-light", ArchivedPipelineTemplate> = {
  "tpl-narrative-card": {
    id: "tpl-narrative-card",
    label: "叙事卡（Tier4）",
    description: "Tier4 极简：narrative_card 一步生成",
    tiers: ["tier4"],
    steps: [S.NARRATIVE_CARD],
  },

  "tpl-light": {
    id: "tpl-light",
    label: "轻量管线（Tier3）",
    description: "Tier3 大部分品类：偏好 → 初步方案 → 世界观 → 角色",
    tiers: ["tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
    ],
  },
};

/**
 * 原 `getPipelineTemplate(id)` / `resolveTemplateSteps(id, enableOptionalSteps)`
 * 未随本文件一起保留为可运行代码：两者都是对完整 `PIPELINE_TEMPLATES` 单一大表
 * 的查表函数（`getPipelineTemplate` 直接 `PIPELINE_TEMPLATES[id]`；
 * `resolveTemplateSteps` 在此基础上拼接 `optionalSteps`），而 D1 按管线归属把
 * 那张大表拆成了五份，分散在 `jrpg/` / `vn-v2/` / `vn-v1/` / `specialized/` /
 * 本目录。重新拼一份跨目录查表函数只会制造一个从未被使用过的假象——全仓
 * 查证确认这两个函数在 D1 之前就已零生产调用点（`PIPELINE_TEMPLATES` /
 * `getPipelineTemplate` / `resolveTemplateSteps` 只在 `templates.ts` 自身与
 * 已随 D1 一并封存的两个 planner 测试文件里出现）。原实现逻辑很简单，直接摘录
 * 在此供查证，不再作为代码维护：
 *
 * ```ts
 * function getPipelineTemplate(id) {
 *   const tpl = PIPELINE_TEMPLATES[id];
 *   if (!tpl) throw new Error(`Unknown pipeline template: ${id}`);
 *   return tpl;
 * }
 *
 * function resolveTemplateSteps(templateId, enableOptionalSteps = []) {
 *   const tpl = getPipelineTemplate(templateId);
 *   if (!enableOptionalSteps.length || !tpl.optionalSteps?.length) return [...tpl.steps];
 *   const enable = new Set(enableOptionalSteps.filter((s) => tpl.optionalSteps.includes(s)));
 *   if (enable.size === 0) return [...tpl.steps];
 *   const out = [...tpl.steps];
 *   for (const opt of enable) out.push(opt);
 *   return out;
 * }
 * ```
 */
