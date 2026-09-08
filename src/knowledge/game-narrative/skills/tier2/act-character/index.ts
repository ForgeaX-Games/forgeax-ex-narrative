/**
 * act-character — 品类叙事包（Character Action / 角色动作）
 *
 * Character Action = 史诗叙事型（风格化角色驱动）。其"史诗"不靠庞大世界，
 * 而靠"极致的角色魅力 + 华丽的演出 + 高浓度风格"：故事是主角酷炫人格的舞台
 * （猎天使魔女 / 尼尔）。叙事浓度较低，但角色与基调极强。
 *
 * 采用精简叙事链（仅保留 角色驱动 的最小骨架 worldview→character→framework→script）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 故事框架 → 剧本演出]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# Character Action 世界观原型（"为主角耍帅而生的舞台"）
- 世界服从风格：天界/地狱/废土/赛博等强烈设定，存在的意义是衬托主角的华丽与癫狂
- 高概念但轻考据：世界规则简明、夸张、酷，不追求严密，只追求"够带感"
- 浮夸的对抗体系：天使/恶魔/机械军团等成群结队的华丽敌人，为炫技演出供给舞台
- 基调先行：无论暗黑、戏谑还是哀伤，世界观先确立一种压倒性的"气质"
- 留白宏大设定：背景神话可以宏大，但点到为止，重点永远是当下这场战斗的爽与酷
`.trim();

const WORLDVIEW_STYLE = `
- 语调：极致风格化——或张扬戏谑，或冷艳哀美，须一以贯之、辨识度拉满
- 世界设定为"演出奇观"服务：场景越夸张、越超现实越好（在月亮上战斗也理所当然）
- 不纠缠设定自洽，优先确保"每个场景都能让主角帅出新高度"
- 用强烈的视觉与音乐想象去描述世界（霓虹、血色、华尔兹般的战斗韵律）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁用冗长设定拖慢节奏；世界观服务于风格与演出，点到即止
- 每个区域须能催生一段"风格化战斗奇观"，否则不必存在
- 基调须全程统一，不得在严肃与戏谑间无理由摇摆
- 宏大背景仅作底色，不喧宾夺主于主角的当下表演
`.trim();

const CHARACTER_ARCHETYPE = `
# Character Action 角色原型（魅力压倒一切的主角）
- 主角是绝对核心：极致的人格魅力（自信、性感、癫狂、酷），一举一动都是表演
- 标志性人设：独特的口头禅、招牌动作、视觉符号，让主角一眼难忘
- 对手即陪衬与镜像：宿敌往往与主角同样张扬，对决是"两种极致风格的对话"
- 情感内核藏于酷壳之下：主角的张扬常包裹一段孤独、宿命或失去（点到为止）
- 配角不求多：少数搭档/对手即可，重点是放大主角的存在感
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角人设须有极高辨识度（口头禅/招牌姿态/视觉符号），贯穿始终
- 酷的外壳下须埋 1 条隐性情感线（孤独/宿命/救赎），但不喧宾夺主
- 宿敌须与主角风格对等，构成势均力敌的风格对决
- 角色塑造服务于"演出魅力"，避免冗长的内心独白拖慢节奏
`.trim();

const STORY_FRAMEWORK_STYLE = `
# Character Action 故事框架（演出驱动的章节秀场）
- L0 以"高潮关卡秀场"串联：每一章是一段主角风格的极致展演 + 一个升级的宿敌/挑战
- 故事服务于"一场比一场更爽更酷"的递进，节奏明快、转场利落
- 主线情感线点到为止：在炫目演出的间隙，用极少笔墨触动情感内核
- 终章须是风格、动作与情感的总爆发——最华丽的一战即情感的最高潮
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每章的"演出奇观 + 风格升级点 + 宿敌挑战"
- 叙事密度保持轻盈：不堆砌支线与设定，主线一气呵成
- 情感线须克制，仅在关键节点轻触，避免冲淡爽快基调
- 终章须同时兑现"最华丽的演出"与"情感内核的释放"
`.trim();

const SCRIPT_GENERATION_STYLE = `
# Character Action 剧本写作守则（台词即耍帅）
- 台词高度风格化：金句、俏皮话、挑衅、宣言，须朗朗上口、极具角色辨识度
- 战斗即演出：把战斗写成华丽的舞蹈/表演，强调韵律、姿态、镜头炫技
- 善用"开打前的耍帅台词"与"收尾的潇洒一句"，强化主角气场
- 情感时刻惜墨如金：一句台词、一个动作即点到为止，余韵留给玩家
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式台词（"连段评级SSS"），评价感须转译为角色的得意/挑衅口吻
- 风格化不等于空洞：金句须贴合角色性格，杜绝无意义的耍酷
- 情感台词须克制，禁止大段煽情独白破坏爽快节奏
- 战斗演出描写须服务于"主角魅力"，保持基调统一
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："堕天魔女 / Character Action / 戏谑与孤独"
- 风格基调：冷艳戏谑，以华尔兹般的韵律消灭成群天使，子弹与发丝齐舞
- 招牌人设：嚼着棒棒糖的慵懒口吻 + 战斗时骤然切换的致命优雅
- 宿敌镜像：同样张扬的旧日同门，对决如一场双人探戈
- 情感内核：在最华丽的终战间隙，一句"我从不为谁停留"泄露其千年孤独
`.trim();

export const ACT_CHARACTER_SKILL: NarrativeSkill = {
  genreCode: "act-character",
  tier: "tier2",
  matchKeywords: ["角色动作", "猎天使魔女", "尼尔", "Character Action", "Bayonetta", "NieR", "风格化动作", "鬼泣式"],
  // 精简链：仅保留角色驱动的最小骨架（worldview→character→framework→script）
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "story_framework",
    "script_generation",
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
        style_guide: "Character Action 角色塑造：主角魅力压倒一切，人设辨识度拉满；酷壳下藏一条克制的情感线，宿敌是势均力敌的风格镜像。",
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

registerSkill(ACT_CHARACTER_SKILL);
