/**
 * fps-br — 品类叙事包（大逃杀 / Battle Royale）
 *
 * 大逃杀 = 运营叙事型（世界观碎片 + 赛季叙事 + 角色台词）。以"Apex / 堡垒之夜 / PUBG"为代表：
 * 玩法本身不含线性剧情，叙事是"赛季为单位推进的世界观碎片"——通过赛季活动、地图变化、
 * 传奇角色台词与短片持续揭露。角色与世界观为长期资产，每赛季产出新内容。
 *
 * 采用运营叙事链（轻量，角色 Lore + 赛季驱动）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 任务(赛季叙事/事件)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 大逃杀世界观原型（"被包装成竞技秀的危险舞台"）
- 元设定：把"百人混战"包装成世界观内自洽的赛事/竞技秀/求生实验（如传奇竞赛、风暴)
- 舞台化地图：战场是被设计的竞技场/被改造的区域，地图本身承载世界观与赛季变化
- 缩圈机制叙事化：用"风暴/毒气/能量场"等设定为强制收缩提供世界观解释
- 角色来自五湖四海：传奇/选手/幸存者各有来历，世界观为多元角色登场供给舞台
- 持续演变的世界：地图与格局随赛季推进而改变，世界观是"活的、会被事件改写的"
`.trim();

const WORLDVIEW_STYLE = `
- 语调：酷、潮、张扬；带竞技秀的娱乐感与求生的紧张感并置
- 世界观以"舞台设定 + 缩圈解释 + 赛季演变"呈现，重氛围与风格而非长篇史诗
- 用赛季事件驱动世界变化：地图改造、新区域开放本身就是叙事
- 碎片化优先：世界观靠零散线索拼凑，留给玩家社区考据与脑补的空间
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 须为"百人混战/缩圈"提供世界观内自洽的合理解释，不可让玩法与设定割裂
- 世界观须可随赛季被改写（地图/格局演变），禁止写死静态终局
- 须能容纳持续涌入、风格各异的新角色，禁止封闭固定角色表
- 叙事保持碎片化与氛围感，禁止强行塞入冗长线性主线
`.trim();

const CHARACTER_ARCHETYPE = `
# 大逃杀角色原型（潮酷的传奇群像）
- 传奇/选手是核心资产：每个角色 = 强烈潮酷造型 + 来历 + 个性 + 解锁式背景故事
- 人设张扬好记：夸张的性格、标志性技能与口头禅，服务直播/社交时代的传播
- 背景故事随赛季释出：参赛动机、过往羁绊通过赛季短片/活动逐步解锁
- 角色关系网：传奇之间的友谊/竞争/血仇，构成可持续挖掘的群像八卦
- 台词即人格：登场语、击杀台词、互动语音承载性格与世界观线索，金句优先
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每名角色须能脱离主线被单独理解，背景支持赛季式碎片释出
- 人设须张扬、高辨识度且彼此区隔，禁止性格雷同的角色
- 背景须留"未解之谜"钩子，便于后续赛季逐步揭露
- 台词须凝练出彩、可传播，避免冗长说教式独白
`.trim();

const QUEST_GENERATION_STYLE = `
# 大逃杀叙事产出（赛季叙事 / 限时事件）
- 以"赛季"为叙事单位：每赛季一个主题事件，驱动地图改造、新角色登场与世界观推进
- 赛季短片/动画：开季用一支风格化短片交代本赛季冲突与新传奇登场
- 限时叙事活动：围绕赛季主题的 PVE/特殊模式，把世界观事件做成可玩内容
- 地图叙事变化：通过地图区域的改造/毁灭/新建，让玩家"亲历"世界演变
- 角色语音彩蛋：随赛季更新登场/互动台词，用只言片语推进角色关系与悬念
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 叙事须以赛季为节奏单位，碎片化释出，禁止线性长任务链
- 赛季内容须推进而非颠覆世界观，长期资产（角色/舞台）保持连续性
- 限时活动剧情须与赛季主题强绑定，服务新角色/新区域的曝光
- 台词与彩蛋须精炼可传播，留考据空间，杜绝信息倾倒式叙述
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："Apex 式大逃杀 / 传奇竞赛 / 赛季叙事"
- 世界观：'边境传奇竞赛'——危险星球上被直播的求生秀，能量风暴负责缩圈
- 新传奇：流亡黑客'回声'，为找寻失踪兄长参赛，背景随赛季短片解锁
- 赛季事件：第N赛季'断裂'——主城地图遭轨道炮轰击改造，开放全新废墟区
- 登场台词："镜头都准备好了？那就让他们看场好戏。"
`.trim();

export const FPS_BR_SKILL: NarrativeSkill = {
  genreCode: "fps-br",
  tier: "tier3",
  matchKeywords: ["大逃杀", "吃鸡", "apex", "堡垒之夜", "pubg", "fortnite", "battle royale", "br"],
  // 运营叙事链（轻量，角色 Lore + 赛季驱动）：世界观 → 角色 → 任务(赛季叙事)
  narrativeSteps: ["worldview", "character_enrichment", "quest_generation"],
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
        style_guide: "大逃杀角色塑造：传奇是潮酷的核心资产，人设张扬好记、背景随赛季碎片释出，台词金句即人格名片，角色关系网可持续挖掘。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    quest_generation: {
      slots: {
        style_guide: QUEST_GENERATION_STYLE,
        constraints: QUEST_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(FPS_BR_SKILL);
