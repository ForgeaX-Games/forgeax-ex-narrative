/**
 * misc-survivor — 品类叙事包（吸血鬼幸存者-like / 弹幕幸存）
 *
 * 吸血鬼幸存者-like = 运营叙事型（最简叙事 + 解锁式角色背景）。以"吸血鬼幸存者 / 弹壳特攻队"为代表：
 * 玩法是割草式弹幕生存，叙事极度轻量——世界观是一层薄薄的氛围皮，角色背景以
 * "解锁式只言片语"释出。角色/关卡为长期资产，按版本追加新角色、新地图与新解锁文本。
 *
 * 采用运营叙事链（最简）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 故事框架(轻量) → 任务(解锁/版本)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 幸存者-like 世界观原型（"一层够用就好的氛围皮")
- 极简前提：一句话讲清"为何要在怪潮中存活"(被诅咒之夜/虫群爆发/魔物围城)即可
- 关卡即舞台：每张地图是一个有主题氛围的战场(古堡/森林/地牢)，无需复杂地理叙事
- 怪潮设定：成群涌来的敌人只需一个粗线条的来源解释，服务"割草"爽感
- 世界观是皮不是骨：氛围、风格、调性优先，避免喧宾夺主的厚重设定
- 为版本扩充留口：新地图/新怪潮主题可作为新关卡轻量接入
`.trim();

const WORLDVIEW_STYLE = `
- 语调：轻快、风格化、略带戏谑或暗黑趣味；氛围到位即可，不求深度
- 世界观用极少笔墨交代"在哪、打什么、为何打"，把舞台让给玩法爽感
- 每张地图给一个鲜明的主题氛围标签，便于辨识与版本扩充
- 一切设定服务于"上手即玩"，禁止冗长前置叙事拖慢进入战斗
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观须极简，一两句交代清楚即可，严禁堆砌复杂设定喧宾夺主
- 怪潮来源给粗线条解释即可，服务割草爽感而非严密考据
- 每张地图须有可辨识的主题氛围，但不承担线性剧情
- 须为新地图/新主题的版本扩充留口，保持轻量可拼接
`.trim();

const CHARACTER_ARCHETYPE = `
# 幸存者-like 角色原型（可解锁的角色卡）
- 角色是核心可收集资产：每个角色 = 鲜明造型 + 标志性武器/技能 + 一句话身份
- 背景极简：每名角色一两句话身份设定，不展开复杂前史
- 解锁式释出：角色的过往/动机通过"解锁条件达成时的一小段文本"逐步给出
- 个性靠符号传达：外观、初始武器、一句口头禅就足以让角色被记住
- 角色间可有轻量关联(同阵营/旧识)，但点到为止，不构建复杂关系网
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色背景须极简，禁止长篇前史拖累轻量基调
- 解锁文本须短小有味，一两句即勾勒人物，杜绝信息倾倒
- 角色须靠造型/武器/标签高辨识度区隔，禁止雷同
- 角色关联保持轻量，不强行编织复杂关系网
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 幸存者-like 故事框架（轻量解锁线索）
- 不设线性主线：以"解锁线索拼图"取代章节式剧情
- 关卡氛围即叙事：每张地图通过场景、敌人主题、BGM 风格传达一段轻氛围
- 解锁式碎片：达成成就/解锁角色时给一小段文本，慢慢拼出世界的轮廓
- 终极悬念可有可无：留一个粗线条的"大威胁"作为收集动力，不必深挖
- 版本新篇即新地图/新角色：每个版本追加内容，无需复杂剧情承接
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 严禁强加线性长主线，叙事须以碎片化解锁为主
- 解锁文本须短小且可独立消费，不依赖前置剧情
- 关卡氛围须风格鲜明但不承担复杂叙事负担
- 版本新内容须可轻量拼接，与既有角色/世界皮不冲突
`.trim();

const QUEST_GENERATION_STYLE = `
# 幸存者-like 任务设计（成就解锁 / 日常 / 版本任务）
- 解锁成就：以"通关地图/累计击杀/特定build"为条件解锁新角色、武器与文本碎片
- 日常任务：轻量的每日挑战(限定角色/限定地图生存 X 分钟)，奖励养成资源
- 收集驱动：把"解锁全角色/全武器/全图鉴"做成长期收集目标，提供持续动力
- 限时活动：节日/联动主题的限时地图与挑战，配套限定角色或皮肤
- 版本任务：新版本上线时围绕新地图/新角色的解锁挑战链，文案轻量
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 任务文案须极简直给，禁止冗长叙述打断"开局即割草"的爽快节奏
- 解锁条件须清晰可达成，奖励强挂角色/武器/碎片等长期收集物
- 限时活动须主题鲜明且轻量，服务新角色/新地图的曝光
- 版本任务须与既有角色/世界皮一致，长期资产保持连续
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："吸血鬼幸存者式弹幕生存 / 暗黑趣味 / 解锁式角色"
- 世界观：被诅咒的午夜古堡，亡灵成潮涌出，活到天明就算赢——一句话够用
- 角色卡：'银弹神父'，初始武器圣水弹幕，身份一句"带着十字架和坏脾气的猎魔人"
- 解锁文本：达成'独自存活30分钟'解锁一行"他不记得自己杀过多少，只记得没人替他祈祷"
- 版本任务：新增'血色地窖'地图，通关解锁吸血鬼少女角色与专属武器'血蔷薇'
`.trim();

export const MISC_SURVIVOR_SKILL: NarrativeSkill = {
  genreCode: "misc-survivor",
  tier: "tier3",
  matchKeywords: ["幸存者", "弹壳特攻队", "vampire survivors", "吸血鬼幸存者", "弹幕生存", "割草", "roguelite生存"],
  // 运营叙事链（最简）：世界观 → 角色 → 故事框架(轻量) → 任务(解锁/版本)
  narrativeSteps: ["worldview", "character_enrichment", "story_framework", "quest_generation"],
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
        style_guide: "幸存者-like 角色塑造：角色是可解锁的收集资产，背景极简、靠造型/武器/标签高辨识，过往通过解锁式只言片语逐步释出，关联保持轻量。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    story_framework: {
      slots: {
        style_guide: STORY_FRAMEWORK_STYLE,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
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

registerSkill(MISC_SURVIVOR_SKILL);
