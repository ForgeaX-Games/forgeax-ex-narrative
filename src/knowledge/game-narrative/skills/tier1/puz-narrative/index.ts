/**
 * puz-narrative — 品类叙事包（叙事解谜 / Narrative Puzzle）
 *
 * 叙事解谜 = 分支叙事型（隐喻叙事，几乎零对白）。谜题与情感隐喻融为一体，
 * 故事靠氛围、留白与环境符号"被感受到"而非被讲述（地狱边境Limbo / 时空幻境Braid）。
 *
 * 谜题主导链（角色高度抽象故省略 character）：
 *   世界观 → 大纲（隐喻谜题链） → 情节（近乎无言的氛围文本） → 场景生成（隐喻空间）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 叙事解谜世界观原型（"可被走过的一首隐喻诗"）
- 世界是一则情感隐喻的具象化：黑白剪影的危险童年、循环倒流的悔恨记忆
- 不靠文字交代设定，而靠氛围、符号、空间气质让玩家"感受到"世界的情绪内核
- 主题先行：先确立一个情感命题（失去、恐惧、执念、成长），世界是它的视觉转译
- 留白是世界的呼吸：未解释的存在、模糊的因果，邀请玩家投射自己的理解
- 危险/美感并存：Limbo 式的诗意残酷，Braid 式的唯美忧伤，氛围即叙事
`.trim();

const WORLDVIEW_STYLE = `
- 语调：诗意、内省、克制而深沉，氛围本身就在讲故事
- 先锚定"情感命题"，再把世界设计成该命题的隐喻载体（色彩/空间/声音皆服务于此）
- 世界须能"被感受"而非"被读懂"：少即是多，暗示胜于明示
- 符号系统须自洽且有解读空间，允许玩家投射各自的情感诠释
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁文字旁白式的设定灌输；世界须靠氛围与符号自我言说
- 一切视觉/听觉元素须服务于核心情感命题，杜绝无意义的炫技装饰
- 隐喻须留解读空间但不可彻底失焦，须有可被感知的情绪方向
- 留白不等于含糊：模糊的是答案，清晰的应是情绪的张力与走向
`.trim();

const BRANCH_TREE_STYLE = `
# 叙事解谜谜题链设计守则（谜题即隐喻）
- 主结构是"情感弧线驱动的谜题序列"：每个谜题对应情感命题的一个阶段
- 谜题机制本身要承载隐喻（如倒流时间=无法放下的过去，影子=内心的恐惧）
- 难度递进与情感递进同构：越接近真相，谜题与情绪越沉重/越通透
- 设"情感顿悟节点"：解开谜题的瞬间也是理解隐喻的瞬间，玩法与主题合一
- 末段常以一次"机制即真相"的揭示收束，让整段旅程的隐喻豁然贯通
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 谜题机制须与情感隐喻同构，杜绝与主题无关的纯智力填充
- 难度曲线须服务情绪曲线，杜绝为难而难打断情感沉浸
- 解法须公平可达，杜绝逼玩家穷举导致隐喻体验被挫败感淹没
- 末段揭示须由全程铺垫的符号支撑，杜绝空降的强行升华
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 叙事解谜脚本风格（近乎无言的氛围文本）
- 文本极度稀少甚至全无：能用画面/声音表达的，绝不用文字
- 若有文本，须是诗化的、碎片的、留白的，像散落的低语或墓志铭
- 让"环境讲故事"：场景的演变、符号的重现、声音的明暗承担叙事
- 沉默是主要语言：用静默、空镜、未完成的画面承载最重的情感
- 极少的关键文本可在情感顿悟处点睛，但点到即止，绝不解释
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 严禁话痨；任何文字都须经受"删去是否更纯粹"的拷问
- 文本绝不解释谜题或隐喻，至多投下一缕诗意的暗示
- 若用文本，须风格统一为碎片诗化，杜绝突兀的说明体
- 氛围叙事须自洽连贯，杜绝符号前后矛盾导致情绪断裂
`.trim();

const SCENE_GENERATION_STYLE = `
# 叙事解谜场景生成守则（隐喻空间）
- 场景是情感隐喻的画布：色彩、明暗、构图、空间尺度都在传递情绪
- 强烈而统一的美术语言（Limbo 的黑白剪影 / Braid 的水彩油画），即品类辨识度
- 用环境演变讲故事：随情感弧线推进，场景气质从压抑走向释然或更深的沉沦
- 谜题元素须自然融入场景美学，不破坏画面诗意（机关也要美）
- 声音/光影是隐形叙事者：用留白的音景与微妙光变承托未言明的情感
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："黑白剪影 / 叙事解谜 / Limbo 式寻找与失去"
- 情感命题：一个孩子在死亡边境寻找失散的姐姐——失去与执念
- 隐喻谜题：利用自身的影子与水中倒影通行，机制暗喻"与死亡的若即若离"
- 环境叙事：从阴森森林到冰冷工厂的场景演变，映照孩子内心的逐渐麻木
- 末段揭示：终点的重逢画面戛然定格，留白让"是否真的找到"成为玩家心中的回响
`.trim();

export const PUZ_NARRATIVE_SKILL: NarrativeSkill = {
  genreCode: "puz-narrative",
  tier: "tier1",
  matchKeywords: ["叙事解谜", "limbo", "地狱边境", "braid", "时空幻境", "氛围解谜", "诗意解谜", "inside"],
  // 谜题主导链（角色高度抽象，省略 character_enrichment）
  narrativeSteps: [
    "worldview",         // ②
    "story_framework",
    "outline_batch",     // 隐喻谜题链
    "plot_generation",   // 氛围文本
    "scene_plan",  // ⑦ 隐喻空间
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
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
      },
    },
  },
};

registerSkill(PUZ_NARRATIVE_SKILL);
