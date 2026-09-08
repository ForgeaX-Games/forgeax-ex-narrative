/**
 * rpg-crpg — 品类叙事包（WRPG/CRPG · 西式角色扮演）
 *
 * CRPG = 史诗叙事型。区别于 JRPG 的"线性英雄之旅"，CRPG 的核心是
 * 「反应性叙事」(reactivity) 与 「选择—后果」(C&C, Choice & Consequence)：
 *   世界因玩家的角色扮演而改变，而非玩家追随一条既定命运。
 *
 * 采用 RPG 七单品链：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# CRPG 世界观原型（"可被介入的活体世界"）
- 世界先于主角存在：派系、宗教、政体、历史恩怨都自带运转逻辑，玩家是闯入者而非救世主
- 道德灰度光谱：没有纯善纯恶阵营，每个势力都有可被理解的诉求与不可告人的代价
- 规则即叙事：律法、契约、神祇禁忌、阶级制度是可被玩家利用或违背的"系统性入口"
- 信息分层：同一事件由不同派系给出互相矛盾的叙述，真相需玩家拼接（不可靠叙述者）
- 世界状态可变量：战争、瘟疫、王位更迭等"全局开关"会因玩家干预而翻转区域面貌
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻、克制、政治化；用"立场"而非"善恶"描述势力
- 每个区域至少绑定一个"道德困境装置"（救谁/牺牲谁/向谁妥协）
- 世界观要为"角色扮演自由"留白：同一据点对盗贼/法师/外交官应呈现不同入口
- 历史以"未结清的旧账"形式呈现，让玩家选择延续或终结某段恩怨
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁设置"唯一正确解"的派系；任何阵营选择都必须附带可感知的失去
- 每条主要矛盾必须提供至少 2 条非战斗解法入口（说服/欺骗/收买/潜入）
- 世界状态变量必须显式声明触发条件与可见后果，供下游 C&C 节点引用
- 不写"等待被拯救的世界"；世界即使没有主角也会自行恶化或演进
`.trim();

const CHARACTER_ARCHETYPE = `
# CRPG 角色原型（同伴 = 立场与价值观的化身）
- 主角是"空壳载体"：性格由玩家选择填充，设定只提供出身/背景标签(origin)而非既定人格
- 同伴各自携带独立的世界观与道德底线，会因玩家选择而赞同、不满乃至离队/反目
- 关键 NPC 拥有"记忆"：会记住玩家此前的言行并在重逢时反映出来
- 反派往往是"另一种合理"：其方法论是玩家若坚持某立场也会抵达的终点
- 派系代表人物需可被招募、可被背叛、可被处决，且每条路径都有专属后续内容
`.trim();

const CHARACTER_CONSTRAINTS = `
- 同伴的好感/忠诚必须由价值观契合度驱动，而非送礼数值堆砌
- 每个核心同伴需声明至少 1 条"会与玩家冲突的红线"（触碰即触发对峙）
- 严禁让同伴沦为功能性挂件；每人须有可独立成立的个人议程与离队条件
- 对话设计须支持"角色扮演口吻"分支（强硬/圆滑/欺诈/天真），而非仅信息选项
`.trim();

const STORY_FRAMEWORK_STYLE = `
# CRPG 故事框架（网状反应叙事，而非三幕直线）
- L0 以"中心冲突 + 多派系立场矩阵"组织，而非单一主线节拍
- 主线节点设为"可多路径通达"的枢纽，每个枢纽记录玩家此前的全局变量
- 显式设计"分水岭抉择"(point of no return)：跨过后封锁部分阵营、解锁另一批内容
- 结局由"声望 + 关键抉择 + 同伴存亡"的组合状态结算，而非单一好坏轴
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 每个主线枢纽必须标注它读取了哪些前置变量、又写入了哪些后续变量（C&C 账本）
- 至少存在 3 个互斥的主线路径，且彼此能复用部分场景但导向不同结算
- 任何"全屠/全和平"极端打法都必须有被预先设计的、自洽的叙事回应
- 不允许"选择只换台词不换后果"的伪分支
`.trim();

const SCRIPT_GENERATION_STYLE = `
# CRPG 剧本写作守则（对话树即玩法）
- 对话以"分支树"为单位书写：每个节点标注语气标签、技能检定入口(说服/威吓/洞察)、后果指针
- 善用属性/背景门控(check-gated)台词：高智力/特定 origin 解锁专属对白与捷径
- NPC 回应须引用玩家档案(声望/此前抉择/同伴在场)，制造"世界记得你"的实感
- 文本风格服务于扮演：同一信息可由冷酷/戏谑/悲悯三种基调表达，供玩家自选投射
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 每个关键对话节点必须给出"成功/失败/中立"三态后果，禁止只写成功分支
- 技能检定失败不能是死胡同，须导向另一条有代价的路径
- 严禁打破角色扮演沉浸（不得替玩家预设情绪反应，如"你愤怒地说"）
- 后果须可被后续场景读取并兑现，不能写完即弃
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："王位继承危机 / CRPG / 多派系博弈"
- 三派立场：摄政王(秩序但暴政) / 流亡公主(正统但孱弱) / 商会(中立但唯利)
- 分水岭抉择：是否在加冕夜揭穿伪造遗诏——揭穿则内战，隐瞒则共谋
- 检定门控：高洞察可识破伪诏，高威吓可逼摄政王退位，高交涉可促成联合摄政
- 同伴红线：理想主义骑士同伴若见你扶持暴政将拔剑相向
`.trim();

export const CRPG_SKILL: NarrativeSkill = {
  genreCode: "rpg-crpg",
  tier: "tier1",
  matchKeywords: ["crpg", "wrpg", "西式rpg", "博德之门", "神界原罪", "辐射", "Baldurs Gate", "Divinity", "Fallout", "选择与后果", "反应性叙事"],
  // RPG 七单品链 ②-⑦（通用前驱之后）
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
        style_guide: "CRPG 角色塑造：主角是玩家投射的空壳，同伴是会反对你的独立人格；好感由价值观驱动，而非数值堆砌。",
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

registerSkill(CRPG_SKILL);
