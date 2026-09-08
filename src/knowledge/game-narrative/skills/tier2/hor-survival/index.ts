/**
 * hor-survival — 品类叙事包（生存恐怖）
 *
 * 碎片叙事型：恐怖的核心是"匮乏本身"。没有完整 L0-L5 主线，叙事由
 * 资源管理压力、档案碎片、怪物生态与环境恐怖共同承载。玩家在弹药、
 * 存档、背包都稀缺的处境里步步惊心（生化危机 / 死亡空间）。
 *
 * 与 adv-horror 的区别：本品类把"资源稀缺"提升为恐怖的第一性来源。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 生存恐怖世界观原型（"资源枯竭的死亡牢笼"）
- 隔绝绝境：太空船、孤立设施、封锁城区——逃生通道被切断，补给彻底断绝
- 匮乏即恐怖：弹药/医疗/存档机会的稀缺，让每次遭遇都是一场资源豪赌
- 灾变母题：外星寄生/病毒/异变把封闭空间变成"资源越走越少"的死亡漏斗
- 怪物的"耐久恐怖"：敌人难缠、难杀、可复活，逼迫玩家权衡"打还是逃"
- 真相藏于设施档案：研究记录、求救通讯、船员日志拼出灾变与孤立的全貌
`.trim();

const WORLDVIEW_STYLE = `
- 语调：窒息、紧绷、步步算计的恐惧；安全是奢侈品，资源是生命线
- 世界观以"封闭设施地图 + 资源稀缺梯度"铺设：越深入补给越枯竭
- 恐怖来自"准备不足"的预感：环境处处暗示"你的子弹不够用"
- 为资源循环留接口：补给点、存档机制、可回溯路线须服务于紧绷节奏
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁让资源充裕化，"匮乏"是本品类恐怖的第一性来源，须贯穿始终
- 怪物须难缠到值得"逃避"，杜绝可被无脑清场的低威胁杂兵
- 灾变真相须可拆为可拾取的设施档案，不靠线性过场倾倒
- 隔绝逻辑须自洽：为何无法呼救、无法离开，须有可信的世界设定支撑
`.trim();

const CHARACTER_ARCHETYPE = `
# 生存恐怖角色原型（资源短缺中的幸存者）
- 主角：工程师/士兵/普通船员，专业但非超人，子弹一空便只剩奔逃
- 船员/研究员群像：以日志、尸体、最后通讯"缺席登场"，预演资源耗尽后的崩溃
- 怪物作为"角色"：异变体须有可读来源（同事的躯壳），强化"杀的是谁"的不安
- 远程指引者：耳机里的幸存同伴/AI，可能可靠、可能别有目的，制造信任张力
- 内在对手：恐慌与资源焦虑的拉锯，是比怪物更持久的心理敌人
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的脆弱须体现在"资源耗尽即失能"，杜绝弹药无限的硬汉幻觉
- 亡者遗留须构成"匮乏预演"：他们如何因弹尽粮绝而崩溃，预示主角处境
- 怪物须可读出"它曾是设施里的谁"，强化杀戮的道德与情绪重量
- 远程指引者须保留可信度悬念，杜绝纯工具人式的全知向导
`.trim();

const ITEM_DATABASE_STYLE = `
# 生存恐怖物资/档案守则（道具描述即匮乏叙事）
- 每件物资文案传达"算计感"：弹药、医疗、存档道具都关乎生死取舍
- 背包/容量是叙事的一部分：携带什么、舍弃什么，本身就是处境的写照
- 拾得的私人物品讲遇难者故事，让冰冷设施里的死亡落到具体的人
- 升级/合成材料的稀缺暗示"何处该省、何处该赌"，渗透生存焦虑
- 关键档案（黑匣、研究样本、求救录音）作为真相拼图，藏于高威胁区域
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁让物资描述传达充裕感；每件消耗品都应放大"不够用"的焦虑
- 物资 Lore 须与设施灾变史自洽，杜绝设定错位
- 背包/取舍机制须真正参与叙事，而非纯系统提示
- 关键真相档案须置于与风险匹配的高威胁区，杜绝唾手可得
`.trim();

const SCENE_GENERATION_STYLE = `
# 生存恐怖环境叙事守则（用枯竭现场讲故事）
- 用"资源争夺现场"讲故事：被洗劫一空的医疗站、弹尽的最后防线、堆叠的路障
- 尸体与防御工事揭示前人的绝望策略：他们守在哪、撑了多久、败在何处
- 黑暗与狭窄空间放大资源焦虑：手电电量、视野受限本身即恐怖语言
- 怪物巢穴/异变区的环境暗示生态扩散，让"越深越危险"可被看见
- 存档点的微弱安全感与下一段未知黑暗形成强烈的心理反差
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须承载匮乏叙事，禁止只做战斗场地的功能性堆砌
- 每个关键区域至少布置 2-3 处资源枯竭/前人防御现场，与匮乏母题呼应
- 安全区须真正稀缺，杜绝频繁补给点稀释紧绷节奏
- 环境恶化与生态扩散须有时序逻辑，可被玩家理解
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："死寂矿业飞船 / 生存恐怖 / 异变寄生"
- 隔绝绝境：曲速引擎损毁，飞船漂流于深空，无法呼救亦无法靠岸
- 匮乏梯度：医疗层尚有补给，越往动力核心区弹药越绝，逼出"打还是逃"的豪赌
- 怪物来源：异变体由感染船员变成，断裂工牌显示它曾是发出第一封求救的人
- 现场叙事：货舱里被路障围死的角落，散落空弹匣与一具自尽的尸体，无字而尽诉绝望
`.trim();

export const HOR_SURVIVAL_SKILL: NarrativeSkill = {
  genreCode: "hor-survival",
  tier: "tier2",
  matchKeywords: ["生存恐怖", "survival horror", "生化危机", "Resident Evil", "死亡空间", "Dead Space", "资源管理恐怖", "弹药稀缺"],
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
        style_guide: "生存恐怖角色塑造：脆弱源于资源耗尽即失能，亡者遗留预演匮乏崩溃，怪物是同事的躯壳。",
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

registerSkill(HOR_SURVIVAL_SKILL);
