/**
 * region-design.ts (F2)
 * ─────────────────────────────────────────────────────────────────
 * 开放世界 RPG 区域设计：把世界观拆为可探索的区域单元。
 * 每个区域含：地理特征、势力归属、关键 NPC、特色任务/事件钩子。
 *
 * 使用 PromptComposer 模式，开放世界 / 区域强叙事品类的 skill 通过
 * region_design.slots.* 注入地理风格、势力规则、密度要求。
 *
 * C3（2026-08）已封存：不再被任何活跃代码 import。业务功能（区域地理/势力/
 * 危险等级/narrative_hooks）吸收进通用 `lore_generation`，形态差异交给
 * `network.md` 结构卡；needs 门控（原 needs.E>=2 或 needs.Q>=2）改由品类
 * skill 选择承担。详见 `../README.md` 吸收台账。
 */
import type { NarrativeContext } from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { type PromptComposer } from "../../runtime/prompt-composer.js";
import { runUniversalAgent } from "../universal-agent/index.js";
import { createComposerCapability } from "../universal-agent/universal-narrative.js";

const ROLE = `你是开放世界 RPG 区域设计师。基于世界观结构，把世界拆为 5-10 个可探索区域。`;

const TASK = `## 任务
- 每个区域必须有清晰的"地理 / 文化 / 势力 / 危险等级"四要素
- 区域之间存在地理与势力关联（连接拓扑图清晰，避免孤岛）
- 至少包含 1 主城、1 起点、2 关键地标、3 探索区
- narrative_hooks 要勾起好奇心，避免空泛`;

const STYLE_PLACEHOLDER = `## 区域设计风格
{{SKILL.style_guide}}`;

const FACTION_PLACEHOLDER = `## 势力体系守则
{{SKILL.faction_rules}}`;

const DENSITY_PLACEHOLDER = `## 内容密度 / 关卡规模
{{SKILL.density_rules}}`;

const CONSTRAINTS_PLACEHOLDER = `## 硬性约束
{{SKILL.constraints}}`;

const OUTPUT_FORMAT = `## 输出格式（严格 JSON）
{
  "regions": [
    {
      "id": "REG_01",
      "name": "区域名（中文）",
      "type": "city|village|wilderness|dungeon|landmark|ruin",
      "biome": "生物群系（如：温带森林/沙漠/雪山）",
      "factions": ["势力1", "势力2"],
      "key_npcs": ["NPC1", "NPC2"],
      "narrative_hooks": ["钩子1（短句）", "钩子2"],
      "danger_level": 1-10,
      "atmosphere": "氛围描述（1句）",
      "connections": ["相邻区域ID"]
    }
  ]
}`;

const USER_CONTEXT = (ctx: NarrativeContext): string => {
  const wv = ctx.worldview_structure
    ? JSON.stringify(ctx.worldview_structure).slice(0, 2000)
    : "（无世界观）";
  return `## 世界观摘要\n${wv}\n\n## 用户原始需求\n${ctx.user_input}\n\n请输出区域设计 JSON。`;
};

const REGION_DESIGN_COMPOSER: PromptComposer = {
  stepId: "region_design",
  blocks: {
    role: ROLE,
    task: TASK,
    style: STYLE_PLACEHOLDER,
    faction: FACTION_PLACEHOLDER,
    density: DENSITY_PLACEHOLDER,
    constraints: CONSTRAINTS_PLACEHOLDER,
    output_format: OUTPUT_FORMAT,
    user_context: USER_CONTEXT,
  },
  systemBlockOrder: [
    "role",
    "task",
    "style",
    "faction",
    "density",
    "constraints",
    "output_format",
  ],
  userBlockOrder: ["user_context"],
  skillSlots: ["style_guide", "faction_rules", "density_rules", "constraints"],
};

/**
 * B-M4: 通过 universal-agent 框架执行。
 *
 * 启用条件：needs.E >= 2 或 needs.Q >= 2（开放世界类必跑；点状任务/无任务品类跳过）
 * 输出字段：ctx.regions（数组）
 */
export const regionDesignCapability = createComposerCapability<unknown[]>({
  id: "region_design",
  description: "开放世界区域设计",
  needsKeys: ["E", "Q"],
  minNeed: 2,
  composer: REGION_DESIGN_COMPOSER,
  outputField: "regions",
  temperature: 0.7,
  parse: (raw) => {
    const parsed = extractJSON<{ regions?: unknown[] }>(raw);
    return Array.isArray(parsed?.regions) ? parsed.regions : [];
  },
});

export async function regionDesign(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  await runUniversalAgent(
    {
      stepId: "region_design",
      name: "RegionDesignAgent",
      outputField: "regions",
      capabilities: [regionDesignCapability],
      aggregate: (results) =>
        Array.isArray(results[0]?.output) ? (results[0]?.output as unknown[]) : [],
      emptyFallback: () => [],
      evaluator: { disabled: true },
    },
    ctx,
    llm,
  );

  // 结构清理：区域连接是无向邻接图（避免孤岛）。算法去重 + 删指向不存在区域的悬空
  // 连接 + 对称化（A↔B），并对孤立区域告警。对正常产出基本为 no-op。
  if (Array.isArray(ctx.regions)) reconcileRegions(ctx.regions);
}

/**
 * 区域邻接图清理：去重 / 删悬空连接 / 对称化 / 孤岛告警。
 * 纯算法、就地修改，不调 LLM。
 */
function reconcileRegions(regions: unknown[]): void {
  type RegionLike = { id?: string; name?: string; connections?: string[] };
  const list = regions as RegionLike[];
  const ids = new Set(list.map((r) => r?.id).filter((x): x is string => typeof x === "string"));

  // 1) 去重 + 删悬空/自环连接
  for (const r of list) {
    if (!Array.isArray(r.connections)) {
      r.connections = [];
      continue;
    }
    const seen = new Set<string>();
    r.connections = r.connections
      .map((c) => String(c))
      .filter((c) => {
        if (!ids.has(c) || c === r.id || seen.has(c)) return false;
        seen.add(c);
        return true;
      });
  }

  // 2) 对称化：A 连 B ⟹ B 也连 A
  const byId = new Map(list.map((r) => [r.id, r] as const));
  for (const r of list) {
    for (const c of r.connections ?? []) {
      const other = byId.get(c);
      if (!other) continue;
      if (!Array.isArray(other.connections)) other.connections = [];
      if (r.id && !other.connections.includes(r.id)) other.connections.push(r.id);
    }
  }

  // 3) 孤岛告警（report-only）
  const isolated = list.filter((r) => (r.connections?.length ?? 0) === 0).map((r) => r.id ?? "?");
  if (isolated.length > 0) {
    console.warn(`[region-qa] 检测到孤岛区域（无连接）: ${isolated.join(", ")}`);
  }
}
