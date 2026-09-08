/**
 * adv-life-sim — 品类叙事包（生活叙事冒险 / 日常系泣系 / Tier2 重叙事）
 *
 * 叙事占比 70-85%：几乎没有"敌人"，戏剧来自平凡日常里被慢慢擦亮的羁绊，以及
 * 终将到来的离别。四季流转是情感的容器，前期越温柔治愈，后期的催泪越有力。
 * "笑着相遇，哭着告别"是这一品类的灵魂。
 *   代表作：CLANNAD / AIR / Kanon（Key 社催泪三部曲） / 各类日常系(slice of life)泣系作品。
 *
 * 分支叙事链：通用前驱 + [世界观 → 角色 → 道具 → 大纲 → 情节 → 剧本]
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本 / 电影化分镜三段专属 step 随 vn-v1
 * 一并搬进 `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到
 * 吸收后的通用大纲（outline_batch）/ 情节（plot_generation）/
 * 剧本（script_generation）席位上（下游 composer 仅消费 style_guide /
 * constraints / examples 三个槽位，原分镜专属的镜头语言与 QTE 守则并入
 * style_guide）。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 生活叙事冒险世界观原型（温柔的小镇与四季）
- 舞台是有体温的小世界：宁静小镇、海边町、学园与家——平凡到让人想守护
- 四季流转是情感骨架：春的相遇、夏的灿烂、秋的转折、冬的离别，时间本身在叙事
- 日常即奇迹：上学路、社团、家庭餐桌的琐碎被珍重地描绘，平凡处自有光
- 隐性的"奇迹/超自然"薄薄一层：幻想世界、家族秘密、命运的羁绊，点到为止地托起主题
- 世界温柔但不回避丧失：疾病、别离、成长的代价是底色，治愈与悲伤并存
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温暖、细腻、克制；用大量生活细节铺垫，把情感慢慢煨热
- 让四季与天气成为情绪语言（樱花、蝉鸣、初雪），景物即心境
- 前期尽量治愈日常，为后期的离别与泪点蓄能——反差越大越催泪
- 奇迹/超自然元素服务"羁绊与告别"主题，绝不喧宾夺主
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 保持生活化、小尺度舞台，严禁宏大冒险冲淡日常的细腻质感
- 四季/时间流转须贯穿全程，作为情感推进的容器而非背景板
- 超自然元素须为主题服务且节制，不可沦为奇观或战斗装置
- 悲伤与治愈须并存且有铺垫，杜绝为催泪而强行制造的悲剧
`.trim();

const CHARACTER_ARCHETYPE = `
# 生活叙事冒险角色原型（平凡却闪光的人们）
- 主角：略带迷茫的普通人，在与他人的相处中被治愈，也成为治愈他人的人
- 女主/关键角色群：各自背负一道温柔的伤痛（病弱、孤独、丧亲、家庭裂痕）
- 羁绊是核心资产：角色不为打败谁而存在，而为"被理解、被陪伴"而存在
- 家人/长辈/小镇邻里：构成有人情味的支持网，承载亲情与代际的重量
- 成长弧线指向"接纳与告别"：学会珍惜、学会放手，是每条线的情感归宿
`.trim();

const CHARACTER_STYLE = `
生活叙事角色塑造：用大量温柔的日常把人物"养"在玩家心里，让离别时的痛来自真实的相处。
每个角色的伤痛都该被温柔对待——不是用来卖惨，而是为了"被看见、被陪伴"。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色的伤痛须有铺垫与尊重，杜绝廉价卖惨或工具化的悲剧
- 每条线的情感归宿要落在"接纳/告别/成长"，而非简单的恋爱达成
- 配角群须有人情味与生活感，避免沦为推动主角的功能性 NPC
- 治愈与悲伤须真实可信，情绪转折要有日常细节作支撑
`.trim();

const ITEM_DATABASE_STYLE = `
# 生活叙事冒险物品守则（承载记忆的寻常物）
- 信物即记忆：发夹、旧照片、手作团子、共度时光的小礼物，是羁绊的实体
- 日常之物被赋予温度：一把伞、一份便当、车站的月票——平凡物因人而珍贵
- 季节性物件标记时间：樱花书签、夏日烟花、围巾、贺年卡，呼应四季叙事
- 遗物/纪念品承载离别：逝者留下的物件，是后期泪点与"延续"的钥匙
- 道具文案重在情感与回忆，而非功能数值，读来令人心头一暖或一酸
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 信物须与具体的相处记忆绑定，不可作为无来历的随机道具
- 道具的情感价值优先于功能价值，杜绝冷冰冰的属性化描述
- 遗物/纪念品的出现须服务于离别与延续主题，避免滥用催泪
- 季节性物件要与当前时间线一致，保持四季叙事的连贯
`.trim();

const BRANCH_TREE_STYLE = `
# 生活叙事冒险分支树设计守则（日常累积 → 个人线 → 真结局）
- 主结构：共通日常线（建立小镇与群像）→ 各角色个人线（深入伤痛与陪伴）→ AFTER/真结局
- 经典两段式：先逐一走完个人线，集齐情感"光玉/羁绊"，解锁贯穿全篇的 TRUE END
- 分支由"陪伴与理解"驱动：选择多陪谁、是否直面对方的伤痛，决定走入哪条线
- 个人线收束于一次"温柔的告别或重逢"，真结局升华为对羁绊与生命的回答
- 情感累积制：日常小事一点点加深羁绊，让最终的泪点建立在真实相处之上
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 真结局须以"集齐各线情感/前置条件"解锁，杜绝单选项直达的廉价大团圆
- 每条个人线都要有完整的伤痛—陪伴—告别弧线，不可虎头蛇尾
- 悲剧性结局须有铺垫与意义（成长、延续），避免为虐而虐
- 各线长度与情感分量需均衡，防止"一条线远胜其它线"
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 生活叙事冒险对白脚本风格
- 大量温柔的日常对白：打趣、闲聊、餐桌絮语，藏着不动声色的关心
- 留白与欲言又止：最重的话往往说不出口，用沉默与停顿承载情感
- 角色语癖鲜明可爱（口头禅、方言、孩子气），让日常会话有记忆点
- 泣系场景的台词克制而有力：一句平实的真心话，胜过大段煽情
`.trim();

const DIALOGUE_PACING = `
- 节奏舒缓：日常多用从容的中长句，营造慢生活的呼吸感
- 离别/告白场放慢到极致，用断句、留白、单字让眼泪有时间落下
- 笑场与泪场交替编排：先用温馨打趣放松，再在不经意处刺中泪点
- 季节转场用一段抒情独白做"换气拍"，让时间与情绪自然过渡
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 煽情须克制：用平实真心话与留白催泪，杜绝堆砌华丽悲情辞藻
- 角色语癖须全程一致，作为日常质感与可爱度的锚点
- 重要情感台词要有日常铺垫，避免突兀的"金句轰炸"
- 笑与泪的切换要自然，不可为制造反差而生硬转折
`.trim();

const CINEMATIC_STORYBOARD_STYLE = `
# 生活叙事冒险电影化分镜风格
- 以"温柔的生活画面 + 情感 CG"为主：日常立绘对话，泪点处给一张直击人心的 CG
- 四季与光影叙事：樱吹雪、夏日积雨云、初雪、夕阳长影，用景物烘托情绪
- 空镜与静物特写：放学的走廊、留有余温的座位、车站——用"物是人非"催泪
- 离别高光集中演出：把最珍贵的画面留给告别与重逢，平时以温柔克制蓄力
`.trim();

const SHOT_LANGUAGE = `
- 景别：日常中景平视亲切；情感顶点切近景/特写，凝视泪光与微笑
- 运镜：极缓的推拉与淡入淡出，配合长留白镜头，给情绪沉淀的时间
- 光影色调：暖黄治愈日常、逆光与黄昏渲染感伤、冷蓝初雪烘托离别
- 善用空镜与季节转场镜头标记时间流逝，让"过了很久"被看见
`.trim();

const QTE_RULES = `
- 本品类几乎无 QTE：体验核心是阅读、陪伴与情感共鸣，而非操作反应
- 如有互动（小游戏、节日活动），仅作温柔点缀，无失败惩罚或惩罚极轻
- 限时操作与紧张机制与品类气质相悖，应当回避
- 任何互动都不得打断抒情节奏，演出与文本的沉浸永远优先
`.trim();

const CINEMATIC_STORYBOARD_CONSTRAINTS = `
- 演出资源向离别/重逢等情感顶点集中，日常保持温柔轻量
- 四季与光影演出须与时间线一致，杜绝季节穿帮
- CG 触发须与个人线情感进度绑定，避免与剧情脱节
- 严禁高强度动作/QTE 破坏治愈与泣系的抒情沉浸
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："坡道上的小镇 / 生活叙事 / 羁绊与离别"
- 世界设定：一座有长长坡道的海边小镇，故事从樱花纷飞的转学季开始
- 日常质感：上学路的偶遇、放学后的旧书店、家中略显冷清的餐桌被一点点填满温度
- 关键角色：体弱却总是笑着的少女（隐藏：来日无多）、口是心非的青梅、独居的面包店奶奶
- 个人线累积：陪少女走过一个又一个季节，一起放完最后一次夏日烟花
- 泣系顶点：冬日初雪，少女在病房窗前留下的发夹与一句"谢谢你陪我看完四季"
- 真结局：集齐各线的羁绊后，主角在多年后的春天带着孩子重走那条坡道，生命得以延续
`.trim();

export const ADV_LIFE_SIM_SKILL: NarrativeSkill = {
  genreCode: "adv-life-sim",
  tier: "tier2",
  matchKeywords: ["生活叙事", "clannad", "air", "kanon", "日常系", "slice of life"],
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "plot_generation",
    "script_generation",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        examples: FEW_SHOT_EXAMPLES,
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
    outline_batch: {
      slots: {
        style_guide: BRANCH_TREE_STYLE,
        constraints: BRANCH_TREE_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: `${DIALOGUE_SCRIPT_STYLE}\n\n${DIALOGUE_PACING}`,
        constraints: DIALOGUE_SCRIPT_CONSTRAINTS,
      },
    },
    script_generation: {
      slots: {
        style_guide: `${CINEMATIC_STORYBOARD_STYLE}\n\n${SHOT_LANGUAGE}\n\n${QTE_RULES}`,
        constraints: CINEMATIC_STORYBOARD_CONSTRAINTS,
      },
    },
  },
};

registerSkill(ADV_LIFE_SIM_SKILL);
