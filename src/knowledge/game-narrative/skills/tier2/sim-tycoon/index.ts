/**
 * sim-tycoon — 品类叙事包（经营管理 / Tycoon & Management）
 *
 * 经营管理 = 涌现叙事型。叙事由「经营压力下的小人物群像 + 系统连锁危机」涌现：
 * 没有主角剧本，故事来自一座城市/一家医院/一座基地在玩家调度下的兴衰
 * （缺氧 / 城市天际线 / 双点医院 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → plot_generation（涌现事件生成）
 *
 * C3（2026-08）已封存：原品类特化 step `emergent_event` 吸收进通用 `plot_generation`，
 * 本品类的事件分类配比/触发平衡守则改为以 skill 形式挂载在 plot_generation 的
 * style_guide / constraints 槽位上，形态差异交给 network/emergent/fragmented 结构卡表达。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 经营管理 世界观原型（"在约束中运转的系统机体"）
- 世界 = 一台精密咬合的系统机体：资源链、人流、能耗、现金流环环相扣，牵一发动全身
- 经营标的有"性格"：一座城市的拥堵焦虑、一家医院的荒诞病症、一座基地的窒息危机
- 约束即叙事：预算、空间、人手、时限的稀缺，把每个决策逼成取舍
- 运营周期：建设期 → 扩张期 → 瓶颈期 → 危机期，节奏决定故事的呼吸
- 外部环境压力：经济波动、政策法规、天灾事故，从系统之外打破玩家的精密平衡
`.trim();

const WORLDVIEW_STYLE = `
- 语调：举重若轻的黑色幽默 + 烟火气，让冰冷的系统数据透出人间百态
- 开局给出"经营标的的性格"与一处显而易见的隐患，预埋第一场连锁危机
- 用资源链的相互依赖制造"按下葫芦浮起瓢"的叙事张力
- 让宏观运营曲线与微观小人物命运互相映照
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把世界写成静态沙盘；系统须有可被玩家决策扰动的动态平衡
- 每种核心资源/系统须与其他系统存在依赖，让单点故障可引发连锁
- 至少铺设 2 处"结构性瓶颈"作为危机事件的发火点
- 不预设成败；世界须为"扩张/精修/止损"等多种经营路线供给空间
`.trim();

const CHARACTER_ARCHETYPE = `
# 经营管理 角色原型（系统齿轮上的小人物群像）
- 员工/居民/病患群像：被系统裹挟的普通人，有各自的诉求、抱怨与小确幸
- 关键岗位人物：得力主管、捅娄子的新手、难缠的检查员，影响运营事件走向
- 玩家 = 隐形的管理者之手：以调度决策"间接"塑造众生相，少有直接登场
- 外部角色：投资人、市政官员、竞争对手，从系统边界施加压力与诱惑
`.trim();

const CHARACTER_CONSTRAINTS = `
- 群像须从"系统压力"中生长出个性：拥挤让人暴躁、富足让人懈怠
- 关键人物的行为须能反作用于运营系统（罢工/失误/超常发挥）
- 玩家以决策间接塑造众生，避免强行安插主角式人物
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 经营管理 涌现事件池（分类配比）
- 运营危机事件（约 32%）：资源断供、连锁停摆、瘟疫/事故、现金流断裂——逼出取舍
- 小人物事件（约 24%）：员工纠纷、居民请愿、病患奇遇、罢工/喜讯——系统中的人情戏
- 机遇事件（约 18%）：投资入局、新技术、政策红利、明星顾客来访——引发扩张抉择
- 外部压力事件（约 14%）：经济衰退、突击检查、竞争对手、舆论风波——系统外的冲击
- 连锁事件（约 12%）：一处故障触发多米诺，蝴蝶效应改写整盘经营
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取系统真实状态（负载/库存/满意度/现金），杜绝凭空弹窗
- 危机须有"前兆信号"，让细心的玩家有预警与补救的窗口
- 连锁事件须沿资源依赖链传导，体现"系统讲故事"而非孤立随机
- 每个抉择须改写系统状态（产能/口碑/财务），后果在后续周期持续发酵
- 顺境给"扩张诱惑"，逆境给"翻身机遇"，维持经营的张弛节奏
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 烟火气 + 黑色幽默：把一次停电写成全城/全院的荒诞群像速写
- 描述系统状态变化而非指令玩家，把调度判断留给管理者
- 借小人物之口折射宏观危机："食堂阿姨说，今天连土豆都不够分了。"
- 重大事件给一句运营编年式的冷峻收束，让数字背后有人味
`.trim();

export const SIM_TYCOON_SKILL: NarrativeSkill = {
  genreCode: "sim-tycoon",
  tier: "tier2",
  matchKeywords: ["经营", "管理", "缺氧", "城市天际线", "双点医院", "tycoon", "模拟经营", "Oxygen Not Included"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: "经营管理角色塑造：小人物从系统压力中生长个性，关键人物的行为反作用于运营；玩家以调度间接塑造众生相。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(SIM_TYCOON_SKILL);
