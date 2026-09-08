/**
 * misc-edu — 品类叙事包（教育游戏 / Educational Game）
 *
 * 寓教于乐型（中等叙事 25-40%）：把知识点无缝织进剧情，用情景式学习与
 * 人生/历史模拟承载正向价值观。故事是知识的容器，玩法是体验的载体
 * （大航海时代 / 人生模拟类）。
 *
 * 教育链：通用前驱(偏好→初步方案) +
 *   [世界观 → 角色 → 道具 → L0框架 → 大纲批次]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 教育游戏世界观原型（"可被探索的知识场域"）
- 世界即课堂：把一段真实历史、一门学科、一种人生阶段，构造成可探索可互动的情景场域
- 知识嵌入肌理：地理、贸易、科学、历史规律不是说教，而是世界运转的"隐性规则"
- 真实性为骨、趣味性为肉：以可靠史实/学理为底座，再用游戏化包装降低门槛
- 人生/历史模拟母题：大航海的探索拓荒、人生的成长抉择、文明的兴衰演进
- 正向价值观底色：合作、求知、坚韧、尊重多元文化，作为世界默认的道德重力
- 代表母题：扬帆探索未知海域（大航海时代）、模拟一生的选择与成长（人生游戏）
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温暖、明亮、好奇心驱动；严谨而不枯燥，启发而不说教
- 世界观以"知识主题 + 情景场域 + 探索动机"三件套铺设
- 知识点要"长在世界里"：让玩家在玩中自然遭遇、运用、领悟，而非被灌输
- 设定须为分龄/分难度留接口：同一世界可对不同学习者展开深浅不同的内容
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 史实/学理须准确可靠，杜绝为戏剧性而扭曲核心知识点
- 知识须情景化嵌入世界规则，严禁脱离玩法的说教式信息倾倒
- 世界须承载正向价值观，杜绝歧视、暴力美化等不当导向
- 须尊重多元文化与历史复杂性，避免刻板印象与单一视角偏见
`.trim();

const WORLDVIEW_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："大航海时代 / 教育游戏 / 地理与贸易"
- 知识场域：以真实季风、洋流、各港口特产为世界规则，航行与贸易须顺应自然与经济规律
- 隐性课程：玩家在低买高卖中学会供需，在远航中认识地理、天文导航与多元文明
- 探索动机：绘制未知海图、建立商路、与异域文明友好通商，求知欲驱动冒险
`.trim();

const CHARACTER_ARCHETYPE = `
# 教育游戏角色原型（引路人与成长者群像）
- 主角：成长中的探索者/学习者，可留白以承载玩家代入，性格随学习历程逐步丰满
- 导师型角色：博学的船长、和蔼的老师、睿智的长者，自然地抛出知识线索而非照本宣科
- 同伴群像：性格各异的伙伴，代表不同视角与价值观，在协作中体现合作与包容
- 情景人物：商人、原住民、历史名人——是知识与文化的"活体接口"，让学习有面孔
- 反面/挑战角色：贪婪商人、傲慢者、自然险阻，制造冲突却始终导向正向反思
`.trim();

const CHARACTER_STYLE = `
教育游戏角色塑造：导师型角色用"启发式引导"而非灌输，把知识藏进对话与情境；
同伴群像承载多元视角与协作价值；主角随学习历程成长，让"懂得更多"成为可见的人物弧。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 导师角色须用启发而非说教传递知识，杜绝照本宣科的旁白工具人
- 同伴须代表多元视角并体现正向协作，避免刻板化的单一性格
- 历史/文化人物须尊重史实与族群，杜绝丑化或刻板印象
- 反面角色须导向正向反思，禁止美化不当价值观或制造廉价对立
`.trim();

const ITEM_DATABASE_STYLE = `
# 教育游戏道具 Lore 守则（道具即知识载体）
- 道具首先是"可学习的知识对象"：航海图、特产货物、史料文物、实验器材
- 每件道具附"知识小档案"：用途、来历、背后的学科常识或历史故事，寓知识于物品
- 文物/史料带真实感：基于可靠史实的器物描述，让收集本身成为一次微型学习
- 道具串联学习链：集齐某类物品拼出一个完整知识主题（如一套贸易品揭示全球商路）
- 趣味化包装：用拟人、谜题、趣闻降低门槛，让"读道具说明"也成为乐趣
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 道具知识档案须准确可靠，杜绝为趣味而失真的伪知识
- 知识须趣味化包装，避免枯燥的术语堆砌劝退学习者
- 文物/史料须尊重来源文化，杜绝错位或冒犯性的描述
- 系列道具须能拼出完整知识主题，避免零散无体系的信息碎片
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 教育游戏故事框架（情景式学习弧线）
- L0 以"成长/探索弧线"铺设：踏出第一步(好奇) → 在情境中学习与试错 → 运用所学克服挑战 → 收获与升华
- 把知识进度做成剧情进度：每解锁一个知识主题，故事就推进一程，学习即剧情奖励
- 用"问题驱动"组织章节：每章抛出一个真实问题(如何渡过风暴/如何促成贸易)，学习是解题钥匙
- 终章导向价值升华：把零散知识收束为一种世界观或人生感悟，呼应正向价值观底色
`.trim();

const STORY_FRAMEWORK_EXAMPLES = `
# L0 情景式学习弧线风味示例
## 主题："少年航海家的环球之旅"
- 好奇起步：在港口小镇听闻远方传说，渴望出海见识更广阔的世界
- 情境学习：首航遭遇逆风，须学习季风与航海术才能继续前行
- 运用所学：靠所学的贸易与外交知识，与异域港口建立友好商路
- 升华收束：环球归来，玩家领悟"世界因交流而丰富"，知识凝成胸怀
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须让知识进度与剧情进度同步，杜绝学习与故事两张皮
- 章节须以真实问题驱动，禁止脱离情境的纯知识罗列
- 终章须导向正向价值升华，避免说教式的生硬总结
- 学习曲线须循序渐进，杜绝难度/知识量的突兀跳跃
`.trim();

const OUTLINE_BATCH_STYLE = `
# 教育游戏大纲批次守则（知识主题章节库）
- 大纲产出"以知识主题为核的章节卡"：主题知识点、情景包装、学习目标、挑战设计
- 每张卡明确"教什么 + 怎么玩中学 + 如何检验掌握"，确保寓教于乐闭环
- 章节须可按难度分层组织，支持分龄学习者循序渐进
- 优先批量产出主题多样、彼此衔接的章节骨架，构成完整的知识图谱旅程
`.trim();

const OUTLINE_BATCH_CONSTRAINTS = `
- 大纲须以"知识主题章节卡"组织，每卡标注学习目标与检验方式
- 章节须形成循序渐进的难度梯度，杜绝知识跳跃或重复堆叠
- 须保证知识准确并趣味化，禁止为凑章节而注水的空洞内容
- 章节须能拼成连贯知识图谱，避免互不衔接的孤立知识点
`.trim();

export const MISC_EDU_SKILL: NarrativeSkill = {
  genreCode: "misc-edu",
  tier: "tier2",
  matchKeywords: ["教育", "人生游戏", "大航海时代"],
  // 教育链：世界观 → 角色 → 道具 → L0框架 → 大纲批次
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
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
  },
};

registerSkill(MISC_EDU_SKILL);
