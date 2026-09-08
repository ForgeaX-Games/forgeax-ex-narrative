/**
 * adv-horror — 品类叙事包（恐怖冒险）
 *
 * 碎片叙事型：没有完整 L0-L5 主线，恐怖叙事由"资源稀缺的探索 + 档案碎片 +
 * 怪物生态 + 环境恐怖"层层渗透。玩家在受限空间里探索、解谜、躲避，
 * 用拾取的文件与现场痕迹拼出灾变真相（生化危机 / 寂静岭 / 逃生）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 恐怖冒险世界观原型（"封闭崩坏之地的灾变现场"）
- 封闭舞台：洋馆、医院、废村、研究所——一个与外界隔绝、不能轻易逃离的空间
- 灾变母题：一次实验失控/邪教仪式/瘟疫蔓延，把日常空间变成了恐怖现场
- 真相藏于档案：研究日志、患者病历、信件录音，构成可拾取拼合的灾变史
- 怪物生态自洽：恐怖生物有可被理解的来源与行为逻辑，而非随机惊吓
- 探索—解谜—躲避循环：世界结构须支撑"钥匙—门—资源"的受限推进
`.trim();

const WORLDVIEW_STYLE = `
- 语调：压抑、悬疑、渗透性恐惧；安全区与危险区的强烈反差
- 世界观以"封闭空间地图 + 灾变时间线"双轴铺设，让恐怖有来龙去脉
- 用档案碎片埋真相：让玩家"边逃边读"逐步理解发生了什么
- 为受限探索留接口：区域解锁、资源点、存档点须服务于张弛节奏
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁纯 Jump Scare 堆砌；恐怖须建立在可理解的灾变逻辑之上
- 灾变真相须可拆为可拾取、可分布的档案碎片，不靠线性过场倾倒
- 封闭空间须有自洽的连通逻辑，杜绝为难玩家的无理迷宫
- 怪物生态须与灾变根源呼应，禁止无来源的随机怪物
`.trim();

const CHARACTER_ARCHETYPE = `
# 恐怖冒险角色原型（闯入灾变现场的人）
- 主角：调查者/幸存者/搜救者，能力有限、易受伤，恐惧是其常态而非耻辱
- 灾变亲历者群像：以日志、尸体、留言"缺席登场"，他们的崩溃预演主角的处境
- 怪物作为"角色"：层主级敌人/追猎者须有可读来历，是受害者的扭曲化身
- 幕后黑手：制造灾变的研究者/教主，全程以文件与音像现身，终局方对峙
- 求生中的人性：遇到的其他幸存者，信任与背叛都带致命的恐怖重量
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角须保有"凡人脆弱感"：资源有限、会恐惧、会犯错，杜绝无敌战士
- 灾变亲历者遗留须构成"恐惧预演"，与主角当前处境互相印证
- 怪物须可读出"它曾经是什么"，杜绝纯吓人的无背景怪物
- 幕后黑手的动机须可被档案逐步揭示，避免空降的终局反派
`.trim();

const ITEM_DATABASE_STYLE = `
# 恐怖冒险物资/档案守则（道具描述即灾变碎片）
- 档案文件是核心碎片：日志、病历、信件、录音带，附完整可读的灾变片段
- 资源物资（弹药、医疗、钥匙）文案传达稀缺与代价：每一发子弹都是抉择
- 拾得的私人物品讲遇难者故事：一张全家福、一封未寄信，让恐怖落到具体的人
- 关键道具（保险箱密码、特殊钥匙）绑定解谜，让叙事与谜题互相印证
- 怪物相关物证（变异样本、研究照片）暗示生态来源，深化恐怖的"可理解性"
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯数值物资表；每件值得记忆的拾得物都带灾变或人物碎片
- 物资文案须传达稀缺与抉择压力，杜绝弹药医疗充裕的安全感
- 档案碎片须可"分散拾取、整体拼合"，单件留悬念却共同指向真相
- 关键道具与解谜须自洽，杜绝与谜题脱节的纯装饰文件
`.trim();

const SCENE_GENERATION_STYLE = `
# 恐怖冒险环境叙事守则（用现场与尸体讲故事）
- 用"灾变定格现场"讲故事：翻倒的家具、墙上的血字、抓痕、被堵死的门
- 尸体是叙事节点：死法、姿态、随身物揭示这个人遭遇了什么
- 安全区与恐怖区的反差设计：存档点的微光与走廊尽头的黑暗互为张力
- 声音设计的叙事化：远处的脚步、管道的低鸣、突然停止的音乐盒
- 环境随进度恶化：同一空间二次经过时的变化（多了一具尸体）制造心理压迫
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须主动叙事，禁止只为吓人而设的无逻辑惊吓房间
- 每个关键区域至少布置 2-3 处灾变现场/尸体叙事点，与灾变史呼应
- 安全区与恐怖区的节奏反差须经过设计，杜绝持续高压导致的恐惧钝化
- 环境恶化须有时序逻辑，二次经过的变化要可被理解
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："废弃研究所 / 恐怖冒险 / 实验失控"
- 封闭舞台：地下三层的生物研究所，电梯故障，唯一出路是逐层解谜
- 灾变时间线：从"项目立项"到"样本暴动"，由散落的研究日志逐页拼出
- 怪物生态：走廊里的追猎者是被实验改造的首席研究员，胸牌仍挂在变异躯体上
- 现场叙事：休息室定格着一桌没吃完的庆功宴，暗示暴动发生在成功的当晚
`.trim();

export const ADV_HORROR_SKILL: NarrativeSkill = {
  genreCode: "adv-horror",
  tier: "tier2",
  matchKeywords: ["恐怖冒险", "恐怖", "生化危机", "Resident Evil", "寂静岭", "Silent Hill", "逃生", "Outlast", "生存恐怖冒险"],
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
        style_guide: "恐怖冒险角色塑造：主角保有凡人脆弱感，亲历者遗留预演恐惧，怪物是受害者的扭曲化身。",
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

registerSkill(ADV_HORROR_SKILL);
