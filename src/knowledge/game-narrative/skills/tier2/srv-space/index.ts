/**
 * srv-space — 品类叙事包（太空生存 / Space Survival）
 *
 * 太空生存 = 涌现叙事型（孤独太空 + 信号谜团）。叙事由"星际拓荒的孤独 + 未知信号的牵引"涌现：
 * 没有主线，故事来自一名拓荒者在浩瀚虚空中独自求生、追逐谜样信号、揭开宇宙寂静背后的秘密
 * （无人深空 / 星际拓荒 / 深岩银河 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → 剧情生成
 *
 * C3（2026-08）已封存：原品类特化的 emergent_event step 吸收进通用 plot_generation，
 * 事件分类配比/触发平衡守则改由 plot_generation 的 style_guide / constraints 槽位承载，
 * 形态差异交给 network/emergent/fragmented 三张结构卡区分。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 太空生存 世界观原型（"浩瀚虚空中的孤独拓荒"）
- 世界 = 近乎无垠的星海：行星、空间站残骸、星云、黑洞，处处是绝美亦致命的孤独
- 孤独是核心基调：补给有限、信号延迟、万里无人，求生的最大敌人是虚空与寂静
- 信号谜团驱动探索：来自深空的神秘信号/坐标/远古回响，牵引拓荒者一程程深入
- 环境即威胁：缺氧、辐射、极端温度、陨石带，宇宙的物理法则就是冷酷的猎手
- 宇宙的尺度与神秘：每颗星球都是一段未被书写的可能，谜底往往大过想象
`.trim();

const WORLDVIEW_STYLE = `
- 语调：孤寂、苍茫、带科幻的敬畏与不安，让虚空的浩瀚压在每段独白上
- 开局确立"独自漂流的处境"与一段牵引前行的信号谜团，作为探索锚点
- 用补给倒计时与信号延迟制造"孤立无援"的生存张力
- 把宇宙的绝美与致命并置，让每次着陆都兼具惊奇与危险
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把太空写成热闹背景；须放大"孤独 + 寂静 + 信号牵引"的核心基调
- 至少埋设 1 个贯穿性的"信号谜团"，并预留分阶段揭露的事件接口
- 环境威胁须遵循宇宙物理逻辑（缺氧/辐射/温差），构成持续的生存压力
- 探索须有纵深与未知感，星球/遗迹的谜底须能超出玩家初始想象
`.trim();

const CHARACTER_ARCHETYPE = `
# 太空生存 角色原型（孤独拓荒者与虚空回响）
- 拓荒者（玩家化身）：长期独处的求生者，性格由孤独中的抉择与独白逐步显影
- AI 伙伴/船载系统：唯一的"对话者"，以冷静或微妙拟人的口吻陪伴，缓解孤独
- 远方的声音：通过信号断续联系的他者（求救者、神秘广播、失联同伴），可信亦可疑
- 信号背后的存在：远古文明、休眠造物、未知智慧——谜团的最终人格化，神秘而疏离
`.trim();

const CHARACTER_CONSTRAINTS = `
- 拓荒者的性格须在孤独情境中通过独白与抉择缓慢显影，而非外部塑造
- AI 伙伴须有稳定语气人格，作为孤独基调的唯一情感出口，不可滥用为旁白机
- 信号背后的存在须保持信息不对称与疏离感，揭露须克制、留余味
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 太空生存 涌现事件池（分类配比）
- 信号/谜团事件（约 30%）：神秘信号、远古坐标、断续广播、谜底揭露——牵引探索的主驱动
- 生存危机事件（约 26%）：缺氧告急、燃料耗尽、舱体受损、辐射风暴——宇宙物理的冷酷施压
- 探索发现事件（约 22%）：异星奇观、遗迹废墟、稀有资源、未知生态——孤独中的惊奇奖励
- 孤独/心理事件（约 12%）：长期独处的幻觉、AI 伙伴的微妙变化、思乡独白——深化孤寂基调
- 邂逅事件（约 10%）：偶遇漂流者、求救信号、可疑访客——打破寂静的难得人际
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"补给状态/所在星域/探索进度/信号线索"，杜绝凭空降临
- 信号谜团须分阶段渐次揭露，维持"越追越深、谜底越大"的牵引节奏
- 生存危机须有前兆仪表信号，给玩家应急处置的窗口，避免无预警暴毙
- 孤独/心理事件须随独处时长累积，让寂静成为可被感知的压力源
- 每个抉择须改写拓荒者处境与谜团进度，后果在漫长航程中持续回响
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 航行日志 + 独白体：以孤独拓荒者对着虚空记录的口吻，写尽苍茫与执念
- 描述宇宙状态与所见所感，把求生与探索的决定留给玩家
- 善用寂静与尺度的对照："信号又响了一次，比上次近。除此之外，方圆十光年没有任何动静。"
- 谜团揭露给一句敬畏交织不安的注脚，生存危机留窒息般的紧张
`.trim();

export const SRV_SPACE_SKILL: NarrativeSkill = {
  genreCode: "srv-space",
  tier: "tier2",
  matchKeywords: ["太空生存", "无人深空", "星际拓荒", "深岩银河", "No Man's Sky", "Outer Wilds", "星际求生"],
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
        style_guide: "太空生存角色塑造：拓荒者性格在孤独抉择中显影，AI 伙伴是唯一情感出口；信号背后的存在保持疏离与信息不对称。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    // C3：原 emergent_event（涌现事件池）吸收进通用 plot_generation
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(SRV_SPACE_SKILL);
