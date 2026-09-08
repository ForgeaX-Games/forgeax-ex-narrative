/**
 * act-linear — 品类叙事包（3A 线性动作）
 *
 * 3A 线性动作 = 史诗叙事型（电影化叙事）。其史诗依托"精心编排的线性流程"，
 * 以电影级演出、角色弧光与情绪节奏取胜（战神 / 最后生还者 / 鬼泣）。
 * 叙事强电影感、强角色，但探索/任务自由度低（线性走廊式推进）。
 *
 * 采用 RPG 七单品链的线性裁剪版（去任务并行，保留场景演出链）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → L0-L4 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 3A 线性动作世界观原型（"为镜头而生的舞台"）
- 世界为情绪服务：每个场景的环境设计都是一段情绪的视觉外化，而非开放探索的沙盒
- 强主题母题：父子/救赎/复仇/牺牲等单一而厚重的母题贯穿始终，世界观围绕母题收束
- 沿途叙事(set-piece)：以一连串高潮"演出段落"为骨架，世界在玩家行进中逐幕展开
- 受控信息释放：玩家所知与主角同步，靠演出与环境逐步揭示，而非自由检索
- 世界规模"窄而深"：地点不求广，但每处都经得起电影镜头的特写推敲
`.trim();

const WORLDVIEW_STYLE = `
- 语调：电影化、沉浸、强代入；以"一镜到底"的连续感构想世界呈现
- 每个区域绑定一个"情绪功能"（喘息/紧张升级/情感爆发/高潮决战）
- 环境叙事服务于角色心境：场景的破败/壮丽须呼应主角此刻的内在状态
- 世界观为"线性节奏"留好张弛：高潮之间须有让玩家与角色共同呼吸的低谷段落
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写成开放世界式的散点设定；世界须沿一条情绪曲线被有序揭示
- 每个 set-piece 场景必须同时承担"动作奇观"与"叙事推进"双重职能
- 信息释放须与主角认知同步，不得让世界观超前于角色的所见所感
- 场景密度服从节奏：宁可少而精，杜绝为体量而注水的无意义区域
`.trim();

const CHARACTER_ARCHETYPE = `
# 3A 线性动作角色原型（被镜头凝视的主角）
- 主角是绝对叙事核心：拥有清晰、可被一句话概括却足够沉重的核心创伤/执念
- 主角弧光是全程主轴：从某种"残缺/封闭"状态，经由旅程被撬动、转变
- 关键配角少而重：每个出场角色都是推动主角弧光的"催化剂"，无纯功能龙套
- 反派是主题的具象化：其存在就是为了逼问主角"你究竟是谁/你愿付出什么"
- 强表演细节：角色的微表情、肢体、停顿与未说出口的台词同等重要
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角弧光须有清晰的"起点状态—转变契机—终点状态"三点，全程可追踪
- 配角不得多而散；每个角色须明确"为主角弧光提供了哪一推力"
- 反派动机须与主角主题同源对照，构成"一体两面"的逼问
- 角色情感转变须由演出与处境累积驱动，杜绝靠台词直接宣告心境
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 3A 线性动作故事框架（电影三幕 + 演出节拍）
- L0 按电影化三幕铺设：建置(创伤现状+旅程动因) → 对抗(逐级升级的 set-piece + 中点重大转折) → 解决(情感清算+高潮决战+落幕)
- 以"动作高潮"与"情感低谷"交替编排节奏曲线，杜绝持续高压或持续平淡
- 每一幕须有一个"不可逆的代价/失去"，推动主角弧光向前
- 设计明确的"中点转折"(midpoint)：颠覆主角或玩家此前的认知/目标
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须显式标注每个 set-piece 的"动作奇观 + 叙事职能 + 情绪坐标"
- 结局须是主角弧光的必然兑现，而非外部事件的偶然了结
- 节奏曲线须张弛分明：相邻演出段落不得情绪强度雷同
- 中点转折须真正改写后半程的目标或基调，不能是装饰性反转
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 3A 线性动作剧本写作守则（电影化演出）
- 剧本须含镜头意识：标注景别/运镜/光影/音效提示，让文字即可读出电影感
- 重表演潜台词：关键情感多用动作、停顿、环境反应承载，少用直白告白
- 动作场面文学化：把战斗写成"角色情绪的爆发与释放"，而非招式清单
- 关键场景须留"无台词高光时刻"（一个眼神/一次伸手/一段沉默）传递核心情感
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式对白（"按住格挡"），UI/操作提示与叙事台词须彻底分离
- 情感表达优先视听语言：能用画面说的，不写成解释性台词
- 角色弧光的阶段须反映在台词基调上（封闭期惜字如金，转变后渐次敞开）
- 高潮决战须由情感清算驱动，动作奇观服务于情绪释放而非反之
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："冷硬父亲 / 3A 线性 / 救赎与父子"
- 母题：以暴制暴的父亲，护送之旅中学会"放下武器才是力量"
- set-piece 范例：雪山追逐(动作奇观) 同时揭示父亲隐瞒的旧罪(叙事职能)
- 中点转折：孩子得知父亲的真实身份，信任崩塌，目标从"护送"变为"赎罪"
- 无台词高光：结局父亲将武器沉入湖中，背向镜头伸手牵起孩子
`.trim();

export const ACT_LINEAR_SKILL: NarrativeSkill = {
  genreCode: "act-linear",
  tier: "tier1",
  matchKeywords: ["3a", "线性动作", "战神", "最后生还者", "鬼泣", "God of War", "The Last of Us", "DMC", "电影化叙事", "set-piece"],
  // 线性裁剪版（去 item_database 与任务并行，保留电影化场景演出链）
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "story_framework",
    "outline_batch",
    "detailed_outline",
    "plot_generation",
    "script_generation",
    "scene_plan",
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
        style_guide: "3A 线性角色塑造：主角是被镜头凝视的绝对核心，全程一条清晰弧光；配角皆为弧光催化剂，反派是主题的一体两面。",
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

registerSkill(ACT_LINEAR_SKILL);
