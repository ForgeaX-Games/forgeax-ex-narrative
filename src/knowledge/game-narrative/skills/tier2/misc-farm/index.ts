/**
 * misc-farm — 品类叙事包（农场 / 庄园经营）
 *
 * 农场/庄园 = 运营叙事型（田园治愈 + 村民关系网 + 季节活动）。以"星露谷 / 符文工房"为代表：
 * 没有强戏剧冲突，叙事核心是"治愈的田园日常 + 可深交的村民群像 + 顺应季节的活动循环"。
 * 村镇与村民为长期资产，按季节/版本产出节日活动、村民事件与剧情小片段。
 *
 * 采用运营叙事链（精简）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 故事框架(季节循环) → 任务(日常/季节活动)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 农场/庄园世界观原型（"被时光温柔包裹的小村镇"）
- 治愈田园基调：远离都市喧嚣，回归土地、四季与人情的慢生活
- 一座有记忆的村镇：村镇有它的历史、传说与待修复的旧物(社区中心/老磨坊)
- 四季循环为骨：春耕、夏长、秋收、冬藏——季节决定作物、活动与村镇节律
- 人与自然共处：田地、森林、矿洞、海港各有产出与季节性变化，构成生活舞台
- 温柔的悬念层：村镇藏着小秘密(精灵/古老约定/失落的家族故事)，可被慢慢发掘
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温暖、治愈、生活化；以散文般的笔触描绘四季流转与村镇的呼吸
- 世界观以"村镇地图 + 四季节律"呈现，每个地点绑定其产出、人物与季节风物
- 强调"慢"与"日常的美"：没有紧迫危机，魅力来自细节、人情与时间的累积
- 为版本扩充留口：新地点/新村民/新节日可作为新季节内容自然接入
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 须坚守治愈田园基调，禁止引入打破宁静的重度暴力/末世冲突
- 季节循环须自洽：作物、活动、村镇节律须与四季逻辑一致
- 每个地点须自带季节性产出与人情入口，杜绝纯背景板
- 须为新地点/新村民/新节日的版本扩充留出接口，禁止写死封闭村镇
`.trim();

const CHARACTER_ARCHETYPE = `
# 农场/庄园角色原型（可深交的村民关系网）
- 主角：从都市疲惫归来/继承祖辈庄园的新住民，在村镇中重建生活与归属
- 村民群像：各有职业、性格与生活烦恼的邻里，构成可长期相处的关系网
- 可攻略/可深交对象：部分村民有多层好感事件，随相处逐步揭开内心与过往
- 关系网而非主角中心：村民彼此之间也有亲缘/友谊/嫌隙，村镇是"活的社群"
- 温柔的成长弧：村民各有未竟心愿(梦想/和解/失落)，玩家的陪伴成为转机
`.trim();

const CHARACTER_CONSTRAINTS = `
- 村民须各具鲜明职业/性格且彼此区隔，禁止千人一面的工具人
- 好感事件须随相处渐进解锁，杜绝一次性把人物内心倾倒
- 村民之间须存在自洽的关系网(亲缘/友谊/嫌隙)，让村镇像活的社群
- 角色烦恼/心愿须落在生活化尺度，禁止强行拔高为宏大戏剧冲突
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 农场/庄园故事框架（季节循环 + 村民事件链）
- 主线以"季节循环"承载：四季轮转 = 天然的章节结构，每季有其主题与节律
- 村镇复兴主线：以修复社区设施/重振村镇为温柔长线目标，串起各季活动
- 村民事件链：每位村民一条可渐进推进的心愿/羁绊事件线，随好感与季节展开
- 版本/季节新篇：每个季节或版本引入新节日、新事件、新村民，扩充生活内容
- 留白与日常并重：剧情不抢戏，给玩家自由经营与品味日常的空间
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 故事框架须服务"治愈日常"，禁止强加紧迫的危机驱动节奏
- 季节循环须作为天然章节，事件与节日须与所在季节自洽
- 村民事件链须渐进且可独立推进，新玩家任意季节接入皆可成立
- 版本/季节新篇须与既有村镇/村民设定一致，长期资产前后连续
`.trim();

const QUEST_GENERATION_STYLE = `
# 农场/庄园任务设计（日常 / 季节活动 / 村民委托）
- 日常任务：种植、养殖、采集、烹饪、社交的生活循环，文案轻盈带烟火气
- 季节活动任务：顺应四季的节日庆典(春之花祭/秋之丰收节)，全村参与的温暖盛事
- 村民委托：村民提出的生活化请求(送礼/帮忙/寻物)，借机推进好感与羁绊事件
- 村镇复兴任务：阶段性的设施修复/振兴目标，把长线经营做成可感的成就
- 版本节日任务：新增季节/版本节日活动，配套限定剧情、装饰与纪念奖励
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 日常任务文案须轻盈生活化，禁止高压催促式的目标设计
- 季节活动须与所在季节主题强绑定，营造全村参与的温暖氛围
- 村民委托须服务好感/羁绊推进，奖励与人情味并重而非纯资源发放
- 版本节日须与世界观季节循环自洽，长期资产(村民/村镇)保持一致
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："星露谷式农场经营 / 治愈田园 / 村民羁绊"
- 世界观：继承祖父的'晨雾谷'庄园，四季流转的小村镇，待修复的老社区中心
- 村民群像：木讷的渔夫、爱抱怨却心软的杂货店老板娘、藏着画家梦的酒馆少女
- 季节活动：秋之'丰收市集'，全村摆摊评选最佳作物，赢家可点亮村镇广场的祈愿灯
- 村民委托：替孤独的老木匠寻回他亡妻留下的旧怀表，解锁一段温柔回忆
`.trim();

export const MISC_FARM_SKILL: NarrativeSkill = {
  genreCode: "misc-farm",
  tier: "tier2",
  matchKeywords: ["农场", "庄园", "符文工房", "星露谷", "stardew valley", "牧场物语", "经营模拟", "田园"],
  // 运营叙事链（精简）：世界观 → 角色 → 故事框架(季节循环) → 任务(日常/季节活动)
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
        style_guide: "农场/庄园角色塑造：村民是可深交的长期资产，各具鲜明职业性格、好感事件渐进解锁，彼此构成自洽关系网，心愿落在生活化尺度。",
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

registerSkill(MISC_FARM_SKILL);
