/**
 * adv-otome — 品类叙事包（乙女游戏 / Otome）
 *
 * 乙女游戏 = 分支叙事型（女性向恋爱）。核心是"男主原型矩阵 + 好感度系统 +
 * HE/NE/BE 三结局"，玩家以女主视角与多名可攻略角色发展情感线
 *（恋与制作人 / 光与夜之恋 / 未定事件簿）。
 *
 * 分支家族链（通用前驱 偏好→初步方案 之后）：
 *   世界观 → 角色 → 大纲（好感度路由） → 情节（恋爱台词）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 乙女游戏世界观原型（"为心动而生的舞台"）
- 世界服务于"相遇—靠近—心动"：现代都市、奇幻学院、异世界宫廷皆可，关键是制造邂逅契机
- 设定一个让女主与多名男主自然交集的"枢纽场景"（事务所、社团、共同事件）
- 世界须为每条线预留专属情境（各男主有独立的世界切面与专属场景）
- 留出"危机/悬念副线"为恋爱升温提供外部压力（共同对敌、并肩渡难）
- 氛围以"少女漫式的浪漫光晕"为底色：唯美、心动、偶有甜与虐的反差
`.trim();

const WORLDVIEW_STYLE = `
- 语调：细腻、唯美、带情绪温度，世界观本身就要"令人想恋爱"
- 枢纽场景须明确：女主因何与众男主反复相遇并产生交集
- 每名可攻略男主对应一处"专属世界切面"，让其个人线有独立舞台
- 外部危机/悬念服务于情感升温，不可喧宾夺主盖过恋爱主轴
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁世界观盖过恋爱主线；一切设定最终须回归"为心动服务"
- 必须显式设计"女主与多男主反复相遇"的合理机制，杜绝强行凑合
- 每条线须有专属情境锚点，避免所有男主共用一套背景导致线路同质
- 危机副线须可与任一男主线交织，不得是与恋爱割裂的独立支线
`.trim();

const CHARACTER_ARCHETYPE = `
# 乙女游戏角色原型（男主原型矩阵 + 代入式女主）
- 女主：留代入空间但非空壳，须有明确性格底色与成长诉求（独立、坚韧、温柔等）
- 男主原型矩阵：覆盖差异化"萌点光谱"，典型如——
  · 高冷霸总 / 腹黑总裁：外冷内热，反差萌
  · 阳光暖男 / 青梅竹马：稳定陪伴，治愈系
  · 危险坏男孩 / 反派魅力：禁忌张力，虐恋潜质
  · 神秘学者 / 年下/天然系：好奇心驱动，慢热升温
- 每名男主须有"专属心结 + 专属称呼/语癖 + 专属心动名场面"
- 男主间须性格错位、互不重叠，确保玩家"难以抉择"的甜蜜烦恼
`.trim();

const CHARACTER_STYLE = `
乙女角色塑造：女主是有骨架的代入容器，男主矩阵须覆盖差异萌点光谱；
每名男主靠"反差 + 专属心结 + 标志性心动瞬间"立住，让玩家想反复攻略。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 男主原型须明确错位区分，杜绝两名男主性格/定位高度重合
- 每名男主须配 1 条专属心结（个人线核心待解的情感伤痕/秘密）
- 女主须有独立人格与目标，绝不沦为只会被攻略的提线木偶
- 每名男主须设计至少 1 个"标志性心动名场面"种子，供脚本展开
`.trim();

const BRANCH_TREE_STYLE = `
# 乙女游戏分支树设计守则（好感度路由 + 三结局）
- 结构 = 共通线（群像相遇） + 各男主个人线 + 结局分流
- 个人线进入条件由"好感度阈值 + 关键选项"共同决定，须显式声明路由规则
- 每名男主须规划完整三结局：HE（圆满）/ NE（遗憾收场/朋友以上）/ BE（错过/悲剧）
- 关键选项分两类：心动选项（影响好感度）与命运选项（影响结局分流）
- 各男主线深度须均衡，杜绝"主推男主线远比others丰满"
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 必须为每名可攻略男主写齐 HE/NE/BE 三结局及其判定条件
- 好感度阈值与命运选项的判定须显式、可校验，杜绝玄学触发
- 共通线须公平铺垫各男主，不在共通段就偏向单一男主
- BE 须有情感逻辑支撑（错过/误会/牺牲），不得为虐而虐地强行降智
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 乙女游戏对白脚本风格（心动台词学）
- 男主台词须高度"声优可演"：语气、停顿、专属称呼（如对女主的昵称）一致贯穿
- 善用"心动距离"描写：靠近、对视、低语、突然的温柔，营造怦然瞬间
- 女主内心独白承担情感放大器：把暧昧的悸动外显给玩家共鸣
- 不同男主对同一情境的反应须鲜明区分（暖男的体贴 vs 霸总的强势 vs 坏男孩的撩拨）
- 甜虐节奏交替：在最甜处埋一丝隐忧，在最虐处留一缕希望
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 男主语癖/称呼须前后统一，杜绝人设崩坏式的口吻漂移
- 心动桥段须靠情境与潜台词烘托，杜绝直白生硬的"我喜欢你"灌输
- 严禁机制裸露（"好感度+10"），须转译为眼神/动作/语气的情感信号
- 女主独白须保留代入余地，强烈情绪须由情境驱动而非编剧硬塞
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："都市超能事务所 / 乙女 / 四位男主各异萌点"
- 枢纽场景：女主入职超能事件调查事务所，与四名能力者男主朝夕共事
- 男主矩阵：高冷队长(反差萌) / 阳光搭档(青梅竹马) / 危险线人(禁忌张力) / 天才少年(年下天然)
- 心动名场面：队长在任务负伤后第一次卸下冷漠，低声唤出女主的名字
- 三结局示例（队长线）：HE 并肩守护日常 / NE 相互成全各自远行 / BE 为护女主失忆错过
`.trim();

export const ADV_OTOME_SKILL: NarrativeSkill = {
  genreCode: "adv-otome",
  tier: "tier1",
  matchKeywords: ["乙女", "乙女游戏", "恋与制作人", "光与夜之恋", "女性向", "未定事件簿", "otome", "女性向恋爱"],
  // 分支家族链 ②-③ + 通用大纲/情节
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",
    "outline_batch",
    "plot_generation",
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
  },
};

registerSkill(ADV_OTOME_SKILL);
