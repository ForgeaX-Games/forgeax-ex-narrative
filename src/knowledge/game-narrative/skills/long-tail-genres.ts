/**
 * Long-tail genre catch-all (E4) + Planning skill augment (B-M6 / D13-A)
 * ─────────────────────────────────────────────────────────────────
 * 双职责：
 *   1. catch-all：对没有手写 *.skill.ts 的长尾品类，注册一个 stub skill。
 *   2. planning augment（B-M6 新增）：对所有 94 品类，把 D0-D4 五个策划 step 的
 *      stepSkill 补齐——其中手写品类做"合并补充"（不覆盖已有 step），长尾品类
 *      作为完整 stub 的一部分注册。
 *
 * 派生策略（基于 GENRE_TAXONOMY 的 needs 矩阵 + keywords + narrative_ratio）：
 *   - core_concept (D0)         ← 偏好/品类核心理念守则
 *   - system_architecture (D1)  ← 系统架构选型守则（按 needs 维度强调）
 *   - system_detail (D2)        ← 系统细节风格（保守，避免和现有 D2 注入打架）
 *   - value_framework (D3)      ← 数值/经济曲线守则
 *   - design_doc (D4)           ← 策划案整合守则
 *
 * Hand-written skills always take precedence — `registerSkill` overwrites
 * older entries, so we run this AFTER the per-tier skill files are loaded.
 */
import type { NarrativeSkill, StepSkillBlock } from "../skill-types.js";
import { registerSkill, loadSkill } from "../skill-loader.js";
import { GENRE_TAXONOMY } from "../../genre-taxonomy.js";
import { deriveNarrativeSteps, ensurePlotChainForConsumers } from "./narrative-steps-defaults.js";

const NEED_LABEL: Record<string, string> = {
  W: "世界观",
  C: "角色",
  S: "剧情结构",
  D: "对话",
  Q: "支线任务",
  E: "环境叙事",
  I: "物品叙事",
  U: "UI文案",
  L: "Lore碎片",
};

function describeNeeds(needs: Record<string, number>): string {
  const core = Object.entries(needs).filter(([, v]) => v >= 3).map(([k]) => NEED_LABEL[k] ?? k);
  const recommended = Object.entries(needs).filter(([, v]) => v === 2).map(([k]) => NEED_LABEL[k] ?? k);
  const parts: string[] = [];
  if (core.length) parts.push(`核心维度（★★★）：${core.join(" / ")}`);
  if (recommended.length) parts.push(`推荐维度（★★）：${recommended.join(" / ")}`);
  if (!parts.length) return "（无明确叙事维度需求，按品类常识自由展开）";
  return parts.join("；");
}

/**
 * 基于 needs 与品类信息构造 D0-D4 五个策划 step 的 stepSkill。
 *
 * 与叙事侧（worldview / character_enrichment / ...）的 stub 不同，策划侧
 * step（D0-D4）当前用 `buildSkillSystemPrompt` 直接读 `systemPromptAddition`，
 * 不走 PromptComposer 的 slots，所以 stub 的内容写在 `systemPromptAddition`
 * 字段即可被 buildSkillSystemPrompt 拼到 system prompt 末尾。
 */
/**
 * 从 narrative_ratio 字符串（如 "60-85%" / "20-40%"）中提取下界小数（0.0-1.0）。
 * 解析失败时返回 0（按"无叙事"处理，安全回退）。
 */
function parseNarrativeRatioLow(raw: string): number {
  const match = /(\d+)\s*-\s*\d+\s*%/.exec(raw) ?? /(\d+)\s*%/.exec(raw);
  if (!match) return 0;
  const n = Number.parseInt(match[1], 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n / 100));
}

