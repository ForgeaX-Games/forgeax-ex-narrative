/**
 * hor-cosmic — 品类叙事包（克苏鲁 / 宇宙恐怖）★ 旗舰
 *
 * 碎片叙事型：恐怖不来自怪物的爪牙，而来自"理解本身的代价"。没有完整
 * L0-L5 主线，叙事由禁忌典籍、调查档案、扭曲遗物与不可名状的场景拼合。
 * 玩家越接近真相，理智越崩塌（克苏鲁的呼唤 / 沉没之城 / 死亡空间式宇宙恐怖）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 宇宙恐怖世界观原型（"人类只是宇宙的尘埃"）
- 冷漠宇宙母题：存在着远超人类理解的古老存在，它们不邪恶——只是对人类毫不在意
- 认知即诅咒：真相不带来力量而带来疯狂，"知道得越多，越无法做回正常人"
- 表象之下的真相：日常世界只是薄薄一层伪装，裂缝处渗出不可名状之物
- 禁忌知识体系：典籍、邪教仪式、远古铭文，构成可被拼合却不该被拼合的真相
- 不可名状原则：终极存在永不被完整描述，只以征兆、几何悖论、生理不适暗示
`.trim();

const WORLDVIEW_STYLE = `
- 语调：阴冷、智性、缓慢渗透的不安；恐惧来自"理解"而非"惊吓"
- 世界观以"日常表象 + 其下真相"双层铺设，让裂缝逐步扩大
- 用禁忌知识埋真相：调查越深，世界观的恐怖底色越清晰，理智越摇摇欲坠
- 不可名状须落到"暗示"：用反常的几何、错误的颜色、违背物理的现象侧写终极存在
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把古神写成"可被打败的大 Boss"；本品类的恐怖在于人类的彻底渺小
- 终极存在永不被完整呈现：只给征兆与侧影，正面描述即破坏宇宙恐怖
- 真相须可拆为禁忌典籍/调查碎片，且"拼合即代价"——理解本身就是惩罚
- 恐怖须建立在认知崩塌而非血腥，杜绝靠 Jump Scare 替代智性恐惧
`.trim();

const CHARACTER_ARCHETYPE = `
# 宇宙恐怖角色原型（窥见真相的凡人）
- 主角：调查员/学者/记者，以理性自诩，却将在求知中亲手摧毁自己的理智
- 理智系统作为"隐性角色"：恐惧、目击、禁忌知识持续侵蚀主角的精神状态
- 邪教徒/先知群像：他们或疯或"觉悟"，是主角可能的未来镜像
- 古神的"代行者"：被异化的人/物，是真相的活体征兆，从不正面解释自身
- 已疯的前调查者：以日记、涂鸦、被囚的躯壳出现，预演"知道太多"的下场
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的"理性"须是被摧毁的对象，杜绝全程清醒掌控的硬汉
- 理智侵蚀须真实改变主角的感知与叙述（不可靠叙事），而非纯数值
- 邪教徒须可被"部分理解"：他们的疯狂自有其扭曲逻辑，是主角的镜像
- 前调查者遗留须构成"认知崩塌预演"，与主角的下沉轨迹互相印证
`.trim();

const ITEM_DATABASE_STYLE = `
# 宇宙恐怖物品守则（禁忌之物即认知代价）
- 禁忌典籍是核心碎片：残页、铭文、仪式手稿，阅读即推进真相也即损耗理智
- 调查物证（照片、信件、解剖记录）拼出"不该被知道"的因果链
- 异常遗物违背常理：触感错误、几何悖论、看一眼就头痛的造物
- 道具描述用"侧写而非直陈"：暗示其来源与用途，留下令人不安的空白
- 关键禁忌物（启动仪式的器物）作为真相拼图核心，获取即代价的临界点
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁把禁忌物写成纯增益道具；获取与使用须伴随认知或理智代价
- 异常遗物须保持"不可名状"，用感受与悖论描述，杜绝清晰图解
- 典籍碎片须可"分散获得、拼合即惩罚"，单页留悬念却共同指向真相
- 物品文案语气统一为冷峻智性的考据感，杜绝现代说明书腔调
`.trim();

const SCENE_GENERATION_STYLE = `
# 宇宙恐怖环境叙事守则（用裂缝与悖论讲故事）
- 用"日常之下的异常"讲故事：正常小镇里一户全员失踪的屋子、海面下错误的轮廓
- 非欧几何与违和感：走廊比外观更长、角度不对的房间、不该存在的门
- 仪式现场叙事：祭坛、符号、献祭痕迹，暗示一场仍在进行或刚刚完成的召唤
- 渐进式现实崩坏：随真相揭露，环境从"略有不对"滑向"彻底不可理解"
- 留白与暗示优先：最恐怖的永远是镜头之外、描述边缘的那个东西
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须以"认知失调"营造恐怖，禁止靠血腥奇观替代智性不安
- 每个关键区域至少布置 2-3 处"日常裂缝"叙事点，与真相进度呼应
- 现实崩坏须单调递进，杜绝氛围在正常与崩坏间来回跳变
- 不可名状之物始终留白，慎用正面特写消解宇宙恐怖
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："沉没的海港小镇 / 宇宙恐怖 / 禁忌真相"
- 日常表象：一座以渔业闻名的小镇，居民眼神涣散、皮肤微异，海水气味挥之不去
- 认知裂缝：教堂地窖的非欧通道，越往下空间越不该如此，墙上铭文看久了灼眼
- 禁忌碎片：前调查员的日记从工整记录渐变为重复涂写同一句无法读懂的祷词
- 不可名状：终章只在退潮的海平线上露出"一段不属于任何已知生物的轮廓"，旋即没入
`.trim();

export const HOR_COSMIC_SKILL: NarrativeSkill = {
  genreCode: "hor-cosmic",
  tier: "tier2",
  matchKeywords: ["克苏鲁", "宇宙恐怖", "Lovecraft", "洛夫克拉夫特", "不可名状", "沉没之城", "The Sinking City", "调查恐怖", "禁忌知识", "认知崩塌"],
  // 碎片链：世界观 → 角色 → 道具 → 场景（无 L0-L5 主线）
  narrativeSteps: ["worldview", "character_enrichment", "item_database", "scene_plan"],
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
        style_guide: "宇宙恐怖角色塑造：主角的理性是被摧毁的对象，理智侵蚀化作不可靠叙事，前调查者预演认知崩塌。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(HOR_COSMIC_SKILL);
