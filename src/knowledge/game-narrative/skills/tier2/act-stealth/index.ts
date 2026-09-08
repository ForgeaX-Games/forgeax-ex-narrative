/**
 * act-stealth — 品类叙事包（潜行动作）
 *
 * 潜行动作 = 史诗叙事型（信息差叙事）。其史诗在于"阴影中的博弈"：
 *   敌强我弱的信息差、被监视体系笼罩的世界、潜入—观察—抉择的紧张感
 *   （合金装备 / 杀手 / 耻辱）。叙事强调环境讲述与反派的全知压迫。
 *
 * 采用 RPG 七单品链（潜入任务承载 L0-L4，任务∥场景表现关卡渗透）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 潜行动作世界观原型（"被监视的世界"）
- 信息差结构：玩家是潜入者，敌方掌控地盘、人数、监控——世界观即一张需要被读懂的"敌方棋盘"
- 监视体系：摄像、巡逻、警戒等级、宵禁、阶级隔离，是世界观与玩法共用的压迫装置
- 阴影政治：阴谋、暗杀、情报战、傀儡政权——潜行者总在揭开被光鲜表象掩盖的腐败
- 环境即情报：建筑布局、守卫作息、张贴的告示，都是可被观察和利用的叙事信息
- 道德重量：杀或不杀、暴露或潜伏，世界会以"混乱值/警戒度"等形式记住玩家的手段
`.trim();

const WORLDVIEW_STYLE = `
- 语调：阴郁、克制、暗流涌动；以"被注视"的不安统御全局氛围
- 每个潜入地点须呈现"权力的空间化"（谁住高处、谁被关押、监控如何布防）
- 世界观须把"信息"做成可被玩家逐步揭开的层级（表面秩序 → 隐秘腐败 → 幕后黑手）
- 监视体系须既是玩法障碍，也是叙事压迫的来源（无处不在的眼睛）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把潜入地点写成纯关卡布局；空间须承载权力关系与可读情报
- 监视/警戒体系须同时具备玩法功能与叙事压迫双重意义
- 世界须对"潜伏 vs 杀戮"两种手段给出不同的叙事回应（结局/口碑/混乱度）
- 反派权力须有"全知错觉"：让玩家始终感到被预判、被注视
`.trim();

const CHARACTER_ARCHETYPE = `
# 潜行动作角色原型（阴影中的孤狼与全知反派）
- 主角：训练有素的潜行者/特工/刺客，沉默寡言、专业冷峻，背负被背叛或被利用的过往
- 支援者：耳机另一端的指挥/情报员，是主角行动中的声音与道德对话者
- 反派体系：金字塔式的敌方权力结构，从巡逻兵到中层军官再到幕后操盘者，层层逼近真相
- 主反派的"全知性"：仿佛预判主角每一步，常通过监控/广播/陷阱制造心理压迫
- 灰色道德：主角执行的任务未必正义，"我们究竟在为谁清除障碍"是常驻叩问
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角须有"被背叛/被利用"的过往，使其专业冷峻下藏着可被撬动的裂缝
- 支援者须承担"行动指引 + 道德对话"双职能，是主角孤独中的人声
- 反派体系须层级分明，每层揭开一点真相，主反派须维持"全知"压迫感
- 任务正义性须保留灰度，避免主角沦为无反思的工具
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 潜行动作故事框架（渗透—揭露—反转）
- L0 以"潜入任务链"铺设：受命渗透 → 逐层揭开敌方真相 → 发现自身被利用 → 反戈/揭露幕后
- 每个任务 = 一次渗透：情报简报(目标与风险) + 现场博弈(观察/潜入/抉择) + 撤离与余波(真相增量)
- 在任务间插入"情报站/安全屋"叙事段，推进与支援者的关系与道德辩论
- 设计"信任崩塌点"：主角发现任务的真实目的与被告知的不符，撼动其立场
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每个任务的"渗透目标 + 真相增量 + 道德抉择点"
- 至少设计 1 个"信任崩塌点"，让主角直面自己被当作棋子的事实
- 须为"全程潜伏不杀"与"血洗"两类玩法预留不同的叙事余波
- 终局须回应"我们在为谁服务"的叩问，给出立场清算而非简单复仇
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 潜行动作剧本写作守则（窃听·暗语·心理博弈）
- 大量"可被偷听"的敌方对话：守卫闲聊、军官通话，既给情报又塑造敌方人性
- 主角与支援者的耳语对话：简短、专业、暗含道德张力，行动中自然推进
- 反派的"如影随形"喊话：通过广播/监控喊话制造被注视的心理压迫
- 环境叙事台词化：文件、便签、审讯录音，让玩家在潜行中拼出隐秘真相
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式提示（"进入警戒状态"），警戒须转译为敌方角色的口头反应
- 可偷听对话须兼具情报价值与人物塑造，杜绝无意义的环境噪音
- 反派喊话须维持"全知"威慑，但不得剧透关键反转
- 主角寡言的性格须贯彻于台词量与口吻，不得突兀地话痨化
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："被弃特工 / 潜行动作 / 监视与背叛"
- 监视体系：全城天眼网络 + 阶级宵禁，越靠近权力中枢监控越密
- 信任崩塌点：截获的加密文件显示，派主角清除的'叛徒'其实是知情过多的同袍
- 全知反派：安全部长通过城市广播逐一念出主角的行踪，制造无处可逃的压迫
- 环境情报：审讯室录音带里，前一名潜入者临刑前供出了主角此行的真正目标
`.trim();

export const ACT_STEALTH_SKILL: NarrativeSkill = {
  genreCode: "act-stealth",
  tier: "tier2",
  matchKeywords: ["潜行", "合金装备", "杀手", "耻辱", "Metal Gear", "Hitman", "Dishonored", "潜入", "暗杀"],
  // RPG 七单品链 ②-⑦（潜入任务承载 L0-L4）
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "detailed_outline",
    "plot_generation",
    "script_generation",
    ["quest_generation", "scene_plan"],
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
        style_guide: "潜行动作角色塑造：主角是背负背叛的沉默孤狼，支援者是耳边的人声与良知，反派以全知监视制造无处可逃的压迫。",
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

registerSkill(ACT_STEALTH_SKILL);