function buildPlanningStepSkills(entry: typeof GENRE_TAXONOMY[number]): {
  core_concept: StepSkillBlock;
  system_architecture: StepSkillBlock;
  system_detail: StepSkillBlock;
  value_framework: StepSkillBlock;
  design_doc: StepSkillBlock;
} {
  const needs = entry.needs as Record<string, number>;
  const high = (k: string) => (needs[k] ?? 0) >= 3;
  const med = (k: string) => (needs[k] ?? 0) === 2;
  const ratioLow = parseNarrativeRatioLow(entry.narrative_ratio);

  const ratioLabel =
    ratioLow >= 0.7
      ? "重叙事（70%+ 叙事占比）"
      : ratioLow >= 0.4
        ? "中叙事（40-70% 叙事占比）"
        : ratioLow >= 0.2
          ? "轻叙事（20-40% 叙事占比）"
          : "极轻叙事（<20% 叙事占比，叙事仅作点缀）";

  const header = `# ${entry.name}（${entry.code}）品类策划守则
- 类别: Tier ${entry.tier} · ${ratioLabel}
- 关键词: ${entry.keywords.slice(0, 8).join(" / ")}
- ${describeNeeds(entry.needs)}`;

  const coreConcept = `${header}

## D0 核心概念取舍
- 主玩法循环必须围绕 ${high("S") || high("D") ? "剧情体验" : high("Q") ? "任务/支线" : high("E") ? "环境探索" : "玩法机制"} 展开
- ${ratioLow >= 0.5 ? "叙事 hook（钩子）必须在前 5 分钟出现" : "玩法乐趣必须在前 30 秒可感知；叙事可作为长期目标"}
- 品类典型卖点：${entry.keywords.slice(0, 3).join(" / ")}
- 严禁出现与该品类核心受众期待严重冲突的设定（例如硬核策略品类不要主打"轻量休闲"）`;

  const systemArchitecture = `${header}

## D1 系统架构选型
- ${high("E") ? "环境/区域系统是必须项（地图、生物群系、势力分布）" : "环境系统按品类必要程度选配"}
- ${high("Q") ? "任务系统需要支持主线 + 多支线 + 涌现事件" : "任务系统按线性主线为主，支线按需"}
- ${high("D") ? "对话系统优先级 P0：分支对话、情感反馈、好感度" : "对话系统按线性 NPC 对白即可"}
- ${high("U") ? "UI 系统需要重点设计：信息层级、运营文案、玩家引导" : "UI 系统按基础需求设计，重点保证清晰"}
- 推荐生成顺序：先核心玩法系统 → 表现层系统 → 经济/成长系统 → 社交/运营系统`;

  const systemDetail = `${header}

## D2 系统细节风格
- 系统设计粒度：${entry.tier === "tier1" ? "细致到子模块（每个系统 5-8 个子模块）" : entry.tier === "tier2" ? "中等粒度（每个系统 3-5 个子模块）" : "极简粒度（每个系统 1-3 个核心特性）"}
- 数据结构：${high("I") || med("I") ? "支持物品/装备/卡牌的丰富 metadata（rarity/tags/lore）" : "保持轻量，避免过度设计"}
- 系统间交互：${high("Q") || high("S") ? "重视事件总线 + 任务管理器的解耦" : "线性调用为主，避免过度抽象"}`;

  const valueFramework = `${header}

## D3 数值框架取向
- 经济模型：${high("Q") ? "多货币 + 多渠道获取/消耗（任务奖励 / 商店 / 战利品）" : entry.tier === "tier4" ? "单一货币或无经济（关卡分数为主）" : "双货币（软+硬）即可"}
- 成长曲线：${high("C") || high("S") ? "支持长期角色养成（等级 + 装备 + 技能 + 好感度）" : ratioLow < 0.3 ? "扁平曲线，关卡难度递增即可" : "中等长度的成长线"}
- 战斗数值：${entry.keywords.some((k) => /战斗|combat|action|射击|fps|tps/i.test(k)) ? "需要详细的伤害公式 + 抗性 + 暴击体系" : entry.keywords.some((k) => /回合|turn-based/i.test(k)) ? "需要明确的回合资源管理（行动点/MP/CP）" : "简化数值，重点在体验"}
- 难度曲线：${entry.tier === "tier1" ? "前期友好，中期分流，后期高挑战；可选挑战内容拉长游戏寿命" : "线性递增，避免劝退"}`;

  const designDoc = `${header}

## D4 策划案整合守则
- 必须显式说明：核心受众画像（年龄/平台/品类期待）
- 与同品类标杆对比：${entry.keywords.slice(0, 2).join(" / ")} 等关键词需要与至少 2 款标杆作品对比，列出差异点
- 风险评估：${ratioLow >= 0.7 ? "重叙事品类要评估写作工作量（每章字数预算）" : "重玩法品类要评估关卡数量（关卡设计师工时）"}
- 章节结构：${entry.tier === "tier1" ? "包含「核心概念→系统设计→数值→剧情→运营」5 大块" : entry.tier === "tier4" ? "可省略剧情大块，重点写「玩法→关卡→运营」" : "保留全部 5 大块但每块控制在 1-2 页"}`;

  return {
    core_concept: { systemPromptAddition: coreConcept },
    system_architecture: { systemPromptAddition: systemArchitecture },
    system_detail: { systemPromptAddition: systemDetail },
    value_framework: { systemPromptAddition: valueFramework },
    design_doc: { systemPromptAddition: designDoc },
  };
}

function makeStubSkill(entry: typeof GENRE_TAXONOMY[number]): NarrativeSkill {
  const planning = buildPlanningStepSkills(entry);
  // 叙事侧不再注入通用 summary stub。无专属 skill 的品类会通过
  // skill-loader 的四级回退链自动命中 archetype 共享基线（Layer 3），
  // 比之前"品类概要当 style_guide"的 stub 内容质量高得多。
  // 此处只保留策划侧 D0-D4，因为策划管线没有 archetype 回退。
  const stub: NarrativeSkill = {
    genreCode: entry.code,
    tier: entry.tier,
    matchKeywords: entry.keywords,
    // 原型族默认专属叙事段：让 Planner 第一步即可定位完整管线（覆盖全长尾品类）。
    narrativeSteps: deriveNarrativeSteps(entry),
    stepSkills: {
      core_concept: planning.core_concept,
      system_architecture: planning.system_architecture,
      system_detail: planning.system_detail,
      value_framework: planning.value_framework,
      design_doc: planning.design_doc,
    },
  };
  return stub;
}

