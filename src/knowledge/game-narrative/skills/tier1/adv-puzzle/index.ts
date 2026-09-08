/**
 * adv-puzzle — 品类叙事包（解谜冒险 / Puzzle Adventure）
 *
 * 解谜冒险 = 分支叙事型（谜题主导，角色轻量）。叙事服务于"机制谜题的递进顿悟"，
 * 故事常以极简姿态藏在环境与机制背后（传送门 / 时空幻境Braid / 见证者）。
 *
 * 谜题主导链（通用前驱 偏好→初步方案 之后，角色轻量故省略 character）：
 *   世界观 → 大纲（谜题关卡链） → 情节（极简旁白） → 场景生成（谜题空间）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 解谜冒险世界观原型（"一条核心机制撑起的世界"）
- 世界围绕"一个核心谜题机制"展开：传送门的空间折叠、Braid 的时间倒流、见证者的视觉规则
- 设定即规则：世界的物理/逻辑法则本身就是谜题的语言，玩家在解谜中读懂世界
- 极简叙事载体：故事碎片散落于环境、机关、零星文本，靠玩家主动拼合
- 留白哲学：世界不解释一切，"未言明的意味"是叙事张力的来源
- 机制递进 = 认知递进：每解锁一层机制，玩家对世界本质的理解也加深一层
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷静、思辨、带一丝智性的孤寂或惊奇
- 世界须由"一条可深挖的核心机制"统领，所有关卡都是该机制的变奏
- 叙事信息以最小剂量投放：让环境与机制"自己说话"，而非旁白灌输
- 机制每深化一层，须对应揭开世界本质的一小片，形成认知与玩法的共振
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁堆砌庞杂设定；世界须紧扣单一核心机制，保持思辨的纯粹
- 叙事须靠留白与暗示承载，杜绝大段背景说明打断解谜心流
- 核心机制的规则须自洽且可被玩家逐步习得，杜绝随意改写规则坑人
- 世界本质的揭示须与机制递进同步，杜绝叙事与玩法两张皮
`.trim();

const BRANCH_TREE_STYLE = `
# 解谜冒险关卡链设计守则（认知阶梯）
- 主结构是"机制教学—变奏—综合—颠覆"的认知阶梯，而非剧情分支树
- 每一关引入或叠加一个机制变量，难度与理解度同步爬升
- 设"顿悟节点"：玩家突然领会机制更深用法的高光时刻，是品类灵魂
- 末段常设"机制颠覆/规则反转"，让玩家重新理解之前学到的一切
- 可设少量可选谜题/隐藏房间承载额外叙事碎片，主线保持清晰递进
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 机制引入须循序渐进，杜绝跳跃式难度劝退
- 每关解法须唯一清晰或有限可控，杜绝歧义解或穷举碰运气
- 顿悟节点须由前置铺垫自然导出，杜绝凭空冒出的设计师陷阱
- 末段反转须公平：所需认知在前文已埋伏笔，杜绝"为反转而反转"
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 解谜冒险脚本风格（极简旁白 + 环境文本）
- 文本极简克制：宁少勿多，一句意味深长胜过十句解说
- 叙事碎片以"环境铭文/系统低语/零星独白"形式散落，等待玩家拼合
- 旁白可带哲思或反讽（如 GLaDOS 式机械幽默），但服务于氛围而非喧闹
- 关键顿悟时刻可给一句点睛文本，强化"我懂了"的智性快感
- 留白即语言：用沉默、空镜、未完成的句子承载未言明之意
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 严禁话痨式旁白；任何文本须经得起"删掉是否更好"的拷问
- 文本不得直接报谜题答案，至多给意味深长的方向暗示
- 叙事碎片须可被玩家以任意顺序拾取而不破坏理解，杜绝强线性说明
- 系统旁白若拟人化，其口吻须全程统一，杜绝忽冷忽热的调性漂移
`.trim();

const SCENE_GENERATION_STYLE = `
# 解谜冒险场景生成守则（谜题即空间）
- 场景本身就是谜题载体：空间布局、光影、机关位置都是解谜信息
- 视觉须服务于"可读性"：玩家须能一眼看清哪些元素可交互、机制如何运作
- 用环境叙事承载故事：墙上的痕迹、废弃的装置、空间的演变暗示世界历史
- 美学极简而有辨识度（传送门的洁净实验室 / Braid 的油画质感），强化品类气质
- 谜题空间的氛围须随认知阶梯演进，末段空间可呼应"规则颠覆"的视觉冲击
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："时间倒流 / 解谜冒险 / Braid 式追忆与悔意"
- 核心机制：可倒流时间，但某些染色物件不受倒流影响，制造时空错位谜题
- 认知阶梯：教学倒流 → 染色例外 → 时间与空间耦合 → 末段揭示"追逐的人其实是过去的自己"
- 极简叙事：每个世界入口的书页文本，似在讲解谜，实则吐露主角的悔与执念
- 顿悟节点：玩家领悟"无法挽回的，正是不受倒流影响的那部分"——机制即主题
`.trim();

export const ADV_PUZZLE_SKILL: NarrativeSkill = {
  genreCode: "adv-puzzle",
  tier: "tier1",
  matchKeywords: ["解谜冒险", "传送门", "Portal", "braid", "时空幻境", "见证者", "The Witness", "机制解谜"],
  // 谜题主导链（角色轻量，省略 character_enrichment）
  narrativeSteps: [
    "worldview",         // ②
    "story_framework",
    "outline_batch",     // 谜题关卡链
    "plot_generation",   // 极简旁白
    "scene_plan",  // ⑦ 谜题空间
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
    outline_batch: {
      slots: {
        style_guide: BRANCH_TREE_STYLE,
        constraints: BRANCH_TREE_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: DIALOGUE_SCRIPT_STYLE,
        constraints: DIALOGUE_SCRIPT_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
      },
    },
  },
};

registerSkill(ADV_PUZZLE_SKILL);
