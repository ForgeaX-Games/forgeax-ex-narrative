/**
 * adv-pointclick — 品类叙事包（点击冒险 / Point-and-Click）
 *
 * 点击冒险 = 分支叙事型（道具谜题驱动）。核心是"场景热点探索 + 道具组合谜题 +
 * 与叙事咬合的解谜"，幽默或诡谲的氛围贯穿始终（猴岛小英雄 / 锈湖系列）。
 *
 * 分支家族链（通用前驱 偏好→初步方案 之后）：
 *   世界观 → 角色 → 大纲（谜题与剧情咬合） → 情节（场景旁白/物件描述）
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本两段专属 step 随 vn-v1 一并搬进
 * `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到吸收后的
 * 通用大纲（outline_batch）/ 情节（plot_generation）席位上。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 点击冒险世界观原型（"可被点开的奇趣世界"）
- 世界由一组"可探索场景"构成，每个场景是一幅藏满热点的画面
- 物件即叙事单元：每件可拾取/可交互的道具都承载信息或谜题钩子
- 风格谱系两极：诙谐荒诞（猴岛式海盗喜剧）↔ 阴郁诡谲（锈湖式超现实）
- 世界逻辑允许"奇趣因果"：荒诞的道具组合能解开看似不相干的谜题
- 场景间以"可往返的地图"连接，鼓励反复探索与跨场景道具运用
`.trim();

const WORLDVIEW_STYLE = `
- 语调：依品类两极择一并贯穿——要么机智幽默，要么压抑诡异
- 每个场景须设计为"信息密度高的画面"：哪里有热点、哪件物可拿、哪处藏谜
- 世界须支持跨场景谜题：A 场景拿到的道具在 B 场景才派上用场
- 奇趣因果须自洽：荒诞但有内在逻辑，让玩家"恍然大悟"而非"莫名其妙"
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁纯背景板场景；每个场景须至少承载 1 个热点交互或谜题线索
- 道具须与叙事咬合，杜绝"为谜题而谜题"的纯数字密码堆砌
- 跨场景谜题的前置线索须可被玩家在探索中合理获取，杜绝无解卡关
- 荒诞设定须有内在因果支撑，幽默/诡异基调须全程统一不跳脱
`.trim();

const CHARACTER_ARCHETYPE = `
# 点击冒险角色原型（推动探索的主角与怪诞配角）
- 主角：好奇心旺盛、爱吐槽/爱观察，其"点评物件"的台词是品类趣味核心
- 配角 NPC：性格夸张、各有执念，常以"给谜题/给道具/设障碍"推动流程
- 世界中常有"古怪掌控者"（看不见的设计者/幕后者），尤见于诡谲系
- 角色与场景深度绑定：某 NPC 只在特定场景出现，承担该场景的叙事职能
- 主角对道具的"使用尝试反应"是塑造性格与制造笑点/惊悚的关键
`.trim();

const CHARACTER_STYLE = `
点击冒险角色塑造：主角靠"观察+吐槽"的物件点评立住性格；配角夸张鲜明、
各司谜题职能；诡谲系可设隐形的幕后掌控者，让世界透出不安。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角的物件点评须既有趣又给线索，杜绝纯废话或纯功能提示
- 每个配角须绑定明确的谜题/叙事职能，不做无作用的过场布景
- 角色反应须随基调统一（喜剧系俏皮、诡谲系冷峻），杜绝调性割裂
- NPC 设置的障碍须可通过道具/对话合理破解，杜绝玄学卡死
`.trim();

const BRANCH_TREE_STYLE = `
# 点击冒险分支树设计守则（谜题与叙事咬合）
- 主结构是"谜题门控的线性推进"：解开谜题才解锁下一段叙事/场景
- 每个谜题须与剧情动机咬合：解谜的目的服务于角色目标，而非孤立小游戏
- 设计"道具依赖图"：标注哪件道具在何处获取、用于解开哪个谜题
- 可设少量分支（多解谜法/可选支线物件），但主线收敛，避免叙事发散
- 谜题难度阶梯递进，并埋"环境暗示"作为隐性提示，降低恶性卡关
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 每个谜题须有清晰的"叙事理由"，杜绝与剧情脱节的填字/密码堆砌
- 道具依赖图须无死锁：任何必要道具在其使用点之前必可获取
- 必须为关键谜题设计渐进式环境暗示，杜绝"像素搜寻"式折磨
- 分支与多解法须收敛回主线，杜绝因可选解法导致状态不一致
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 点击冒险脚本风格（场景旁白 + 物件描述 + 主角吐槽）
- 三大文本支柱：场景旁白（环境氛围）、物件检视描述（线索+趣味）、交互反馈台词
- "检视/使用/组合"道具时的台词须独立设计，是品类标志性的趣味来源
- 失败/无效操作也要给有趣反馈（"这俩东西凑一起毫无道理。"），而非冷冰冰报错
- 旁白与主角内心吐槽交织，让探索过程本身充满人格与节奏
- 关键解谜时刻给"灵光一现"的台词，强化解开谜题的成就快感
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 物件描述须兼顾"线索功能"与"风味趣味"，杜绝纯功能性的干瘪标签
- 无效操作反馈须保持基调（幽默或诡异），不得是机械的"无法使用"
- 严禁机制裸露提示（"未达成解谜条件"），须转译为情境化的角色反应
- 关键线索台词须埋得恰到好处：给方向但不直接报答案，保留解谜乐趣
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："诡异旅馆 / 点击冒险 / 锈湖式超现实解谜"
- 场景链：阴郁旅馆大堂 → 上锁的客房 → 镜中颠倒的密室
- 道具咬合：大堂壁炉里取出的烧焦钥匙，对应客房抽屉里的颠倒数字谜
- 主角吐槽：检视镜子时——"我的倒影……比我先动了一步。"（诡异基调）
- 跨场景谜题：客房日记记下的怪诞口诀，是镜中密室开门的真正暗号
`.trim();

export const ADV_POINTCLICK_SKILL: NarrativeSkill = {
  genreCode: "adv-pointclick",
  tier: "tier1",
  matchKeywords: ["点击冒险", "point and click", "point-and-click", "猴岛", "猴岛小英雄", "锈湖", "Rusty Lake", "Monkey Island", "解谜冒险"],
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

registerSkill(ADV_POINTCLICK_SKILL);