/**
 * B-M6 / D13-A：对已有手写 skill 的品类，合并补充 D0-D4 五个策划 step 的 stepSkill。
 *
 * 不覆盖手写 skill 已有的 stepSkills（包括叙事侧）；只补 D0-D4 中尚未提供的项。
 * 这避免了"手写 7 个高频品类全部 D0-D4"的人工成本，但仍然让所有品类的 D0-D4
 * 注入率从 0% → 100%（手写补全可作为 M6.1 的 P1 后续优化）。
 */
/**
 * 道具归一化：道具（item_database）在多数品类承载叙事，不应被遗漏。
 * 当品类 needs.I>=1 且链中尚无 item_database 时，自动插在 character_enrichment 之后
 * （无角色则插在 worldview 之后），让"道具不被忽略"贯穿全部手写链。
 * 通过 needs 门控实现"自适应裁剪"——纯无物品品类（I=0）不强插。
 */
function ensureItemInChain(
  steps: Array<string | string[]>,
  needs: Record<string, number>,
): Array<string | string[]> {
  if ((needs.I ?? 0) < 1) return steps;
  const has = steps.some((s) => (Array.isArray(s) ? s.includes("item_database") : s === "item_database"));
  if (has) return steps;
  const idxChar = steps.findIndex((s) => s === "character_enrichment");
  const idxWv = steps.findIndex((s) => s === "worldview");
  const at = idxChar >= 0 ? idxChar + 1 : idxWv >= 0 ? idxWv + 1 : -1;
  if (at < 0) return steps; // 无 worldview/character 锚点，不强插，避免破坏特化链
  const out = [...steps];
  out.splice(at, 0, "item_database");
  return out;
}

function augmentPlanningSkills(existing: NarrativeSkill, entry: typeof GENRE_TAXONOMY[number]): NarrativeSkill {
  const planning = buildPlanningStepSkills(entry);
  const planningSteps = ["core_concept", "system_architecture", "system_detail", "value_framework", "design_doc"] as const;
  const merged: NarrativeSkill = {
    ...existing,
    stepSkills: { ...existing.stepSkills },
  };
  for (const step of planningSteps) {
    if (!merged.stepSkills[step]) {
      merged.stepSkills[step] = planning[step];
    }
  }
  // 未显式声明 narrativeSteps 的手写 skill：补齐原型族默认专属叙事段，
  // 让 Planner Step 0 对其同样生效（旗舰品类若已声明则保留原值）。
  if (!merged.narrativeSteps) {
    const derived = deriveNarrativeSteps(entry);
    if (derived) merged.narrativeSteps = derived;
  } else {
    // 已声明的手写链：先归一化注入道具（needs.I>=1 且缺失时），
    // 再闭合情节脊柱（含 quest/script 却缺 plot 时补齐上游，避免静默空产物）。
    const withItem = ensureItemInChain(merged.narrativeSteps, entry.needs as Record<string, number>);
    merged.narrativeSteps = ensurePlotChainForConsumers(withItem);
  }
  return merged;
}

let bootstrapped = false;

/**
 * Idempotent bootstrap. 双职责：
 *   1. 对没有手写 skill 的长尾品类，注册完整 stub（含叙事 + 策划 step）。
 *   2. 对已有手写 skill 的品类，合并补充 D0-D4 五个策划 step（不覆盖既有项）。
 *
 * Safe to call multiple times.
 */
export function ensureLongTailSkillsRegistered(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  let added = 0;
  let augmented = 0;
  for (const entry of GENRE_TAXONOMY) {
    const existing = loadSkill(entry.code);
    if (existing) {
      // 已有手写 skill — 仅补齐 D0-D4 缺失项
      const merged = augmentPlanningSkills(existing, entry);
      // 仅当新增了 step 或补齐了 narrativeSteps 时才重新注册（避免不必要的覆盖）
      const beforeKeys = Object.keys(existing.stepSkills).length;
      const afterKeys = Object.keys(merged.stepSkills).length;
      const addedNarrativeSteps = !existing.narrativeSteps && !!merged.narrativeSteps;
      const normalizedSteps =
        !!existing.narrativeSteps &&
        JSON.stringify(existing.narrativeSteps) !== JSON.stringify(merged.narrativeSteps);
      if (afterKeys > beforeKeys || addedNarrativeSteps || normalizedSteps) {
        registerSkill(merged);
        augmented += 1;
      }
      continue;
    }
    registerSkill(makeStubSkill(entry));
    added += 1;
  }
  if (added > 0 || augmented > 0) {
    // eslint-disable-next-line no-console
    console.log(`[skill] Registered ${added} long-tail genre stubs; augmented ${augmented} hand-written skills with D0-D4 stepSkills`);
  }
}

ensureLongTailSkillsRegistered();
