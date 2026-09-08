/**
 * fps-story — 品类叙事包（剧情 FPS / 第一人称叙事射击）
 *
 * 剧情 FPS = 史诗叙事型（第一人称沉浸）。其史诗依托"无缝第一人称视角"与
 * 强烈的世界观氛围（半条命 / 生化奇兵 / 光环）：玩家即主角的眼睛，
 * 叙事尽量不打断操作，靠环境、广播、同行 NPC 在行进中讲述。
 *
 * 采用线性裁剪的叙事链（强场景演出，弱任务自由度）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → L0-L4 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 剧情 FPS 世界观原型（"第一人称可信世界"）
- 强氛围、强设定：反乌托邦/科幻/异象世界，世界观本身即最大卖点（如海底都市、外星环带）
- 不间断沉浸：叙事尽量不夺走玩家视角控制，靠环境、电台、对讲、同行者在行进中传达
- 哲学母题：自由意志/极权/人性实验/科技伦理等思辨命题，赋予射击以意义
- 世界设定即玩法解释：异能、武器、敌人都根植于世界观的内在逻辑，不可悬空
- 第一人称的"在场感"：玩家所见即所知，世界须经得起近距离凝视的细节密度
`.trim();

const WORLDVIEW_STYLE = `
- 语调：沉浸、压迫、思辨；用环境的"不对劲"逐步揭示世界的真相
- 每个区域绑定一段"可在行进中接收的叙事"（广播/标语/录音/同行者独白）
- 世界观的揭示遵循"由表象到真相"的层层剥离，呼应思辨母题
- 为强结局反转预留世界观伏笔（玩家以为的前提，最终被颠覆）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁用打断式长过场灌输设定；信息须尽量编织进可继续操作的行进流程
- 世界观的每条核心设定都必须有可被玩家亲眼见证的"现场证据"
- 异能/武器/敌人须能由世界观逻辑自洽推导，杜绝为玩法硬塞的设定
- 思辨母题须落到具体处境，不得停留在抽象口号
`.trim();

const CHARACTER_ARCHETYPE = `
# 剧情 FPS 角色原型（沉默或半沉默的"我"）
- 主角常为沉默/半沉默主角：作为玩家的"代入空壳"，由处境而非台词塑造
- 关键引路人 NPC：在主角耳边/身旁持续说话，是世界观与情感的主要传声筒
- 反派往往是"理念的化身"：以广播、远程喊话、阶段性现身贯穿，制造无处不在的压迫
- 同行者羁绊：少数并肩 NPC 的安危成为玩家情感投入的支点
- 群像通过环境遗留（尸体旁的录音、墙上的留言）补完，无需大量在场角色
`.trim();

const CHARACTER_CONSTRAINTS = `
- 沉默主角的"性格"须完全由处境与他人反应侧写，不得自述内心
- 引路人 NPC 的台词须可在玩家移动/战斗时自然播放，避免强制驻足聆听
- 反派须建立"如影随形"的存在感（贯穿全程的声音/凝视/干预），而非仅结尾登场
- 任何重要角色信息都须有第一人称可亲历的呈现方式
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 剧情 FPS 故事框架（沉浸推进 + 真相剥离）
- L0 以"线性关卡序列"为骨架，每关一个明确目标 + 一层世界真相的揭示
- 节奏交替：战斗高压段 ↔ 探索喘息段 ↔ 演出震撼段，避免持续突突突
- 设计"认知颠覆点"：在中后段揭穿玩家长期默认的某个前提（经典 FPS 叙事手法）
- 结局须兑现思辨母题，给玩家一个关于自由/人性/抉择的余味
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每关的"玩法目标 + 世界真相增量 + 情绪坐标"
- 认知颠覆点须有全程铺设的伏笔支撑，不能是空降反转
- 战斗段落须承担叙事职能（推进/揭示），杜绝纯刷敌人的填充关
- 结局立场须与世界观母题一致，不得为爽感牺牲思辨内核
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 剧情 FPS 剧本写作守则（不打断的叙事）
- 台词设计为"可边走边听"：引路人电台、环境广播、敌方喊话，无需玩家停手
- 环境叙事密集化：录音带、便签、涂鸦、尸体姿态共同织出世界的隐秘历史
- 关键演出克制使用第一人称"夺权"时刻（被擒/异变/真相揭示），用得少而准
- 反派的声音须有辨识度与压迫感，贯穿关卡制造"被注视"的不安
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式旁白（"按 E 拾取"），操作引导与叙事语音须分离
- 重要剧情不得仅靠可跳过的收集品承载，须有行进中必然触达的叙事载体
- 沉默主角不得突然开口大段独白，破坏代入；情绪由他人与环境反射
- 第一人称视角的"夺权"演出须节制，每次都服务于关键叙事节点
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："反乌托邦觉醒 / 剧情 FPS / 自由意志"
- 世界设定：被'安宁体系'药物麻痹的城邦，停药者方能看见墙上真正的标语
- 引路人：耳机里始终引导你的神秘女声，其身份在终局被颠覆
- 认知颠覆点：玩家发现自己一直执行的'解放'指令，正是体系自我更新的程序
- 环境叙事：候诊室长椅下的录音笔，记下上一位'觉醒者'消失前的最后独白
`.trim();

export const FPS_STORY_SKILL: NarrativeSkill = {
  genreCode: "fps-story",
  tier: "tier1",
  matchKeywords: ["剧情fps", "半条命", "生化奇兵", "光环", "Half-Life", "BioShock", "Halo", "第一人称射击", "叙事射击"],
  // 线性裁剪版（强场景演出链，弱任务自由度）
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
        style_guide: "剧情 FPS 角色塑造：沉默主角由处境侧写，引路人 NPC 是传声筒，反派以如影随形的声音制造压迫。",
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

registerSkill(FPS_STORY_SKILL);
