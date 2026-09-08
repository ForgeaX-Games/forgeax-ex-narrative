/**
 * adv-raising — 品类叙事包（养成冒险 / Tier2 重叙事）
 *
 * 叙事占比 60-80%：时间管理 + 属性养成是引擎，剧情是被这套引擎"长出来"的果实。
 * 玩家用有限的日程培育角色，属性阈值与日常事件累积情感，最终在毕业/结局处收束
 * 成多种命运分歧。剧情不是线性给定，而是由养成选择"种"出来的。
 *   代表作：心跳回忆(ときめきメモリアル) / 美少女梦工厂(Princess Maker) / 各类养成AVG。
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
# 养成冒险世界观原型（被日历切分的成长舞台）
- 世界以"周期日历"为骨架：学期/年度/季度，时间是最稀缺的资源，也是叙事推进器
- 明确的成长终点：毕业典礼、成人礼、出嫁/远行——一切日常都朝这个倒计时收敛
- 生活舞台具体可感：学园、家宅、城镇商业街、社团活动室，地点即可安排的"日程选项"
- 属性体系是世界规则：学力/体魄/魅力/心理等数值，决定角色能进入哪些事件与未来
- 平凡日常孕育非凡羁绊：没有宏大灾难，戏剧来自相处、误会、心动与抉择的累积
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温煦、生活化、带成长的酸甜；偶有事件性的小高潮但底色平静
- 把时间写成有重量的资源："今天陪谁/练什么"都是要付出机会成本的选择
- 用季节与节日给日常打节拍（入学、文化祭、圣诞、毕业），让时间流逝可被感知
- 世界观服务于"培育"：每个地点/活动都要能转化为属性成长或好感事件
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 必须保留"日历 + 日程"的时间管理框架，严禁退化为线性无周期叙事
- 属性体系要与剧情挂钩：数值不是摆设，须能开关事件与结局
- 成长终点（毕业/结局节点）须明确，所有日常朝它收束
- 保持生活化尺度，杜绝突兀引入宏大世界危机冲淡养成主题
`.trim();

const CHARACTER_ARCHETYPE = `
# 养成冒险角色原型（被培育者 + 攻略对象群）
- 被养成核心：可以是"玩家培育的孩子/学员"或"玩家自身成长"，承载属性与命运分歧
- 攻略对象群（3-6 名）：各自绑定一条好感线，性格标签鲜明（学霸、运动系、文静、傲娇…）
- 每名攻略对象三件套：表层人设 + 隐藏心结 + 专属事件触发条件（属性阈值/相处次数）
- 师长/家人/对手：提供日常引导、压力与竞争，是数值与情感的外部变量
- 关系网闭合：角色之间存在友谊/竞争/暗恋，玩家的选择会牵动整张网
`.trim();

const CHARACTER_STYLE = `
养成冒险角色塑造：让每名攻略对象都"值得为TA分配时间"——清晰的魅力点 + 一道想被填补的心结。
被养成者的性格应随玩家的培育选择而漂移，让数值成长在人格上看得见。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每条好感线必须有专属事件与可达成的结局，避免某角色"只有名字没有线"
- 角色事件的触发须挂在属性/好感阈值上，保证养成投入有叙事回报
- 攻略对象性格要差异化，杜绝多名角色人设雷同导致选择无意义
- 被养成者的成长结果须能在台词与立绘上体现，而非仅数值变化
`.trim();

const ITEM_DATABASE_STYLE = `
# 养成冒险物品守则（道具即养成杠杆）
- 养成消耗品：教材、护具、化妆品、营养品——直接增减属性，是日程的物化
- 礼物系统：贴合各攻略对象喜好的礼物，提升好感并解锁专属对话
- 纪念品/信物：随好感线推进获得，承载关系里程碑（一起做的护身符、合照）
- 事件钥匙物：解锁隐藏事件/隐藏角色线的关键道具（旧日记、转学生的信）
- 道具文案带生活气息：交代来历与心意，让"送什么"成为情感表达
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 养成消耗品的数值效果须与属性体系一致，避免破坏成长曲线
- 礼物与角色喜好要明确对应，错误礼物应有合理的负反馈而非无反应
- 信物/纪念品须与好感里程碑绑定，不可与剧情脱节地随意发放
- 道具文案保持温暖生活化，杜绝冷冰冰的纯数值说明
`.trim();

const BRANCH_TREE_STYLE = `
# 养成冒险分支树设计守则（养成驱动的命运分歧）
- 主结构：共通成长期（建立日常与属性基础）→ 好感分歧（各角色线展开）→ 毕业/结局收束
- 分支由"养成结果"驱动：属性达标解锁职业/升学结局，好感达标解锁角色 ENDING
- 结局矩阵显式声明：个人结局（各攻略对象）/ 自我实现结局（属性向）/ 普通/遗憾结局
- 事件累积制：日常小事件按好感分层逐步解锁，情感是"攒"出来而非一次给定
- 时间压力入树：错过的季节事件不可逆，制造"这一年怎么过"的策略性命运感
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 每个结局须给出明确判定条件（属性阈值 + 好感阈值 + 关键事件完成）
- 必须支持多周目重玩价值：不同培育路线导向显著不同的结局
- 错过/不可逆事件要在设计上提示玩家其存在，避免"无从得知的隐藏分歧"
- 收束节点（毕业/结局）唯一且庄重，所有线最终在此结算命运
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 养成冒险对白脚本风格
- 日常对话占主体：轻松、生活化，藏着角色性格与渐增的好感暗流
- 好感分层的语言变化：从客气到亲昵，称呼/语气随关系推进而软化
- 事件场对白要有"心动锚点"：一句让玩家记住这条线的告白/真心话
- 师长/家人的台词承担引导与提醒功能，自然地提示养成方向
`.trim();

const DIALOGUE_PACING = `
- 节奏跟随日历：平日短对话快节奏，节日/事件场放慢做情感铺陈
- 告白与关键事件前留一个"心跳停顿"，让玩家感到分量
- 好感越高，独处对话越长越私密；好感不足则维持礼貌性短交流
- 用季节性问候与日常寒暄做"过渡拍"，串起一段段时间流逝
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 角色称呼/语气须随好感阶段一致地演变，杜绝关系跳变
- 关键告白/心动场只在满足好感阈值时出现，避免廉价滥发
- 引导性台词要自然融入剧情，不能变成生硬的"系统教学"
- 日常对话也要承载塑造功能，杜绝无信息量的纯填充寒暄
`.trim();

const CINEMATIC_STORYBOARD_STYLE = `
# 养成冒险电影化分镜风格
- 以"立绘 + 情景 CG"为主：日常用立绘对话，事件高光给一张情感 CG 锚定记忆
- 善用季节与节日演出：樱花、文化祭灯火、圣诞雪夜——用画面强化时间流逝的情绪
- 好感里程碑专属演出：第一次牵手/告白用特写与暖光，区别于日常画面
- 成长可视化：被养成者的立绘随时间/属性变化（身高、气质、服装）
`.trim();

const SHOT_LANGUAGE = `
- 景别：日常对话中景平视，亲密时刻切近景/特写聚焦表情与眼神
- 运镜：以柔和的缓推、淡入淡出为主，营造温暖生活质感
- 光影与色调：随季节与情绪调色（春日暖黄、雪夜冷蓝、告白时的逆光）
- 用环境空镜（教室夕照、放学的街道）做情绪过渡与时间标记
`.trim();

const QTE_RULES = `
- 本品类基本无动作 QTE：养成核心是"规划与抉择"，而非反应操作
- 如需互动小游戏（约会节奏、才艺表演），作为养成的趣味点缀且结果反哺好感/属性
- 限时选择可用于告白等高情绪场景制造心跳感，但不应惩罚性过强
- 互动密度低，绝不让操作压力盖过日常养成与情感累积的主体验
`.trim();

const CINEMATIC_STORYBOARD_CONSTRAINTS = `
- 演出资源向"心动里程碑"与结局集中，日常保持轻量立绘演出
- 成长/季节的可视化变化须与剧情时间线一致，杜绝穿帮
- CG 触发须与好感/事件挂钩，避免与玩家培育进度脱节
- 互动小游戏/QTE 须低强度且结果反哺养成，不可喧宾夺主
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："私立樱凛学园的三年 / 养成冒险 / 多角色好感线"
- 世界设定：以三学年为周期，玩家规划每周的"上课/社团/打工/约会"日程
- 属性引擎：学力/体能/艺术/魅力四维，决定可进入的社团与升学/出道结局
- 攻略对象：学霸会长（隐藏：怕被超越的孤独）、运动部学妹、转学来的神秘画家
- 事件累积：与画家在美术室的数次相处后，魅力达标解锁"放学后的写生"心动事件
- 时间压力：若第二年文化祭未参加任何社团，将永久错过"舞台告白"分支
- 结局矩阵：画家个人 ENDING（毕业旅行的画展）/ 升学结局（艺术大学）/ 遗憾结局（独自毕业）
`.trim();

export const ADV_RAISING_SKILL: NarrativeSkill = {
  genreCode: "adv-raising",
  tier: "tier2",
  matchKeywords: ["养成冒险", "养成avg", "美少女梦工厂avg", "心跳回忆"],
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

registerSkill(ADV_RAISING_SKILL);
