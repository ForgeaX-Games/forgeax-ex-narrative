/**
 * puz-escape — 品类叙事包（密室逃脱）
 *
 * 碎片叙事型：没有完整 L0-L5 主线，叙事与谜题互为表里。线索道具、
 * 房间机关、解谜过程本身即叙事载体——每解开一道谜，就揭开一块真相
 * （极限脱出 / 锈湖 / 迷失岛 / 房间系列）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 密室逃脱世界观原型（"上锁的真相之屋"）
- 封闭密室母题：玩家被困于一个/一组上锁空间，"出去"与"弄懂为何被困"同步推进
- 谜题—叙事同构：每道谜题对应一块真相，房间结构本身就是故事的隐喻
- 幕后设计者：常有一个安排这场"游戏"的主使（绑架者/亡魂/命运），其意图是终极谜底
- 线索链结构：道具与符号环环相扣，前一谜的答案是后一谜的钥匙，也是真相的一环
- 多重反转土壤：表层是逃生，深层往往藏着关于角色身份/罪行/记忆的颠覆性真相
`.trim();

const WORLDVIEW_STYLE = `
- 语调：悬疑、智性、步步紧逼；解谜的"啊哈时刻"与真相揭露同频共振
- 世界观以"密室空间 + 真相分层"铺设，让每个房间承载一段可被解锁的故事
- 用线索链埋叙事：玩家"解谜即阅读"，逻辑推进与情节揭露严丝合缝
- 为反转留接口：早期线索须能在终局被重新解读，支撑"原来如此"的颠覆
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁谜题与叙事两张皮；每道核心谜题须对应一块可揭示的真相
- 真相须可拆进线索链，随解谜进度逐步显形，不靠旁白直接倾倒
- 幕后设计者的意图须可被线索逐步推理，杜绝空降的终局解释
- 反转须由前期可见的线索支撑，杜绝违背已给信息的强行翻盘
`.trim();

const CHARACTER_ARCHETYPE = `
# 密室逃脱角色原型（困局中的解谜者）
- 主角：被困者，常带记忆缺失/身份疑云，逃生过程也是自我真相的揭露过程
- 同困者群像（若有）：各怀秘密的被困者，彼此既是协作者也是嫌疑人
- 幕后设计者：安排这场困局的主使，全程以线索、留言、机关"在场而不现身"
- 缺席的关键人物：受害者/逝者/失踪者，其命运是密室存在的根本动因
- 不可靠的"我"：主角的认知可能被设计者操纵，叙事须为身份反转预留空间
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的身份/记忆须是被逐步揭露的谜题之一，杜绝开局即全知
- 同困者须各持可被线索印证的秘密，协作与猜疑并存
- 幕后设计者须以线索"在场而不现身"，意图随解谜浮现，杜绝早泄底
- 关键反转须建立在角色身份/记忆的合理铺设上，避免为反转而反转
`.trim();

const ITEM_DATABASE_STYLE = `
# 密室道具/线索守则（道具即谜题与真相的双面）
- 每件线索道具同时承担"解谜功能"与"叙事功能"：是钥匙，也是一块往事
- 道具描述埋可推理的细节：日期、刻痕、磨损，既助解谜也暗示真相
- 组合道具讲递进故事：A+B 得 C 的过程，对应一段因果的拼合
- 关键物证（照片、信件、遗物）在解谜节点揭示身份或罪行的颠覆性真相
- 道具文案克制留白：给出线索而不替玩家说破，保留"自己想通"的快感
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯功能性谜题道具；每件关键线索须同时携带一块叙事真相
- 道具线索须可被公平推理，杜绝缺乏铺垫的跳跃式答案
- 组合/递进道具的因果须自洽，与真相分层进度同步
- 关键物证须在恰当解谜节点释放反转，杜绝过早或过晚剧透
`.trim();

const SCENE_GENERATION_STYLE = `
# 密室环境叙事守则（用房间与机关讲故事）
- 房间布置即叙事：陈设、污渍、被改造的痕迹暗示这里曾发生过什么
- 机关与谜题嵌入空间故事：上锁的抽屉、被封的门、改装的家具皆有来历
- 空间的"异常点"是叙事钩子：不该出现的物件、被刻意遮盖的角落
- 随解谜推进的空间变化：打开一道门即进入真相的更深一层，环境氛围随之转沉
- 终局密室的揭示性布置：当最后一谜解开，整个空间的真相豁然贯通
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须让谜题与叙事互证，禁止纯逻辑谜题而无故事承载的空房
- 每个房间至少埋 2-3 处可推理的环境线索，与该房真相呼应
- 空间随解谜的变化须有逻辑递进，杜绝氛围跳脱
- 终局布置须能回收全程线索，达成"重看一遍全懂了"的揭示效果
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："海上孤宅 / 密室逃脱 / 记忆与罪"
- 密室结构：玄关→书房→地窖→灯塔顶，每个房间解锁主角的一段被封记忆
- 谜题—真相同构：书房保险箱密码是亡妻的忌日，解开即揭示主角与她的死有关
- 线索链：地窖找到的怀表停在事发时刻，与书房日历、灯塔日志三方互证案发经过
- 终局反转：所谓"逃出孤宅"实为主角直面自己亲手酿成的罪，幕后设计者正是其良心
`.trim();

export const PUZ_ESCAPE_SKILL: NarrativeSkill = {
  genreCode: "puz-escape",
  tier: "tier2",
  matchKeywords: ["密室逃脱", "escape room", "极限脱出", "Zero Escape", "锈湖", "Rusty Lake", "迷失岛", "房间系列", "The Room", "解谜逃脱"],
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
        style_guide: "密室逃脱角色塑造：主角身份与记忆本身即谜题，同困者各怀秘密，幕后设计者在场而不现身。",
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

registerSkill(PUZ_ESCAPE_SKILL);
