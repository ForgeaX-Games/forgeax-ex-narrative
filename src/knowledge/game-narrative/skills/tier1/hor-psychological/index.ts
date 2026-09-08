/**
 * hor-psychological — 品类叙事包（心理恐怖 / Psychological Horror）
 *
 * 心理恐怖 = 分支叙事型（氛围与不可靠叙述驱动）。恐惧来自心理崩坏、暗示与未知，
 * 而非血腥猎奇；不可靠叙述者让真相与幻觉交织（层层恐惧 / 小小噩梦）。
 *
 * 氛围分支链（通用前驱 偏好→初步方案 之后，附镜头分镜以营造影像恐惧）：
 *   世界观 → 角色 → 大纲 → 情节 → 剧本
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本 / 电影化分镜三段专属 step 随 vn-v1
 * 一并搬进 `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到
 * 吸收后的通用大纲（outline_batch）/ 情节（plot_generation）/
 * 剧本（script_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 心理恐怖世界观原型（"在崩坏心智里长出的世界"）
- 世界是主角心理状态的外化：扭曲的家宅、循环的走廊、随精神恶化而变形的空间
- 主观真实优先：场景未必客观存在，可能是创伤、罪疚、妄想投射出的幻象
- 设"日常的异化"：从熟悉安全之物（家、玩偶、童年）滋生出最深的不安
- 恐惧源自未知与暗示：留白的黑暗、看不清的存在、说不通的因果
- 真相被层层包裹：世界表层与内里割裂，越深入越接近主角不敢面对的核心
`.trim();

const WORLDVIEW_STYLE = `
- 语调：压抑、阴郁、神经质，弥漫挥之不去的不安与失真感
- 世界须与主角心理状态绑定：精神越崩坏，空间越扭曲变形
- 从"熟悉之物"滋生恐惧：异化日常比凭空怪物更深入骨髓
- 恐惧靠暗示与留白营造：少给答案，多给"说不清哪里不对"的悚然
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁靠血腥猎奇堆砌恐惧；本品类的恐惧来自心理与暗示
- 世界的扭曲须有心理逻辑支撑（呼应主角创伤/罪疚），杜绝纯随机怪诞
- 须明确"客观真实 vs 主观幻象"的边界设计（哪怕只对作者清晰），支撑不可靠叙述
- 留白须制造不安而非困惑：可不解释成因，但须维持稳定的恐惧情绪流
`.trim();

const CHARACTER_ARCHETYPE = `
# 心理恐怖角色原型（不可靠的破碎心智）
- 主角：心理脆弱或已然崩坏者，背负创伤/罪疚/隐秘，其感知本身不可信
- 主角即"不可靠叙述者"：玩家看到的世界经其扭曲过滤，真假需自行辨别
- "威胁存在"常是内心投射：恐怖形象往往是主角恐惧/罪疚的具象化身
- 配角真假难辨：可能是真人、幻觉、记忆残片，模糊性本身制造不安
- 角色弧是"逐步逼近不敢面对的真相"：崩坏与顿悟同步，恐惧即自我揭露
`.trim();

const CHARACTER_STYLE = `
心理恐怖角色塑造：主角是不可靠叙述者，其破碎心智过滤了整个世界；
恐怖形象多为内心投射，配角真假难辨——模糊性即恐惧的温床。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的不可靠性须贯穿始终，杜绝忽然变身全知可信的视角
- 恐怖形象/威胁须可解读为主角心理的投射，杜绝纯外部怪物式廉价惊吓
- 配角的真假模糊须服务于不安氛围，而非沦为逻辑漏洞
- 角色崩坏须循序渐进、有迹可循，杜绝毫无铺垫的精神突变
`.trim();

const BRANCH_TREE_STYLE = `
# 心理恐怖分支树设计守则（崩坏路径与真相分层）
- 分支由"主角心理状态 + 关键认知抉择"路由：直面真相 vs 逃避自欺导向不同走向
- 设"现实/幻觉的分叉"：某些分支是主角的妄想，玩家的选择影响其沉沦或清醒
- 真相分层揭示：每条分支揭开一层包裹的真相，拼合后逼近不敢面对的核心
- 多结局须对应不同的心理终局：救赎/沉沦/永堕循环/真相揭露后的代价
- 恐惧节奏须张弛有度：在安全的喘息后埋下更深的不安，避免恐惧疲劳
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 分支须服务于"接近或逃避真相"的心理主题，杜绝与崩坏无关的随机岔路
- 现实/幻觉分叉须有内在线索可辨，杜绝纯粹愚弄玩家的无据反转
- 多结局须各自对应清晰的心理终局，杜绝结局间情感逻辑混乱
- 恐惧节奏须经营张弛，杜绝惊吓密度失控导致脱敏或疲劳
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 心理恐怖脚本风格（不可靠的低语）
- 旁白/独白带不可靠性：自相矛盾、记忆错乱、刻意回避，让玩家怀疑所见
- 用"说不通的细节"制造悚然：错位的称呼、重复的话语、不该出现的回应
- 对白极简而压迫：沉默、停顿、未说完的话，比尖叫更令人窒息
- 暗示恐惧而非直陈：用环境声响、模糊的描述、欲言又止勾起想象
- 关键崩坏时刻可让叙述彻底失真（人称混乱、时序错乱），外化精神瓦解
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 严禁血腥猎奇式的直白描写来廉价制造恐惧，须靠暗示与心理压迫
- 叙述的不可靠须有意为之且有迹可循，杜绝纯粹的信息错误
- 对白须克制留白，杜绝用大段解说拆穿本应保留的未知
- 失真叙述须服务于精神崩坏的表达，杜绝为炫技而无意义的混乱
`.trim();

const CINEMATIC_STORYBOARD_STYLE = `
# 心理恐怖电影化分镜守则（用镜头制造不安）
- 镜头语言营造心理压迫：狭窄构图、失衡视角、过长的静止凝视
- 善用"画面外的恐惧"：声响来源不入画、阴影中模糊的轮廓，让想象补全恐怖
- 节奏控制是命脉：用缓慢推进积累张力，以骤然的静默或异响释放
- 光影是恐惧的画笔：明暗对比、闪烁、逆光剪影，制造看不清的不安
- 主观镜头与失真特效（扭曲、重影、错帧）外化主角崩坏的感知
- 关键惊悚点克制使用 jump scare，更多依赖"缓慢逼近的诡异"积压压迫感
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："不断变形的家宅 / 心理恐怖 / 层层恐惧式画家的崩坏"
- 心理外化：随主角精神恶化，熟悉的家宅走廊不断延长、房门错位、画作自行扭曲
- 不可靠叙述：主角的独白坚称"妻女只是出门了"，但环境细节处处暗示并非如此
- 暗示恐惧：始终未正面出现的"她"，只以脚步声、半开的门、镜中一闪而过暗示
- 分镜处理：长走廊的缓慢主观推进 + 画面外渐近的脚步声，不靠 jump scare 也令人窒息
`.trim();

export const HOR_PSYCHOLOGICAL_SKILL: NarrativeSkill = {
  genreCode: "hor-psychological",
  tier: "tier1",
  matchKeywords: ["心理恐怖", "层层恐惧", "Layers of Fear", "小小噩梦", "Little Nightmares", "psychological horror", "氛围恐怖", "不可靠叙述"],
  // 氛围分支链 ②-③ + 通用大纲/情节/剧本
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",
    "outline_batch",
    "plot_generation",
    "script_generation",    // 影像恐惧分镜
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
        style_guide: CHARACTER_STYLE,
        constraints: CHARACTER_CONSTRAINTS,
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
        style_guide: DIALOGUE_SCRIPT_STYLE,
        constraints: DIALOGUE_SCRIPT_CONSTRAINTS,
      },
    },
    script_generation: {
      slots: {
        style_guide: CINEMATIC_STORYBOARD_STYLE,
      },
    },
  },
};

registerSkill(HOR_PSYCHOLOGICAL_SKILL);
