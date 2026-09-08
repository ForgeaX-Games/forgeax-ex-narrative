/**
 * adv-text — 品类叙事包（文字冒险 / Text Adventure）
 *
 * 文字冒险 = 分支叙事型（纯文字想象力）。叙事完全依靠文字唤起的画面，
 * 玩家以"你"为视角做出选择，选择即命运（生命线 / 80 天环游地球）。
 *
 * 分支家族链（通用前驱 偏好→初步方案 之后）：
 *   世界观 → 角色 → 大纲 → 情节（对白/旁白脚本）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 文字冒险世界观原型（"用文字搭建的想象舞台"）
- 无视觉资产负担：世界规模可大可小，只要文字能写清楚就能呈现
- 强调"信息差舞台"：玩家只能知道叙述者愿意透露的，世界因未知而紧张
- 时间/资源可成为世界规则（80 天倒计时、生命线的实时等待、补给消耗）
- 地点以"可探索的名词清单"呈现（房间、方向、物件），为后续指令/选项铺路
- 世界的氛围由感官词构筑：气味、声响、温度，替代画面填补玩家脑海
`.trim();

const WORLDVIEW_STYLE = `
- 语调：克制而富画面感，用最精炼的文字唤起最大想象
- 二人称"你"主导，让玩家即刻"在场"，世界围绕"你的位置"展开
- 每处地点须给"可感知锚点 + 可交互入口"（看得见什么、能做什么）
- 若设倒计时/资源约束，须在世界观层就明示规则，让选择有重量
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁大段背景设定灌输；世界须通过"你所见所触"逐步揭开
- 每个关键地点须预留至少 1 个可触发分支的交互点
- 信息差是核心资产：明确哪些信息对玩家隐藏，何时揭露
- 感官描写须服务于氛围与选择，杜绝华丽却无用的辞藻堆砌
`.trim();

const CHARACTER_ARCHETYPE = `
# 文字冒险角色原型（藏在文字背后的人）
- 主角即"你"：身份可留白，由玩家选择填充，但须有明确处境与目标
- 关键 NPC 通过"言语 + 行为 + 你的揣测"塑造，无立绘故全靠文字立体化
- 至少 1 名"声音陪伴者"（生命线式的远程对话者），承担情感联结与信息源
- 反角/威胁常隐于未知中：玩家未必见其全貌，恐惧/悬念来自想象
- 每个 NPC 须有"对你态度会随选择改变"的可变关系值
`.trim();

const CHARACTER_STYLE = `
文字冒险角色塑造：无画面，故每个角色靠"独特语癖 + 关键行为 + 你的主观感受"立起来；
远程对话者要像真人一样有延迟、有情绪、有未尽之言。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角"你"须保留代入空间，避免替玩家做过多既定性格设定
- 每个 NPC 须有可被玩家选择改变的态度/信任轴，不做静态布景
- 远程对话者的回应须带"不完全可知"的真实感（信息有限、可能误导）
- 杜绝用外貌描写偷懒；角色性格须由言行而非长相承载
`.trim();

const BRANCH_TREE_STYLE = `
# 文字冒险分支树设计守则（选择即命运）
- 每个关键节点提供 2-4 个语气与后果各异的选项，措辞本身即角色扮演
- 区分"叙事分支"（改变剧情走向）与"风味选择"（仅改变台词不改主线）
- 善用"延迟后果"：某个早期选择在数章后才显现影响，强化命运感
- 设计可感知的状态变量（信任、物资、时间、线索），由选择累积驱动结局
- 至少规划 3 种结局走向，且每种都能从玩家的选择链上回溯出因果
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 严禁"假选择"（不同选项导向完全相同的下一句）泛滥，至少保证语气差异
- 每条分支须可达且有意义，杜绝写而不通的死枝
- 状态变量须显式声明判定阈值与对应结局，便于后续脚本校验
- 倒计时/资源类机制须与分支耦合，让"省时/耗时"成为真实抉择
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 文字冒险旁白与对白风格（文字即一切）
- 二人称旁白为主干，叙述"你看到/你听到/你感到"，把玩家钉在现场
- 对白用引号与简短动作标签呈现，节奏明快，避免长篇独白
- 关键时刻用断句、留白、单行成段制造呼吸与悬念
- 选项文本须是"可被朗读的玩家意图"，而非冷冰冰的功能按钮
- 远程对话（生命线式）可加入"对方正在输入/沉默良久"等时间感描写
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 严禁机制裸露式叙述（"你的好感+1"），须转译为情绪与情境描写
- 二人称视角须全程统一，杜绝忽然跳到第三人称上帝视角
- 旁白信息量须与"玩家此刻该知道的"匹配，不剧透未揭露的真相
- 选项措辞须与其后果基调一致，避免误导玩家对后果的预期
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："手机求生 / 文字冒险 / 远程引导陌生人脱险"
- 处境：深夜，你的手机收到一条来自陌生失联者的求救短信
- 信息差：你看不见现场，只能凭对方零碎、可能慌乱失真的描述判断
- 关键分支：催促对方快跑（省时但可能失误）vs 让其冷静观察（耗时但更稳）
- 延迟后果：你早先让对方丢下的背包，在第四章成为生死攸关的物资
`.trim();

export const ADV_TEXT_SKILL: NarrativeSkill = {
  genreCode: "adv-text",
  tier: "tier1",
  matchKeywords: ["文字冒险", "text adventure", "生命线", "80天", "80天环游地球", "交互小说", "interactive fiction", "纯文字游戏"],
  // 分支家族链 ②-③ + 通用大纲/情节
  narrativeSteps: [
    "worldview",            // ②
    "character_enrichment", // ③
    "story_framework",
    "outline_batch",
    "plot_generation",
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
        style_guide: CHARACTER_STYLE,
        constraints: CHARACTER_CONSTRAINTS,
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
  },
};

registerSkill(ADV_TEXT_SKILL);
