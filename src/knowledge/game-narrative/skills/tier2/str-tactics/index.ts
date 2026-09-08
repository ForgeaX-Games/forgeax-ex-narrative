/**
 * str-tactics — 品类叙事包（战棋 / Tactics）
 *
 * 战棋 Tactics = 史诗叙事型（战术编年史）。区别于 SRPG 偏角色养成的"软"群像，
 * Tactics 更强调"严苛战术 + 残酷世界观 + 政治阴谋"：以小队在乱世中艰难求存为主轴，
 * 战场抉择与立场博弈塑造一段冷峻的编年史（陷阵之志 / Tactics Ogre 一脉）。
 *
 * 采用 RPG 七单品链（战术任务承载 L0-L4，任务∥场景表现战役）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 战棋 Tactics 世界观原型（"乱世求存的政治泥潭"）
- 残酷乱世：王朝倾覆、内战连绵、种族/阶级压迫——世界观冷峻，没有轻松的胜利
- 政治阴谋为骨：联姻、叛变、清洗、宗教操弄，战场只是政治博弈的延伸
- 立场即代价：玩家小队夹在多方势力间，每次站队都意味着与另一方为敌
- 战术地形即叙事：高地、桥梁、城墙、伏击点，地形优劣与战局生死直接挂钩
- 道德的灰度深渊：英雄难存清白，正义常需以肮脏手段达成，呼应"乱世无净土"
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻、沉重、政治化；以编年史般的笔触记录乱世的残酷与无奈
- 每场战役须绑定"政治背景 + 战术意义 + 道德代价"
- 势力格局须复杂可博弈：多方角力，无绝对正义方，玩家须在夹缝中权衡
- 世界观须为"严苛抉择"供给土壤：胜利往往伴随失去与妥协
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁简化为善恶对决；各方势力须各有正当诉求与肮脏手段
- 每场战役须有明确的政治动因与道德重量，杜绝为战而战
- 世界须对玩家的立场抉择给出真实而残酷的后果（盟友反目/路线封锁）
- 战术地形须能转化为剧情张力（守不住的桥、必失的高地），而非纯数值背景
`.trim();

const CHARACTER_ARCHETYPE = `
# 战棋 Tactics 角色原型（乱世中的小队群像）
- 主角：被卷入乱世的青年/落魄贵族，在残酷抉择中逐渐认清"理想与现实的鸿沟"
- 小队成员：来历各异的同行者（雇佣兵/逃亡者/理想主义者/复仇者），各有立场与软肋
- 关键政治人物：枭雄、伪善的圣职者、忠义难全的旧友，构成博弈网络
- 反派往往是"另一种正义"：其手段残酷却有可辩护的乱世逻辑，与主角立场对撞
- 小队内部分歧：成员间因路线/立场产生裂痕乃至离队，是 Tactics 群像的张力来源
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的成长须体现"理想被现实反复淬炼"的弧光，而非天真到底
- 小队成员须各自携带可被乱世撕裂的立场/软肋，为分歧与离队埋种子
- 反派须可被理解为"另一种乱世逻辑下的正义"，避免脸谱化暴君
- 关键抉择须导致角色阵营的真实变动（加入/离队/反目），后果可感知
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 战棋 Tactics 故事框架（路线分歧 + 战役编年）
- L0 以"政治路线 + 战役链"铺设：卷入乱世 → 势力站队(路线分歧点) → 理想受挫/盟友背叛 → 终局清算
- 设计"路线分歧抉择"：关键节点的站队会导向不同的战役序列与结局
- 每场战役 = 战前政治简报 + 战中战术博弈(地形/兵种/增援) + 战后政治余波
- 终局须冷峻而克制：胜利往往伴随失去，给出关于权力与代价的沉重落点
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每场战役的"政治动因 + 战术地形意义 + 道德代价"
- 至少设计 1 个"路线分歧抉择"，导向互斥的战役序列与结局
- 抉择须有不可逆后果（封锁路线/损失角色），杜绝无痛分支
- 终局须自洽于乱世基调，避免廉价的大团圆
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 战棋 Tactics 剧本写作守则（政治博弈 + 战场抉择）
- 战前简报写出"政治赌注"：为何而战、与谁为敌、胜负的政治后果
- 战中触发台词紧扣战术局势（增援抵达、地形争夺、关键单位濒危），冷峻有力
- 政治对话讲究机锋与博弈：谈判、威逼、试探，字字藏锋
- 抉择时刻的台词须呈现真实两难，让玩家承担乱世中"没有干净选项"的重量
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式台词（"地形加成+20%"），须转译为将领对战局的判断口吻
- 战中触发台词须绑定具体战术情境，不能是通用喊话
- 政治对话须推进博弈或揭示立场，杜绝无信息的寒暄
- 抉择台词须呈现真实代价，禁止把残酷选择写成轻飘的二选一
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："内战站队 / 战棋 Tactics / 理想与背叛"
- 政治格局：三方混战——正统王党、改革派贵族、被压迫民兵，皆有正当诉求与污点
- 路线分歧点：是否在桥头之战放弃民兵以换取贵族军援，决定后半程阵营与结局
- 反派逻辑：改革派领袖以铁血清洗推行'必要之恶'，是主角理想的黑暗倒影
- 战场抉择：唯一能守住的退路桥梁若炸毁，可保主力却葬送殿后的旧友小队
`.trim();

export const STR_TACTICS_SKILL: NarrativeSkill = {
  genreCode: "str-tactics",
  tier: "tier2",
  matchKeywords: ["战棋", "tactics", "陷阵之志", "Into the Breach", "Tactics Ogre", "战术", "战略棋盘"],
  // RPG 七单品链 ②-⑦（战术任务承载 L0-L4）
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
        style_guide: "战棋 Tactics 角色塑造：主角在乱世中被现实反复淬炼，小队群像各怀立场软肋；反派是另一种乱世逻辑的正义，抉择带来真实阵营变动。",
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

registerSkill(STR_TACTICS_SKILL);
