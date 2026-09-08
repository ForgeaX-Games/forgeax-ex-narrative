/**
 * act-adventure — 品类叙事包（动作冒险）
 *
 * 动作冒险 = 史诗叙事型（探险传奇）。其史诗在于"寻宝远征 + 奇观地点 + 主角魅力"：
 *   以一段跨越异域的冒险旅程为骨架，动作、解谜、攀爬与叙事无缝交织
 *   （神秘海域 / 古墓丽影）。强调"印第安纳·琼斯式"的传奇质感。
 *
 * 采用 RPG 七单品链（探险章节承载 L0-L4，任务∥场景表现关卡奇观）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → L0-L4 → (任务∥场景)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 动作冒险世界观原型（"通往传奇的寻宝地图"）
- 寻宝母题：一个失落的文明/宝藏/真相，牵引主角跨越异域奔赴险地
- 奇观地点链：丛林神庙、雪山遗迹、地底古城——每个地点既是动作舞台又是历史谜题
- 历史与传说交织：真实历史的缝隙里藏着可探险的"也许真的存在"的传奇
- 反派竞逐：与主角争夺同一目标的对手（雇佣兵/财阀/教派），制造追逐与对抗
- 探险的代价：宝藏背后常有不该被打扰的真相，呼应"有些东西不该被找到"的母题
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明快、惊险、带探险浪漫；危机四伏却不失幽默与人情
- 每个地点绑定"奇观印象 + 历史谜题 + 动作场景潜能"三位一体
- 寻宝线索须层层递进：一处遗迹的发现导向下一处，形成探险的钩链
- 世界观为"动作—解谜—叙事无缝衔接"留好接口，避免叙事与玩法割裂
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁堆砌设定考据；历史元素须服务于探险悬念与现场奇观
- 每个奇观地点须同时承担"视觉震撼 + 谜题 + 动作"，不做纯过场背景
- 宝藏/真相须有"被找到后的代价或反转"，避免沦为单纯的终点奖励
- 反派的争夺动机须可信，与主角形成镜像对照（同样的渴望，不同的底线）
`.trim();

const CHARACTER_ARCHETYPE = `
# 动作冒险角色原型（有魅力的探险家）
- 主角：身手矫健、机智幽默、有人格魅力的探险家，外表潇洒内藏伤痕或执念
- 搭档/向导：贫嘴的伙伴、博学的学者、亦敌亦友的同行者，承担对话趣味与互补
- 反派：与主角同样渴望宝藏却更冷酷的对手，是"若主角越过底线会成为的样子"
- 情感支点：一段亦庄亦谐的搭档情谊或旧日情愫，为惊险旅程注入温度
- 主角的"凡人感"：会受伤、会害怕、会自嘲，魅力源于真实而非无敌
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角须有"幽默外壳 + 内在伤口"的双层性，避免扁平的无敌英雄
- 搭档须承担信息互补与情绪调味双重职能，不得是纯跟班
- 反派动机须与主角同源对照，其冷酷映照主角守住的底线
- 角色关系须在历险中真实推进（并肩、争执、和解），而非静态背景
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 动作冒险故事框架（寻宝远征三幕）
- L0 以"线索链探险"铺设：发现线索/受命出发 → 异域辗转(地点链 + 反派竞逐 + 搭档羁绊) → 真相揭露与终局抉择
- 节奏以"追逐—探索—解谜—对抗"循环驱动，穿插轻松喘息段调味
- 每个奇观地点须推进一段线索 + 深化一层人物关系
- 终局须给宝藏/真相一个"代价或反转"，让冒险有回味而非单纯凯旋
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须标注每个地点的"线索增量 + 动作奇观 + 关系推进"三职能
- 反派竞逐须贯穿全程并逐级升级，不能仅在结尾出现
- 轻松调味段不得喧宾夺主，须服务于角色关系或悬念铺垫
- 终局反转须有沿途铺设的伏笔支撑，杜绝空降的真相
`.trim();

const SCRIPT_GENERATION_STYLE = `
# 动作冒险剧本写作守则（边动作边对话）
- 善用"行进中对话"：攀爬、追逐、潜行时的搭档拌嘴推进关系且不打断节奏
- 动作场面文学化为"惊险奇观"：坍塌、追车、绝壁，写出肾上腺素与临场感
- 幽默与紧张交替：危机时刻的自嘲台词是本品类的标志性气质
- 关键解谜/发现时刻须给"豁然开朗"的情绪释放与角色反应
`.trim();

const SCRIPT_GENERATION_CONSTRAINTS = `
- 严禁机制裸露式提示（"按住攀爬"），操作引导与角色对话须分离
- 幽默不得消解关键情感时刻；张弛须有节制
- 行进对话须可在动作中自然播放，不强制玩家停手聆听
- 搭档拌嘴须推进关系或埋线索，杜绝无信息的口水话
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："失落黄金城 / 动作冒险 / 搭档与背叛"
- 线索链：殖民时代航海日志 → 雨林祭坛机关 → 地底黄金城入口
- 奇观地点：暴雨中崩塌的吊桥追逐，同时揭示同行学者的隐秘目的
- 反派镜像：昔日探险搭档因一次见死不救而黑化，如今为夺宝不惜灭口
- 终局代价：黄金城真相是一座以活人献祭维系的死城，宝藏不可被带走
`.trim();

export const ACT_ADVENTURE_SKILL: NarrativeSkill = {
  genreCode: "act-adventure",
  tier: "tier2",
  matchKeywords: ["动作冒险", "神秘海域", "古墓丽影", "Uncharted", "Tomb Raider", "寻宝", "探险"],
  // RPG 七单品链 ②-⑦（探险章节承载 L0-L4）
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
        style_guide: "动作冒险角色塑造：主角是幽默外壳+内在伤口的探险家，搭档调味又互补，反派是越过底线的镜像。",
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

registerSkill(ACT_ADVENTURE_SKILL);
