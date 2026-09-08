/**
 * sim-social — 品类叙事包（社交模拟 / Social Simulation）
 *
 * 社交模拟 = 涌现叙事型。叙事由「人际关系网 + 欲望与日常戏剧」涌现：
 * 没有主线，故事来自一群小人物在生活中相爱相杀、追逐欲望、经历悲喜
 * （模拟人生 / 梦想小镇 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → plot_generation（涌现事件生成）
 *
 * C3（2026-08）已封存：原品类特化 step `emergent_event` 吸收进通用 `plot_generation`，
 * 本品类的事件分类配比/触发平衡守则改为以 skill 形式挂载在 plot_generation 的
 * style_guide / constraints 槽位上，形态差异交给 network/emergent/fragmented 结构卡表达。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 社交模拟 世界观原型（"生活本身就是剧场"）
- 世界 = 一片关系交织的生活社区：街区、小镇、公寓楼，邻里抬头不见低头见
- 日常即舞台：上班、约会、聚会、争吵、搬家，琐碎生活就是叙事的全部素材
- 人际关系网是核心系统：好感、暧昧、宿怨、亲情在人群中持续流动重组
- 欲望驱动行为：每个居民都怀揣需求（爱情/事业/财富/认同），追逐时碰撞出戏剧
- 没有反派只有人性：冲突源于欲望错位与误会，而非善恶对立
`.trim();

const WORLDVIEW_STYLE = `
- 语调：生活流 + 轻喜剧，偶尔渗出温情或苦涩，像一部市井群像剧
- 开局铺好"关系网的初始张力"：谁暗恋谁、谁与谁有旧怨、谁正陷入困境
- 让日常场所（咖啡馆/公园/职场）成为关系发酵的天然容器
- 把生活的鸡毛蒜皮升华为可回味的人情戏
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写成静态人物表；关系网须随互动持续动态重组（疏远/亲密/反目）
- 每个居民须有明确的"核心欲望"作为行为引擎，让戏剧有内在动因
- 至少铺设 2 组结构性人际张力（三角恋/世仇/职场竞争）作为事件温床
- 冲突须根植于人性与欲望错位，杜绝脸谱化的善恶对立
`.trim();

const CHARACTER_ARCHETYPE = `
# 社交模拟 角色原型（鲜活的市井众生）
- 居民群像：每人有性格特质 + 核心欲望 + 关系坐标，构成可自运转的社交生态
- 关系角色：恋人、家人、邻居、同事、宿敌——彼此的存在定义了对方的故事
- 玩家 = 生活的牵线者：可推动也可旁观，居民即便无玩家介入也在过自己的日子
- 搅局者/催化角色：八卦邻居、魅力新人、麻烦亲戚，为平静社区投下涟漪
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每个居民须有独立议程：无论玩家是否介入，都在追逐自己的欲望
- 关系须由互动累积决定，不预设固定好感度，禁止静态人设
- 角色对同一事件的反应须由其性格与欲望差异化，避免千人一面
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 社交模拟 涌现事件池（分类配比）
- 关系事件（约 32%）：表白、分手、和好、背叛、结婚生子——人际关系网的核心戏剧
- 欲望事件（约 22%）：升职、暴富、梦想受挫、需求未满的崩溃——欲望驱动的转折
- 日常事件（约 20%）：聚会、搬家、宠物、节日、邻里纠纷——生活质感的积累
- 戏剧事件（约 14%）：误会、绯闻、家庭风波、突发意外——制造冲突与笑料
- 社区事件（约 12%）：新人入住、社区活动、八卦传播——重塑整片关系网
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取关系网状态与居民欲望，让每段人生故事独一无二
- 戏剧须从关系张力中自然引爆，而非凭空降临的随机闹剧
- 八卦/绯闻类事件须沿关系网传导扩散，体现"系统讲故事"
- 每个抉择/互动须改写关系坐标与欲望进度，后果在社区中持续涟漪
- 悲喜须均衡：温情与苦涩交替，避免一味甜宠或一味狗血
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 生活流轻喜剧：以细腻又带笑意的笔触捕捉市井烟火与人情冷暖
- 描述发生了什么与众生反应，把"如何介入"留给玩家
- 善用关系视角的对照："邻居们都说他们是天造地设，只有她自己知道哪里不对劲。"
- 重大关系事件给一句温情或苦涩的生活注脚，留白回味
`.trim();

export const SIM_SOCIAL_SKILL: NarrativeSkill = {
  genreCode: "sim-social",
  tier: "tier2",
  matchKeywords: ["社交模拟", "模拟人生", "梦想小镇", "social sim", "The Sims", "人际模拟"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
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
        style_guide: "社交模拟角色塑造：居民有性格 + 核心欲望 + 关系坐标，各怀独立议程自运转；关系由互动累积，玩家是牵线者亦可旁观。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(SIM_SOCIAL_SKILL);
