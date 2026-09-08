/**
 * sim-dating — 品类叙事包（恋爱模拟 / Dating Sim）
 *
 * 恋爱模拟 = 分支叙事型（养成节奏驱动）。核心是"日常养成的时间管理 +
 * 好感培育 + 告白节点"，玩家在有限周期内安排行动、提升属性、攻略心仪对象
 *（心动回忆 / 未定事件簿的养成切面）。
 *
 * 分支家族链（通用前驱 偏好→初步方案 之后）：
 *   世界观 → 角色 → 大纲（养成路由+告白节点） → 情节（约会台词）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 恋爱模拟世界观原型（"有节律的日常生活圈"）
- 世界是一个"可经营的生活圈"：校园、社区、职场，提供日常行动的场所与节奏
- 时间是核心资源：以日/周/学期为单位的周期循环，行动安排即玩法
- 设"日常场所网络"：教室、咖啡馆、健身房等，分别对应属性养成与邂逅机会
- 可攻略对象嵌入日常：在特定场所/时段出现，让"偶遇"由玩家规划促成
- 氛围温暖治愈、生活感十足：恋爱长在柴米油盐般的日常细节里
`.trim();

const WORLDVIEW_STYLE = `
- 语调：温暖、生活化、带轻松的烟火气与青春/成人日常质感
- 世界须明确"时间周期单位"与"日常场所网络"，让养成节奏有舞台
- 每个场所须绑定"可养成属性 + 可邂逅对象"，让玩家行动选择有意义
- 恋爱须自然生长于日常积累，而非脱离生活的悬浮浪漫
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 必须显式定义时间周期与可安排行动的节律，养成是本品类的骨架
- 每个日常场所须有明确的养成/邂逅职能，杜绝无用的纯装饰地点
- 恋爱发展须与日常养成耦合，杜绝与玩法割裂的纯过场恋爱
- 世界须支持"重复日常中的细微变化"，让长线养成不显枯燥
`.trim();

const CHARACTER_ARCHETYPE = `
# 恋爱模拟角色原型（陪你度过日常的人）
- 主角：玩家化身，有可成长的属性维度（魅力、学识、体魄、艺术等）
- 可攻略对象 3-6 名：各自有"出没规律 + 偏好属性 + 心结/成长课题"
- 每名对象的好感培育须对应可执行的日常互动（一起学习、约会、送礼）
- 配角承担日常调味与信息源：朋友、家人、对手，丰富生活圈的真实感
- 关键在"陪伴感"：对象不是被攻略的目标，而是与你共同成长的同行者
`.trim();

const CHARACTER_STYLE = `
恋爱模拟角色塑造：每名可攻略对象有独特出没规律与偏好属性，让养成路线差异化；
对象须有成长课题，恋爱即两人在日常里彼此成就的过程。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每名可攻略对象须有差异化的偏好属性与出没规律，杜绝路线同质
- 对象须有自身成长课题，杜绝沦为只等被攻略的静态奖励
- 好感培育须对应可执行的具体日常互动，杜绝抽象的数值堆砌
- 配角须服务于生活圈真实感与信息流通，杜绝无作用的背景人偶
`.trim();

const BRANCH_TREE_STYLE = `
# 恋爱模拟分支树设计守则（养成路由 + 告白节点）
- 主结构是"周期行动安排 → 属性/好感累积 → 阶段事件触发 → 告白节点 → 结局"
- 分支由"日常行动选择 + 属性阈值 + 好感阈值"共同路由，须显式声明判定
- 设"阶段约会事件"作为里程碑：达到条件解锁专属剧情，推进关系
- 告白节点是关键命运分流：成功条件、时机、对象偏好须明确设计
- 须规划多结局（与不同对象 HE / 单身成长 / 错过遗憾），覆盖不同养成路线
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 时间/行动资源须稀缺到"无法面面俱到"，逼出有意义的养成取舍
- 好感与属性阈值须显式可校验，告白成败判定须公平透明
- 阶段事件触发条件须可达，杜绝因资源错配导致的死线无解
- 多结局须覆盖主要养成路线，杜绝只有单一对象有完整结局
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 恋爱模拟对白脚本风格（日常絮语 + 心动节点）
- 日常对话占大头：轻松、生活化、有来有回，积累陪伴的真实质感
- 随好感阶段递进，对象的语气/称呼/分享内容逐步亲密化，体现关系变化
- 告白与里程碑场景须给"情绪高光台词"，与平日的日常絮语形成张力对比
- 礼物/约会互动须有针对对象偏好的差异化反馈，让用心被看见
- 留白与日常感并重：恋爱的甜来自细水长流的细节，而非密集的告白轰炸
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 对象台词须随好感阶段一致演进，杜绝亲密度与口吻脱节
- 严禁机制裸露（"好感+15"），须转译为对象态度与互动细节的变化
- 告白台词须建立在日常铺垫之上，杜绝无积累的突兀表白
- 日常对话须避免空洞重复，长线互动须有信息或情感增量
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："大学校园 / 恋爱模拟 / 一学期的养成与告白"
- 时间周期：以一学期 16 周为循环，每周分配学习/社团/打工/约会行动点
- 场所网络：图书馆(学识)、健身房(体魄)、画室(艺术)，各绑定一名出没对象
- 阶段事件：校园文化祭作为里程碑，达成好感阈值解锁与对象的专属夜话
- 告白节点：学期末的烟火大会，依对象偏好属性与好感等级判定 HE / 遗憾错过
`.trim();

export const SIM_DATING_SKILL: NarrativeSkill = {
  genreCode: "sim-dating",
  tier: "tier1",
  matchKeywords: ["恋爱模拟", "约会", "约会模拟", "dating sim", "养成恋爱", "未定事件簿", "心动回忆", "恋爱养成"],
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

registerSkill(SIM_DATING_SKILL);
