/**
 * fps-extraction — 品类叙事包（撤离射击 / Extraction Shooter）
 *
 * 本组叙事最重（10-20%）：高风险高回报的"带货撤离"循环里，
 *   战区背景、势力阵营与装备物资共同织出碎片化战地 Lore。
 *   装备即生命，每件物资都是一段拟真而紧张的故事。
 *   代表作：逃离塔科夫 / 暗区突围 / Warzone DMZ。
 *
 * 链：[世界观 → 角色 → 道具]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 撤离射击世界观原型（被封锁的高危战区）
- 母题是"封锁区"：一片因战乱/灾变/隔离而失序的城市或地带，秩序崩塌、各方势力割据
- 核心循环即叙事：潜入战区 → 搜刮物资 → 遭遇威胁 → 携货撤离，每局都是一次有去无回的赌博
- 世界由"地图即战场"组成：港口、化工厂、地下城各有派系控制与物资分布，地点承载局势
- 拟真底色：弹道、负重、伤情、黑市经济皆写实，紧张感来自"随时可能一无所有地死去"
- 大势在幕后缓慢推进：停火、增援、新势力入场，通过任务简报与环境碎片渗透给玩家
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷硬、克制、拟真军事质感；不煽情，靠环境与简报传递沉重的真实感
- 世界观以"势力博弈 + 物资经济"铺设，让每次撤离都嵌进更大的战区局势
- 叙事碎片化：不讲完整主线，靠任务简报、无线电、尸体与遗物拼出战区全貌
- 强调风险与代价：世界要让玩家时刻感到"活着带货撤离"本身就是最大的故事
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁英雄主义叙事：这里没有救世主，只有为生存与利益博弈的个体
- 世界须服务"高风险高回报"张力，禁止削弱死亡惩罚与撤离压力的设定
- 叙事须可拆进简报、阵营与物资 Lore，不依赖线性过场推进
- 势力关系与战区局势须自洽，且为长线更新（新区、新势力）预留空间
`.trim();

const CHARACTER_ARCHETYPE = `
# 撤离射击角色原型（雇佣兵与战区群像）
- 主角：身份留白的雇佣兵/突入者，没有背景包袱，只为契约、物资与活着回家而战
- 阵营势力群像：本地武装、私人军事公司、黑市商人、维和残部，各有动机与控制区
- 接头人/商人 NPC：任务发布与黑市交易的发声口，台词冷峻务实，是战区局势的旁白者
- 敌人非脸谱化：对面也是同样为生存搏命的人或受雇者，强化"灰色战场"的拟真伦理
- 同行玩家即变量：撤离点的另一支队伍可能是猎物也可能是猎手，人即最大的不确定性
`.trim();

const CHARACTER_STYLE = `
撤离射击角色塑造：主角留白以承载玩家投射，靠阵营与商人 NPC 的冷硬台词撑起战区氛围。
人物刻画服务于"信任与背叛"的紧张感——在这里，最危险的从来不是 AI，而是另一个人。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角身份须留白，避免固定性格压制玩家的雇佣兵代入
- NPC 台词须冷峻务实、信息密度高，杜绝热血煽情或冗长抒情
- 阵营须动机鲜明且立场灰色，禁止简单的正邪二分
- 敌方塑造须保留"对面也是人"的拟真伦理，强化道德灰度
`.trim();

const ITEM_DATABASE_STYLE = `
# 撤离射击物资 Lore 守则（装备即生命，物资即故事）
- 物资分层叙事：弹药/药品/食物=生存压力，钥匙/情报文件=任务钩子，珍稀战利品=黑市价值与冒险动机
- 每件高价值战利品附"碎片 Lore"：一段来历或一张便签，暗示战区里曾发生过什么（失踪的科学家、被洗劫的金库）
- 装备拟真化命名与描述：型号、产地、磨损度、改装潜力，让"摸到一把好枪"本身成为叙事高光
- 钥匙与情报承载空间叙事：一把房卡指向一个上锁房间的故事，奖励敢于深入高危区的玩家
- 物资的"得失感"即叙事核心：带出去是战利品传奇，死在原地则成为下一个玩家搜到的遗物
- 黑市经济讲战区生态：物价波动、稀缺品流通，暗示幕后势力的供需与战局走向
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯数值堆砌：值得记忆的战利品必须带一段来历或一张战地便签
- 物资 Lore 须与战区势力、地图局势自洽，杜绝设定错位
- 任务道具（钥匙/情报）须指向具体的空间故事，不得沦为抽象收集物
- 须强化物资的"高风险高回报"得失感，禁止削弱掉落即遗失的紧张设定
`.trim();

export const FPS_EXTRACTION_SKILL: NarrativeSkill = {
  genreCode: "fps-extraction",
  tier: "tier3",
  matchKeywords: ["撤离射击", "extraction shooter", "逃离塔科夫", "tarkov", "dmz", "暗区突围"],
  narrativeSteps: ["worldview", "character_enrichment", "item_database"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: CHARACTER_STYLE,
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
  },
};

registerSkill(FPS_EXTRACTION_SKILL);
