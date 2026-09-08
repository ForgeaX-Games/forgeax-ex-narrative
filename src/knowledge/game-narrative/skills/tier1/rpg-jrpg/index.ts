/**
 * rpg-jrpg — 品类叙事包（Phase 2/3 标杆样例）
 *
 * 目标架构（skills/<tier>/<genre>/）：
 *   index.ts   —— NarrativeSkill 定义（narrativeSteps 专属叙事段 + stepSkills 槽位索引）
 *   prompts/   —— 该品类管线上各 agent 的专属提示词（.md，完全独立，覆盖通用骨架）
 *
 * JRPG = 史诗叙事型。采用 RPG 七单品链：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# JRPG 世界观原型（"英雄之旅"地图）
- 大陆 / 多王国 / 隔绝民族结构：让"踏上旅程"自然延展为地图叙事
- 古代文明遗迹 / 沉睡神明 / 失落预言：为后续真相揭露准备伏笔
- 元素属性体系（火 / 水 / 风 / 土 / 光 / 暗 / 时空）：与 BOSS 战、装备系统呼应
- 派系冲突：帝国 vs 抵抗军 / 神殿派系 / 种族矛盾 / 资源争夺
- 必须显式描述"主角故乡"：踏上旅程前的"平凡世界"，决定第一幕情感锚点
`.trim();

const WORLDVIEW_STYLE = `
- 语调：恢弘 + 私人化并置（神话尺度的世界，回到主角故乡的暖意）
- 第一段必须给玩家一个"地理 + 神话"双锚点（本世界叫什么 / 神明留下了什么遗产）
- 让"时空背景"和"历史脉络"互相呼应（同一段神话两次回响）
- 核心冲突一定是"日常 vs 命运"或"权力体系 vs 个人选择"，避免单纯的善 vs 恶
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把世界观写成纯设定罗列；每个要素都要带"对玩家可感知的入口"（地点 / 仪式 / NPC 群体）
- 必须留出至少 1 个"导师 / 父亲形象"伏笔，用于中期牺牲弧
- 至少埋下 3 个第一幕可见的伏笔，并标注它们将在哪一幕回收
`.trim();

const CHARACTER_ARCHETYPE = `
# JRPG 角色原型（同伴 = 家人）
- 主角：从"普通人 / 故乡少年"出发，存在一段被命运钦点的弧光
- 4-8 名核心同伴，每人必须包含三要素：
  1) 与主角的情感纽带（为什么跟你走）
  2) 个人创伤 / 秘密（个人线核心）
  3) 战斗哲学（怎么看待力量 / 战斗 / 牺牲）
- 反派：必须是主角的镜像，有可以"理解（不必认同）"的动机
- 至少 1 名"导师 / 父亲形象"，预设在中期事件牺牲，激发主角成长
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的核心动机不能是"拯救世界"，必须是更私人的诉求（找回家人 / 追问身世 / 偿还代价）
- 反派的核心恐惧必须可读为主角的"如果走错一步会变成的样子"
- 每个核心同伴需声明 1 条个人线种子（一句话即可，由后续 quest 步骤展开）
`.trim();

const STORY_FRAMEWORK_STYLE = `
# JRPG 故事框架（英雄之旅节拍）
推荐 L0 框架按以下三幕节拍铺设：
- 第一幕（平凡世界）：日常 → 触发事件 → 离开故乡
- 第二幕（踏上旅程）：组队 → 地区/副本叙事 → 同伴个人线插入 → 内部危机 → 最低谷
- 第三幕（最终决战）：真相揭露 → 团队凝聚 → 决战 → 代价 / 新的起点
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 多结局存在时，BE 必须由主角"放弃同伴"或"被同伴放弃"触发；HE 必须建立在某个同伴的牺牲或顿悟之上
- L0 不能只有"主线"——必须显式标注哪些节点是"团队对话/Skit"插槽
- 最终决战前必须有"团队凝聚"节拍（一段重整士气的对话场景）
`.trim();

const SCRIPT_GENERATION_STYLE = `
# JRPG 剧本写作守则
- 多种 content 类型并用，避免单一 narration 堆砌
- 关键场景氛围模板：离别(低语+独白+远景) / 决战(紧张对话+内心独白+镜头切换) / Skit(轻快互动+回收旧梗)
- 每章必须给至少 1 名同伴 1 句"名场面台词"
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 不允许出现"游戏机制裸露"的对白（"你被毒了-3HP"），必须改写为情绪台词 + 视觉描写
- 角色情感变化必须真正改变后续场次该角色的对白基调（前后情感不矛盾）
- 关键场景的转折必须由角色弧光驱动，不是由外部事件突兀触发
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："勇者拯救世界 / JRPG / 同伴牺牲"
- 主角故乡：边境小镇被帝国焚毁
- 导师形象：父亲一辈的剑士，于第二幕中段牺牲
- 反派镜像：主角的同父异母兄长，立场=主角童年理想
- 名场面台词：导师牺牲前的"剑不该用来守护一个人，要守护一种活法"
`.trim();

export const JRPG_SKILL: NarrativeSkill = {
  genreCode: "rpg-jrpg",
  tier: "tier1",
  matchKeywords: ["JRPG", "日式RPG", "勇者", "拯救世界", "回合制RPG", "同伴", "ATB", "仙剑", "古剑奇谭", "最终幻想", "勇者斗恶龙", "女神异闻录"],
  // 专属叙事段（通用前驱 偏好→初步方案 之后）：RPG 七单品链 ②-⑦
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "item_database",        // ④
    "story_framework",      // ⑤ L0
    "outline_batch",        //   L1
    "detailed_outline",     //   L2
    "plot_generation",      //   L3
    "script_generation",    //   L4
    ["quest_generation", "scene_plan"], // ⑥任务 ∥ ⑦场景
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: FEW_SHOT_EXAMPLES,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: "JRPG 角色塑造：让每个 NPC 都自带「为什么跟主角走」的答案；战斗设定服务于角色心理。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
      },
    },
    script_generation: {
      slots: {
        style_guide: SCRIPT_GENERATION_STYLE,
        constraints: SCRIPT_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(JRPG_SKILL);
