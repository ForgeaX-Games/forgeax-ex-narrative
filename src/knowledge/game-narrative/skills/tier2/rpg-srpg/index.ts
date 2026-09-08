/**
 * rpg-srpg — 品类叙事包（SRPG / 战棋 RPG）
 *
 * SRPG = 史诗叙事型（战略叙事）。其史诗在"战争群像 + 战役章节 + 永久死亡"：
 *   故事以一场场战役推进，每个可操作单位都是有名有姓的角色，
 *   战场即叙事舞台，胜负与牺牲共同塑造编年史（火焰纹章 / 三角战略）。
 *
 * 采用 RPG 七单品链（以战役章节承载 L0-L4）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# SRPG 世界观原型（"战争编年史"）
- 战争史诗：以国家/势力间的战争为主轴，世界观即一张可供征伐的地缘政治版图
- 章节即战役：每一章对应一场战役/一座城池/一道关隘，地图本身承载叙事意义
- 大义与立场：忠诚、背叛、王权正统、解放与征服，是战棋叙事的核心母题
- 军团群像：玩家麾下是一支有名有姓、各怀往事的杂牌军，世界观须给每人来历的土壤
- 战略层世界观：粮道、地形、季节、援军等"沙盘要素"应能转化为剧情张力
`.trim();

const WORLDVIEW_STYLE = `
- 语调：庄重、史诗、带战争的悲悯；以编年史口吻铺陈势力兴衰
- 每场战役须绑定一个"战略目标 + 道义重量"（为何而战、代价几何）
- 地缘格局须清晰：哪几股势力、为何开战、玩家阵营处于何种劣势/转机
- 世界观要为"单位即角色"留好接口：每支部队的来历可挂接到势力史中
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把战争写成纯背景板；每场战役须有独立的战略动机与道义张力
- 势力须避免脸谱化：敌国亦有可敬之将与不得已之战，为劝降/反正埋伏笔
- 世界观须支撑"局势逆转"叙事（劣势开局 → 关键战役 → 反攻），而非一路碾压
- 战略要素（地形/补给/季节）须能在剧情中转化为戏剧抉择，而非纯数值
`.trim();

const CHARACTER_ARCHETYPE = `
# SRPG 角色原型（军团群像 + 永久死亡的重量）
- 主君/主角：年轻的领袖/流亡贵胄，在战争中学习"以何种代价换取胜利"
- 麾下群像：大量可招募单位，每人须有出身、参军动机、与他人的关系网（支援对话土壤）
- 永久死亡的叙事化：角色阵亡须有分量，鼓励"为保全同伴而战"的情感投入
- 敌将：可敬的对手、可被劝降的故人、忠于暴君的悲剧者，构成立场的灰度
- 群像关系网：同袍情谊、阵营内部分歧、跨阵营羁绊，是支援对话与个人线的来源
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每个核心单位须声明 1 条可在支援对话中展开的关系/往事种子
- 主君的抉择须不断面对"牺牲少数保全大局"与"不弃一兵"的两难
- 永久死亡的角色须在后续剧情留下可被感知的缺席（他人提及/遗物/空位）
- 敌将须至少有一名可被理解或劝降，避免阵营整体脸谱化
`.trim();

const STORY_FRAMEWORK_STYLE = `
# SRPG 故事框架（战役链 + 编年节拍）
- L0 以"战役章节链"铺设：开局劣势 → 转折之战 → 内部危机/背叛 → 总反攻 → 终战与新秩序
- 每章 = 一场战役：战前布局(动机/对手) + 战中转折(援军/伏击/牺牲) + 战后清算(局势变化/角色去留)
- 在战役之间插入"营地/行军"低强度叙事段，承载支援对话与人物关系推进
- 设计"道义抉择章"：某场战役的胜利须以违背初心为代价，撼动主君信念
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每场战役的"战略目标 + 道义重量 + 可能的牺牲/招募节点"
- 至少设计 1 场"惨胜/抉择之战"，让胜利附带不可挽回的代价
- 营地叙事段须显式预留支援对话与个人线插槽，平衡战争的沉重
- 终战须回应主君全程的成长，给出关于权力与代价的清醒落点
`.trim();

const SCRIPT_GENERATION_STYLE = `
# SRPG 剧本写作守则（战前·战中·支援对话）
- 三类文本分写：战前动员(立场与赌注) / 战中触发台词(援军到来、敌将现身、单位阵亡) / 营地支援对话(关系升温)
- 战中台词须随战局动态触发，简短有力，强化临场感与角色个性
- 阵亡台词须有分量与个性，让永久死亡真正刺痛玩家
- 支援对话写出"战火间隙的人情味"，是群像血肉的主要来源
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式台词（"命中率85%"），数值须转译为战场口吻的判断与决断
- 战中触发台词须与具体战况绑定，不能是放之四海皆可的通用喊话
- 阵亡台词须因角色而异，体现其性格与未竟之事，杜绝复用模板
- 支援对话须推进关系或揭示往事，不得是无信息增量的闲聊
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："流亡王子复国 / SRPG / 群像与牺牲"
- 战役链：失国夜逃(教学战) → 借兵雇佣团(转折战) → 旧臣叛投敌国(内部危机) → 王都总攻(终战)
- 抉择之战：为夺取粮仓需火攻平民村落——胜则续命，败则全军饿殍
- 敌将灰度：镇守王都的老将曾是先王托孤之臣，可劝降亦可死战
- 阵亡余响：护主战死的近卫，其空着的营帐床位在后续章节始终无人入住
`.trim();

export const SRPG_SKILL: NarrativeSkill = {
  genreCode: "rpg-srpg",
  tier: "tier2",
  matchKeywords: ["srpg", "战棋", "火焰纹章", "三角战略", "战棋rpg", "Fire Emblem", "Triangle Strategy", "策略角色扮演"],
  // RPG 七单品链 ②-⑦（以战役章节承载 L0-L4）
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
        style_guide: "SRPG 角色塑造：麾下是有名有姓的军团群像，永久死亡赋予牺牲以重量；敌将须有灰度，支援对话承载人情。",
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

registerSkill(SRPG_SKILL);
