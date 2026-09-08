/**
 * spt-mgmt — 品类叙事包（体育管理 / Sports Management）
 *
 * 涌现叙事型（中等叙事 20-35%）：玩家是经理而非球员，叙事生于赛季节律、
 * 球员成长曲线、转会博弈与更衣室人际之中。数据是底座，戏剧从数据缝隙里长出来
 * （足球经理 Football Manager）。
 *
 * 管理链：通用前驱(偏好→初步方案) +
 *   [世界观 → 角色 → 资产清单 → L0框架 → 大纲批次 → 任务]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 体育管理世界观原型（"以赛季为心跳的竞技生态"）
- 经理视角：玩家不上场，而是俱乐部的掌舵者——战术板、转会桌、新闻发布会是你的战场
- 赛季即叙事单位：夏窗→季前→联赛/杯赛多线→冬窗→冲刺→收官，时间结构自带起承转合
- 竞技生态自运转：对手俱乐部、球探网络、媒体舆论、球迷情绪构成会呼吸的联盟世界
- 数据驱动的真实感：身价、状态、伤病、合同年限是世界的"物理法则"，戏剧在其约束下涌现
- 多层级野心：保级队的求生、中游队的逆袭、豪门的王朝，不同处境给不同的叙事基调
- 代表母题：小球会以弱胜强的童话、名帅重建王朝、临危受命的救火
`.trim();

const WORLDVIEW_STYLE = `
- 语调：专业、克制、带体育专栏式的临场感；激情藏在数据与战报之下
- 世界观以"联盟格局 + 俱乐部处境 + 赛季日历"三件套铺设
- 媒体与球迷舆论作为世界的"回声"：胜负会激起头条、更衣室与看台的连锁反应
- 设定须为长线经营留接口：青训、财政、声望可逐季积累成俱乐部的命运弧
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 须严守经理视角，杜绝把玩家写成上场球员的第一人称热血叙事
- 竞技生态须可自运转（对手转会、争冠混战），玩家是参与者而非唯一主角
- 戏剧须在数据约束内生长（身价/状态/伤病合理），杜绝违背体育逻辑的奇迹
- 赛季日历须清晰，叙事节奏须挂靠真实赛程而非随意编排
`.trim();

const WORLDVIEW_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："低级别联赛保级队 / 体育管理 / 草根逆袭"
- 联盟格局：财大气粗的两支队垄断升级名额，你的小球会被预测垫底
- 俱乐部处境：预算捉襟见肘，主力老化，球场是漏雨的社区旧场
- 赛季钩子：冬窗租借一名被豪门弃用的天才，能否点燃保级奇迹成为全季悬念
`.trim();

const CHARACTER_ARCHETYPE = `
# 体育管理角色原型（更衣室群像与生态人物）
- 经理（玩家）：留白的掌舵者，性格由用人/战术/发布会抉择定义（铁腕、慈父、谋略家）
- 球员群像：当家球星、暴脾气天才、忠诚老将、待证明的新秀，各有性格、野心与合同诉求
- 更衣室人际：派系、领袖、刺头、士气连锁——人际关系直接影响竞技表现，是核心叙事场
- 转会桌对手：精明的对方主帅、难缠的经纪人、虎视眈眈的豪门球探，是博弈的活体对手
- 场外声部：董事会的成绩压力、媒体的捧杀与唱衰、球迷的爱憎，构成经理的舆论环境
`.trim();

const CHARACTER_STYLE = `
体育管理角色塑造：经理留白以承载玩家治队风格；球员用"球场角色 + 性格标签 + 合同/野心诉求"立住，
让更衣室成为戏剧发动机。经纪人、董事会、媒体作为场外声部，把竞技成绩翻译成人际与舆论张力。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 经理须留白，性格交由玩家的用人与抉择塑造，杜绝固定人设
- 球员须带性格 + 野心 + 合同诉求三要素，避免只有数值的提线木偶
- 更衣室人际须能反作用于竞技表现（士气/派系），不做无后果的背景闲聊
- 场外人物（董事会/经纪人/媒体）须动机鲜明，杜绝纯功能性弹窗
`.trim();

const ITEM_DATABASE_STYLE = `
# 体育管理资产 Lore 守则（球员/合同/资产即可叙事资源）
- 此处"资产"指球员、合同、青训苗子、球探报告等俱乐部可叙事的核心资源
- 球员档案即微传记：出身、绰号、巅峰之战、伤病史、性格短评，让数据卡有血有肉
- 合同是戏剧契约：年限、解约金、续约僵局、忠诚条款，每份合同都藏着转会戏的引信
- 球探报告带叙事悬念："下一个巨星"或"高价水货"，把签人变成一场赌局
- 俱乐部资产承载历史：荣誉室、退役球衣、传奇教练雕像，是俱乐部认同感的叙事锚
- 青训苗子是未来线：天赋评级 + 成长故事，把"养成"做成跨赛季的情感投资
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 球员/资产须兼具数据功能与微叙事，杜绝纯属性卡片
- 合同条款须可触发转会/续约戏剧，避免无故事价值的纯数字
- 球探报告须带不确定性叙事（赌注感），不做确定无误的标准答案
- 俱乐部历史资产须与其声望/处境自洽，杜绝错位的荣誉设定
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 体育管理故事框架（赛季弧线骨架）
- L0 以"赛季弧线"铺设：转会期建队立意 → 季初磨合 → 多线赛程的起伏 → 关键战役 → 收官定调
- 用"目标 vs 处境"制造主线张力：董事会的成绩要求与现有阵容实力的落差就是核心冲突
- 埋若干"赛季戏剧锚"：当家球星的转会风波、新秀的成名战、宿敌德比、伤病危机
- 框架须支持多赛季延展：本季的种子（青训/引援/恩怨）在来季开花，形成王朝/重建长弧
`.trim();

const STORY_FRAMEWORK_EXAMPLES = `
# L0 赛季弧线风味示例
## 主题："临危受命的救火主帅"
- 立意：球队半程垫底、主帅下课，你空降接手一支离心离德的更衣室
- 季中起伏：靠重用边缘球员打出连胜，却因核心球星闹转会再陷动荡
- 关键战役：直接保级对手的六分之战，胜则希望重燃，负则提前判刑
- 收官定调：末轮绝杀保级 / 遗憾降级，都将决定夏窗是重建还是解散
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须挂靠真实赛季日历，杜绝脱离赛程的随意章节
- 主线张力须源于"目标与处境的落差"，而非外挂的戏剧事件
- 须预埋可跨赛季延展的种子，避免单季封闭、无长线的孤立故事
- 赛季戏剧锚须由竞技逻辑驱动，杜绝违背体育常理的强行剧情
`.trim();

const OUTLINE_BATCH_STYLE = `
# 体育管理大纲批次守则（赛季事件素材库）
- 大纲产出"可由赛季状态触发的事件模块"：连败危机、夺冠冲刺、转会闹剧、更衣室哗变
- 每个模块绑定触发条件（战绩/士气/合同状态/赛程节点），由数据局势激活
- 模块须可复用、可重入：同类"球星索要加薪"事件在不同球员身上应能套用
- 优先批量产出"涌现引信"：状态低迷、伤病潮、媒体风波等可反复发生的赛季戏剧骨架
`.trim();

const OUTLINE_BATCH_CONSTRAINTS = `
- 大纲须以"赛季状态触发的事件模块"组织，杜绝强制线性章节
- 每个模块须声明触发条件与可复用对象，避免一次性写死的孤立桥段
- 事件须由竞技/经营数据驱动，禁止与赛季局势脱节的空降戏
- 须覆盖不同处境（保级/争冠/重建），杜绝只服务单一目标的偏科大纲
`.trim();

const QUEST_GENERATION_STYLE = `
# 体育管理任务守则（经理决策型"委托"）
- 任务即经理面前的决策情境：处理闹转会的球星、安抚被弃用的老将、回应董事会的最后通牒
- 任务源于赛季状态：战绩、士气、合同、舆论的变化自然催生需要经理拍板的情境
- 多解优先：同一危机可用沟通/罚款/出售/妥协等多路径应对，结果各异，无标准答案
- 任务结果反作用于俱乐部：影响士气、更衣室派系、声望与未来转会，制造长尾涟漪
- 任务发布者是活人：球星、经纪人、董事、队医各有立场，决定了情境的难度与代价
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 任务须由赛季状态驱动，杜绝与竞技/经营脱节的孤立跑腿
- 关键决策须提供多解路径与差异化后果，禁止唯一正确解
- 任务结局须对俱乐部产生可感知反馈（士气/派系/声望），不做无后果的功能格
- 须保留两难取舍（即时成绩 vs 长远建设），避免非黑即白的简单选项
`.trim();

export const SPT_MGMT_SKILL: NarrativeSkill = {
  genreCode: "spt-mgmt",
  tier: "tier2",
  matchKeywords: ["体育管理", "足球经理"],
  // 管理链：世界观 → 角色 → 资产清单 → L0框架 → 大纲批次 → 任务
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "quest_generation",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: WORLDVIEW_EXAMPLES,
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
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        examples: STORY_FRAMEWORK_EXAMPLES,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
      },
    },
    outline_batch: {
      slots: {
        style_guide: OUTLINE_BATCH_STYLE,
        constraints: OUTLINE_BATCH_CONSTRAINTS,
      },
    },
    quest_generation: {
      slots: {
        style_guide: QUEST_GENERATION_STYLE,
        constraints: QUEST_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(SPT_MGMT_SKILL);
