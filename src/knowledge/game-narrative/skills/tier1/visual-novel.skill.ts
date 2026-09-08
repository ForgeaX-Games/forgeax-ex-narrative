/**
 * Visual Novel (adv-vn) — E2 高频品类 skill
 *
 * 适配通用 L0-L5 链：worldview / character_enrichment / outline_batch /
 * plot_generation。VN 重视分支选择、角色心理与情感节奏。
 *
 * C2（2026-08）已封存：tpl-vn 专属的 branch_tree / dialogue_script 旧 step
 * 随 vn-v1 一并搬进 `pipeline/_archive/vn-v1/`。原本注入这两个 step 的分支设计
 * 守则与对话脚本风格，业务内容原样保留，slot key 改挂到吸收后的通用大纲
 * （outline_batch）与情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const VN_WORLDVIEW = `
# 视觉小说世界观要点
- 世界观规模偏小：通常聚焦于一所学院、一座城市、一段时间
- 重要的是"日常感" + "异常元素"的反差（学院里突然出现的异变 / 平静小镇的禁忌）
- 群像 vs 主角内心：世界要为人物的相遇提供合理舞台
- 时间线必须支持回溯（玩家 reload / 多周目设计）
`.trim();

const VN_CHARACTERS = `
# 视觉小说角色塑造
- 必须存在 1 名玩家视角主角 + 3-6 名"攻略对象 / 关键角色"
- 每名关键角色独立"性格三要素"：表层标签 / 隐藏伤痕 / 转变契机
- 关系图必须为闭合：角色间存在历史 / 暗恋 / 误会 / 背叛
- 副 CP / 配角 NPC 不能多于关键角色，避免叙事失焦
`.trim();

const VN_BRANCH_STYLE = `
# VN 分支树设计守则
- 主线 = 共通线 + N 条角色个人线，结尾合流到结局
- 分支节点至少 3 类：选项 / 情感倾向积累 / 隐藏触发条件
- 每个角色个人线长度均衡，避免"一条线远比其它线深"
- 显式声明 BAD / TRUE / NORMAL 结局判定条件
`.trim();

const VN_DIALOGUE_STYLE = `
# VN 对话脚本风格
- 大量内心独白与潜台词，台词不直白
- 关键场景需要"沉默拍"（…… / 留白）调节节奏
- 每名角色说话节奏 / 用词标记差异：礼貌、直率、卡通……
- 必须给关键选项注明"此选项的语气与可能后果"，便于 UI 提示设计
`.trim();

export const VN_SKILL: NarrativeSkill = {
  genreCode: "adv-vn",
  tier: "tier1",
  matchKeywords: ["视觉小说", "VN", "美少女游戏", "Galgame", "恋爱模拟", "校园恋爱", "乙女向", "BL", "GL", "白色相簿"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: VN_WORLDVIEW } },
    character_enrichment: { slots: { character_archetype: VN_CHARACTERS } },
    outline_batch: { slots: { style_guide: VN_BRANCH_STYLE } },
    plot_generation: { slots: { style_guide: VN_DIALOGUE_STYLE } },
  },
};

registerSkill(VN_SKILL);
