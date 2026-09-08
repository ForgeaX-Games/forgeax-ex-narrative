/**
 * str-slg — 品类叙事包（SLG 策略手游）
 *
 * SLG 策略手游 = 运营叙事型。以"率土之滨 / 万国觉醒 / 三国志战略版"为代表：
 * 大地图 + 同盟 + 赛季制。叙事不是线性主线，而是"历史底座 + 势力群像 + 赛季史诗"：
 * 世界观与名将为长期资产，每个赛季围绕一段历史/主题产出剧情、武将与事件。
 *
 * 采用运营叙事链（精简）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 故事框架(赛季史诗) → 任务(赛季/同盟)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# SLG 世界观原型（"群雄并起的历史沙盘"）
- 历史底座：以真实历史/演义为根（三国、战国、中世纪列国），赋予厚重感与代入感
- 大地图即叙事舞台：州郡、关隘、资源带、要塞——地理格局决定势力博弈与剧情焦点
- 多势力并立：诸侯/王国/部族各据一方，群雄逐鹿是世界观的第一性原理
- 玩家即"主公/领主"：从一城一地起家，世界观须支撑"白手起家→问鼎天下"的野望
- 同盟 = 玩家自组织的势力：世界观须为"玩家结盟、攻城、外交"提供历史化的合理叙事
`.trim();

const WORLDVIEW_STYLE = `
- 语调：厚重、史诗、权谋感；以史家笔法铺陈天下大势与群雄格局
- 世界观须围绕"分裂—争霸—一统"的历史循环展开，呼应赛季制的开荒到终局
- 地理与势力须互为表里：每个区域绑定其历史势力、战略价值与可争夺的剧情焦点
- 为"玩家同盟"预留历史叙事接口：结盟、会盟、讨伐皆可套用历史化的仪式与名分
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 历史改编须尊重大众认知底线：核心人物立场/著名事件不可魔改至失真
- 世界观须服务"群雄博弈"，禁止设定单一绝对霸主而扼杀玩家争霸空间
- 大地图须呈现可争夺的战略纵深（资源/关隘/要地），杜绝纯背景板
- 须为赛季轮换留口：世界格局可按赛季主题重置/换皮，不写死唯一终局
`.trim();

const CHARACTER_ARCHETYPE = `
# SLG 角色原型（可收集的历史名将群像）
- 武将是核心长期资产：以历史名将为蓝本（三国五虎、战国名将），人设须贴合史评
- 每名武将 = 立绘 + 阵营/势力 + 史实定位 + 一段精炼传记 + 标志性台词
- 君主/诸侯群像：曹操、刘备、孙权式的势力领袖，承载阵营理念与外交张力
- 名将羁绊网：以历史关系（君臣/兄弟/宿敌/师承）织成羁绊，服务编队与剧情
- 留"赛季限定/异闻"叙事位：以"假如""异史"形式推出新形态武将，延展长线收集
`.trim();

const CHARACTER_CONSTRAINTS = `
- 历史武将的性格/立场须贴合主流史评与演义形象，禁止颠覆性魔改
- 每名武将须有可独立阅读的精炼传记，并标注其历史阵营与代表战役
- 羁绊须基于真实历史关系建立，杜绝无来由的强行组队
- 赛季限定/异史形态须明确标注"非正史设定"，与正传武将区隔，避免认知混乱
`.trim();

const STORY_FRAMEWORK_STYLE = `
# SLG 故事框架（赛季史诗 + 群雄编年）
- 主线以"赛季"为单位：每赛季围绕一段历史时期/主题（如官渡、赤壁、群雄割据）展开
- 赛季叙事三段式：开荒期(乱世初定) → 争霸期(同盟混战) → 终局(天下一统/赛季清算)
- 以"史实事件"为剧情锚点：把著名战役/政治事件转化为赛季中的全服联动事件
- 群雄编年：用编年体记录本赛季天下大势，让玩家的同盟行为嵌入"历史叙事"
- 长线主题轮转：赛季主题逐期切换，世界观底座不变、剧情焦点与武将阵容更新
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 赛季剧情须与"开荒→争霸→终局"的运营节奏对齐，叙事服务赛季周期
- 史实事件改编须保留历史骨架，仅在演绎层做戏剧化，禁止颠覆结局走向
- 须为"玩家同盟改写历史"留出叙事空间（谁一统由玩家博弈决定），避免剧情写死赢家
- 赛季主题切换须保持世界观底座一致，杜绝设定自相矛盾
`.trim();

const QUEST_GENERATION_STYLE = `
# SLG 任务设计（赛季 / 同盟 / 史实事件任务）
- 主公成长任务：开荒期引导"建城→征兵→招将→拓土"，文案带历史代入感
- 赛季任务链：随赛季阶段推进的阶段目标（占郡、夺关、问鼎），绑定赛季叙事
- 同盟任务：围绕"会盟、协攻、守城、外交"的集体目标，强化同盟社交与史诗感
- 史实联动事件：以著名战役为蓝本的全服限时事件（如"赤壁火攻"），配套限定奖励
- 武将招募/养成任务：把名将获取嵌入剧情，让"集齐名将"成为叙事驱动的目标
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 赛季任务须严格对齐赛季阶段节奏，避免与开荒/终局周期错位
- 同盟任务须以集体协作为核心，文案突出"势力博弈"而非单人英雄叙事
- 史实联动事件须忠于历史战役骨架，演绎可夸张但走向不可背离常识
- 任务奖励须服务长期资产积累（名将/资源/势力），与世界观/赛季主线保持一致
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："三国争霸 / SLG 策略手游 / 赛季制同盟战"
- 世界观底座：东汉末年群雄割据，十三州大地图，关隘资源皆可争夺
- 本赛季主题：'官渡之变'——袁曹对峙，开荒期争河北，终局问鼎中原
- 名将群像：曹操(权谋枭雄)、荀彧(王佐之才)、关羽(义绝)，史评定位+羁绊网
- 同盟任务：会盟讨董式全服事件，盟军协攻虎牢关，达成可领限定武将'吕布·飞将'
`.trim();

export const STR_SLG_SKILL: NarrativeSkill = {
  genreCode: "str-slg",
  tier: "tier2",
  matchKeywords: ["slg", "策略手游", "率土之滨", "万国觉醒", "三国志战略版", "赛季制", "同盟", "大地图"],
  // 运营叙事链（精简）：世界观 → 角色 → 故事框架(赛季史诗) → 任务(赛季/同盟)
  narrativeSteps: ["worldview", "character_enrichment", "story_framework", "quest_generation"],
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
        style_guide: "SLG 角色塑造：武将是以历史名将为蓝本的长期资产，人设贴合史评、羁绊基于真实历史关系；君主群像承载阵营理念，赛季限定形态须标注非正史。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
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

registerSkill(STR_SLG_SKILL);
