/**
 * ARPG (rpg-arpg) — E2 高频品类 skill
 *
 * 适配 tpl-rpg 模板，但叙事密度低于 JRPG，更重战斗节奏与世界探索。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const ARPG_WORLDVIEW = `
# ARPG 世界观
- 黑暗 / 史诗基调：世界处于衰败 / 被入侵 / 末法时代
- 区域 = 战斗节奏的语言：每个区域有独特环境敌人 + 文化注脚
- 神话 / 远古 BOSS 体系：BOSS 不只是数值大怪，更是世界观的"图腾"
- Lore 通常通过环境、物品描述、零碎对话呈现，而非长篇过场
`.trim();

const ARPG_CHARACTERS = `
# ARPG 角色
- 主角通常少言、行动派；性格通过行动展现
- 同伴较少，更多是 NPC 或商人 / 任务发起人 / 神秘指引者
- 反派 BOSS 必须有强烈视觉记忆点 + 一句"开战台词"
- 商人 NPC 也要有故事性，不只是功能 NPC
`.trim();

const ARPG_FRAMEWORK = `
# ARPG 故事框架
- 主线相对简洁，章节切分 = 区域切分
- 每个区域：进入 → 探索 → 中型敌人 → BOSS → 区域真相
- 秘密区域 / 隐藏 BOSS 提供选填层次
- 收尾：选项性结局（屠龙 / 成龙 / 第三种道路）
`.trim();

const ARPG_SCRIPT = `
# ARPG 剧本
- 战斗中的对白 = barks（短句 / 怒吼 / 受伤喘息）
- 重要剧情场景 = 长镜头独白 / 双人对峙
- 物品描述就是叙事载体：写出史诗感
- 每章必须有 1-2 处"无言场景"（环境讲故事）
`.trim();

export const ARPG_SKILL: NarrativeSkill = {
  genreCode: "rpg-arpg",
  tier: "tier1",
  matchKeywords: ["ARPG", "动作RPG", "暗黑", "Diablo", "魂系", "Dark Souls", "魔兽", "流放之路", "Path of Exile"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: ARPG_WORLDVIEW } },
    character_enrichment: { slots: { character_archetype: ARPG_CHARACTERS } },
    story_framework: { slots: { style_guide: ARPG_FRAMEWORK } },
    script_generation: { slots: { style_guide: ARPG_SCRIPT } },
  },
};

registerSkill(ARPG_SKILL);
