/**
 * Tier3 Light Template (tpl-light) — F4 共享 skill 默认值
 *
 * 适配 tier3 大部分品类的轻量管线（initial_plan + worldview + character）。
 * 这里提供一组可被多个 tier3 品类直接复用的 fallback slots：当具体品类没有专属
 * skill 时，long-tail 自动 catch-all 会把品类元数据填进这些 slots。
 *
 * 同时给几个高频 tier3 品类（spt-sim / cas-puzzle / race-sim / rpg-idle）做轻量
 * 示例 skill，验证 tpl-light 模板端到端可跑。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const LIGHT_WORLDVIEW = `
# 轻量管线世界观要点
- 不需要史诗设定；专注 1 个明确的世界主题（运动 / 解谜 / 放置 / 经营）
- 时间空间感可弱化：让玩家专注玩法循环，叙事服务玩法
- 1-3 句即可定基调（如：「未来都市的小型电竞世界」）
`.trim();

const LIGHT_CHARACTER = `
# 轻量管线角色塑造
- 1 名玩家角色（可为完全自定义的"无名之辈"）+ 2-3 名显著 NPC
- 每个 NPC 一个标签即可（教练 / 老板 / 对手），不强求人物弧光
- 角色服务于游戏机制：让 UI 文案、教学有"声音"
`.trim();

function makeLightSkill(
  genreCode: string,
  tier: NarrativeSkill["tier"],
  matchKeywords: string[],
  flavor: string,
): NarrativeSkill {
  return {
    genreCode,
    tier,
    matchKeywords,
    stepSkills: {
      worldview: { slots: { worldview_archetype: `${LIGHT_WORLDVIEW}\n\n## 品类风味\n${flavor}` } },
      character_enrichment: { slots: { character_archetype: LIGHT_CHARACTER } },
    },
  };
}

const SKILLS: NarrativeSkill[] = [
  makeLightSkill(
    "spt-sim",
    "tier3",
    ["体育模拟", "FIFA", "NBA2K", "实况足球"],
    "聚焦体育竞技：俱乐部 / 队伍 / 球员，时事感强（赛季 / 转会窗）。",
  ),
  makeLightSkill(
    "cas-puzzle",
    "tier3",
    ["休闲解谜", "纪念碑谷", "Candy Crush"],
    "解谜世界要「小而美」：单关卡内自洽，不需要跨关卡叙事。",
  ),
  makeLightSkill(
    "race-sim",
    "tier3",
    ["赛车", "竞速", "极限竞速", "GT赛车"],
    "赛车世界 = 改装文化 + 街道 / 赛道 / 拉力 三类舞台。",
  ),
  makeLightSkill(
    "rpg-idle",
    "tier3",
    ["放置RPG", "挂机RPG", "剑与远征"],
    "放置 RPG：英雄群像 + 永恒战争背景；故事推进靠章节式短章。",
  ),
  makeLightSkill(
    "fps-tactical",
    "tier3",
    ["战术射击", "彩虹六号", "CS"],
    "战术射击世界 = 反恐 / 特警 / 私军三类主题，强调专业感与简短对话。",
  ),
];

for (const s of SKILLS) registerSkill(s);

export const TIER3_LIGHT_SKILLS = SKILLS;
