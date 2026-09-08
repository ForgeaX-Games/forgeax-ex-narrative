/**
 * rpg-wuxia — 品类叙事包（仙侠 / 武侠 RPG）
 *
 * 仙侠武侠 RPG = 史诗叙事型（东方语境）。其史诗不在"拯救世界"，
 * 而在"江湖恩怨 + 武学境界 + 侠义抉择"：个人在门派、师承、情义与天道之间的成长与取舍。
 *
 * 采用 RPG 七单品链：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 仙侠/武侠世界观原型（"江湖即社会"）
- 江湖结构：正邪两道、名门正派与魔教、世家与散人、朝廷与绿林，构成可游走的人情网络
- 武学/修真体系：境界分层（如练气→筑基→金丹 / 三流→一流→宗师），境界即叙事进度的隐喻
- 门派与师承：师门恩义、同门情谊、叛出师门是核心戏剧母题
- 仙侠特有：天道/劫数/飞升、灵根资质、仙凡之别、正魔不两立的宿命论
- 武侠特有：庙堂与江湖、家国大义、侠之大者为国为民、武林大会与秘籍争夺
- 必须显式刻画"出身/师承起点"：少年初入江湖的纯真，决定其日后侠义底色
`.trim();

const WORLDVIEW_STYLE = `
- 语调：古典、写意、有侠气；善用山水意象与诗词气韵烘托境界与心境
- 第一段须给"江湖坐标 + 时代恩怨"双锚点（此江湖有何格局 / 主角卷入哪桩旧案）
- 武学/修为的提升要与心境、际遇绑定（武功是心性的外化，而非纯数值）
- 核心冲突宜写成"情义 vs 大义"或"个人逍遥 vs 苍生责任"，避免单纯门派械斗
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把江湖写成纯帮派列表；每个门派须带可感知入口（驻地/规矩/标志性武学/恩怨对象）
- 境界体系须与剧情节点挂钩：每次突破都应对应一段心境淬炼或重大抉择
- 正邪界限须留灰度：名门未必正、魔教未必邪，为后期立场反转埋伏笔
- 必须埋下至少 1 桩"上一辈的旧账"，作为主角宿命与中期真相的根源
`.trim();

const CHARACTER_ARCHETYPE = `
# 仙侠/武侠角色原型（情义编织的群像）
- 主角：从少年游侠/记名弟子起步，背负身世之谜或血海深仇，于江湖历练中明心见性
- 师长：亦师亦父，传授武学也传递价值观，常于中期罹难或立场对立，逼主角独立
- 红颜/挚友/同门：情义线是仙侠武侠的命脉，须有"为情可负天下/为义可舍儿女情长"的张力
- 反派：多为"被执念吞噬的同道"——昔日同门、堕魔的天才、为复仇不择手段者，是主角的另一种可能
- 仙侠群像还须含"红尘羁绊 vs 求道无情"的对照人物（如重情者与绝情者）
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角核心动机须扎根于"情义/师承/身世"，而非抽象的"行侠仗义"
- 反派须可被理解为"走岔了路的同道"，其执念应映照主角可能堕落的方向
- 每个核心角色需声明 1 条情义羁绊种子（师徒/同门/红颜/血仇），由后续 quest 展开
- 武学境界须与角色心境绑定：心魔未除则境界受阻，须以剧情而非打怪解锁
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 仙侠/武侠故事框架（成长—历练—证道节拍）
- L0 推荐三段铺设：初入江湖(拜师/历练/结义) → 卷入风波(门派之争/旧案重启/正魔冲突) → 证道/了局(情义抉择/苍生取舍/飞升或归隐)
- 武学突破节点须与心境淬炼绑定，作为情节里程碑（如顿悟于挚友之死后）
- 江湖支线宜以"行侠见闻"组织：每段奇遇折射一种江湖众生相，反哺主角侠义观
- 结局走向以"情义 / 大义 / 逍遥"三种价值取舍结算，可多结局
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 多结局须由价值抉择驱动：BE 常因"执念/复仇吞噬本心"，HE 常因"放下/成全/担当"
- L0 不能只有主线门派斗争，须显式标注"情义羁绊推进节点"与"心境/境界突破节点"
- 中期须有"师门巨变/旧案揭露"的转折，撼动主角既有的江湖认知
- 飞升/归隐/殉道等终局须与主角全程的心性轨迹自洽，不可突兀
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 仙侠/武侠剧本写作守则
- 台词须有古典韵味：文白相间、留白克制，忌现代网络语；高人对话尤重机锋与禅意
- 武戏文写：交手过程要写出心境博弈与招式意境，而非纯动作罗列
- 善用意象转场：以山水、四季、剑光、灯火承接情绪，营造写意氛围
- 每段重要情义戏须留 1 句可传诵的"侠语/道偈"（如临别赠言、彻悟之言）
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式对白（"你内力-50"），须改写为意境化的招式描写与心境台词
- 角色境界/心境的变化须真正改变其后续言谈气度（如悟道后言语转为通透）
- 情义抉择须由角色弧光驱动，不靠外部巧合强行制造两难
- 古典语感与角色身份须匹配（市井游侠与方外高人的口吻不可混同）
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："少年复仇 / 仙侠 / 正魔之间"
- 江湖坐标：名门"青冥剑派"与被污名的"血河魔教"百年宿怨
- 师承起点：主角为魔教遗孤却被剑派收养，身世之谜即宿命引线
- 反派镜像：大师兄因不容主角魔裔身份而堕入偏执，成为"另一个可能的主角"
- 道偈名句：师父临终"剑可断恩怨，断不了人心；你且记得，正邪在心不在门"
`.trim();

export const WUXIA_SKILL: NarrativeSkill = {
  genreCode: "rpg-wuxia",
  tier: "tier1",
  matchKeywords: ["仙侠", "武侠", "修仙", "仙剑", "古剑", "太吾", "江湖", "修真", "古剑奇谭", "太吾绘卷", "鬼谷八荒"],
  // RPG 七单品链 ②-⑦（通用前驱之后）
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "detailed_outline",
    "plot_generation",
    "script_generation",
    ["quest_generation", "scene_plan"],
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
        style_guide: "仙侠武侠角色塑造：以情义羁绊编织群像，武学境界即心性外化；反派是走岔路的同道，照见主角的另一种可能。",
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

registerSkill(WUXIA_SKILL);
