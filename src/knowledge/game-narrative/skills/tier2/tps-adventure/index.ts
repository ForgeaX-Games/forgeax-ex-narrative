/**
 * tps-adventure — 品类叙事包（TPS 冒险 / 第三人称射击冒险）
 *
 * TPS 冒险 = 史诗叙事型（超自然/科幻冒险）。其史诗在于"奇境探索 + 超常力量 + 高概念悬疑"：
 *   第三人称视角下，主角带着异常能力闯入一个诡谲世界，射击与超能、叙事与解谜交织
 *   （控制 / 心灵杀手 / 地平线）。强调氛围、谜题与世界异常感。
 *
 * 采用 RPG 七单品链（探索章节承载 L0-L4，任务∥场景表现关卡奇观）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# TPS 冒险世界观原型（"被异常侵蚀的世界"）
- 高概念异常：超自然现象/异变机械/平行维度——世界本身藏着一个待破解的核心谜团
- 规则诡谲但自洽：异常遵循某种内在逻辑（如"会改变的建筑""被叙述影响的现实"），可被探究
- 表象与真相的裂缝：看似正常的世界表层下，潜伏着令人不安的超常秩序
- 力量来源即叙事核心：主角的异能/装备根植于世界异常，使用它即是在触碰真相
- 奇观空间：会重构的密所、异变的自然、超现实的维度，每处都是谜题与战斗的复合舞台
`.trim();

const WORLDVIEW_STYLE = `
- 语调：诡谲、神秘、悬疑张力拉满；用"不对劲的熟悉感"营造毛骨悚然的好奇
- 每个区域绑定"异常现象 + 谜团线索 + 战斗/解谜潜能"三位一体
- 世界真相须层层揭示：从目击异常，到理解规则，到触及核心源头
- 高概念须可被玩家在探索中亲历验证，而非仅靠文档灌输
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁让异常沦为无逻辑的猎奇；核心谜团须有可被推演的内在规则
- 每个奇观空间须同时承担"氛围营造 + 谜题 + 战斗"，杜绝纯过场
- 高概念真相须有沿途铺设的证据链，结局揭示不可空降
- 主角力量须与世界异常同源，使用力量即推进对真相的认知
`.trim();

const CHARACTER_ARCHETYPE = `
# TPS 冒险角色原型（闯入异境的探寻者）
- 主角：怀抱个人执念（寻亲/解谜/自我救赎）闯入异常之地，逐渐被卷入更大真相
- 引路/对照者：神秘的局内人、亦敌亦友的同探者、只闻其声的神秘存在
- 反派/异常实体：常非传统恶人，而是"异常的化身/扭曲的秩序/失控的力量"
- 主角的内在异常：其能力或处境本身可能就是世界异常的一部分，身份存疑制造悬念
- 配角承担"理性锚点"：以相对正常的视角衬托世界之诡异，给玩家共情入口
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角动机须个人化且强烈，足以解释其深入险境的执着
- 主角与世界异常的关联须埋为悬念，逐步揭示其身份/能力的真相
- 反派/异常实体须有"非人逻辑"的可怖感，但行为须自洽于世界规则
- 须保留至少 1 个"理性视角"配角，作为玩家理解异常的共情锚点
`.trim();

const STORY_FRAMEWORK_STYLE = `
# TPS 冒险故事框架（探索—解谜—真相揭示）
- L0 以"异境探索章节"铺设：闯入异常 → 逐层破解规则与谜团 → 直面真相源头 → 抉择与了局
- 节奏交替：战斗紧张段 ↔ 解谜探索段 ↔ 诡谲演出段，维持悬疑张力
- 每章揭开一层"世界异常的真相"，同时逼近主角自身身份之谜
- 终局须同时解开"世界谜团"与"主角谜团"，给出令人回味的高概念落点
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每章的"异常现象 + 谜团增量 + 玩法奇观"
- 世界谜团与主角身份谜团须双线交织，并在终局共同收束
- 真相揭示须有伏笔支撑，悬疑不得靠廉价 jump scare 或空降反转维系
- 战斗须承担叙事职能（揭示力量本质/推进探索），杜绝纯刷怪填充
`.trim();

const SCRIPT_GENERATION_STYLE = `
# TPS 冒险剧本写作守则（氛围·内心独白·碎片真相）
- 善用主角内心独白：在诡谲探索中以第一人称感受锚定玩家情绪与悬念
- 碎片化叙事：录音、档案、电视讯号、异常笔记，让玩家拼凑非线性真相
- 神秘角色的台词玄而不晦：暗示而不点破，喂线索又添谜团
- 关键揭示时刻须给"认知重构"的震撼，并立即抛出新的疑问维持张力
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式旁白（"能量值不足"），须转译为主角对自身力量的感知
- 碎片叙事须可拼合成自洽真相，杜绝为悬疑而留的无解坑
- 神秘台词须暗藏可验证的线索，不得是纯故弄玄虚
- 内心独白须服务于悬念与情绪，避免直白剧透或冗长说明
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："会重构的办公大楼 / TPS 冒险 / 寻找失踪的弟弟"
- 异常规则：大楼内部空间随'某种力量'潮汐般重构，唯持有'异物'者可暂时锚定现实
- 奇观空间：不断翻转的档案室，既是解谜迷宫又是异常实体的猎场
- 双线谜团：主角寻找失踪弟弟的线索，逐渐指向'她自己才是异常的源头'
- 碎片真相：监控录像里，一个月前的主角做出了她毫无记忆的举动
`.trim();

export const TPS_ADVENTURE_SKILL: NarrativeSkill = {
  genreCode: "tps-adventure",
  tier: "tier2",
  matchKeywords: ["tps", "第三人称射击", "控制", "心灵杀手", "地平线", "Control", "Alan Wake", "Horizon", "超自然冒险"],
  // RPG 七单品链 ②-⑦（异境探索章节承载 L0-L4）
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
        style_guide: "TPS 冒险角色塑造：主角是怀抱执念闯入异境的探寻者，其身份与世界异常同源成谜；反派是非人逻辑的异常化身，配角充当理性锚点。",
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

registerSkill(TPS_ADVENTURE_SKILL);
