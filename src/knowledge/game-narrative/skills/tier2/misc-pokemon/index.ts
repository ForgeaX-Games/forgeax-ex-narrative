/**
 * misc-pokemon — 品类叙事包（宝可梦-like / 怪物收集）
 *
 * 宝可梦-like = 运营叙事型（叙事较丰富的怪物收集 RPG）。以"宝可梦 / 幻兽帕鲁"为代表：
 * 核心是"图鉴收集 + 旅途成长 + 伙伴羁绊"。物种图鉴(Lore)、世界观与伙伴为长期资产，
 * 主线以"道馆/章节式旅途"承载，可按版本扩充新地区、新物种与新篇章。
 *
 * 采用运营叙事链（含图鉴）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 图鉴/物种 → 故事框架 → 任务]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 宝可梦-like 世界观原型（"人与奇异生物共生的旅途大地"）
- 共生世界：人类与奇异生物(精灵/幻兽)共同生活，捕捉、培育、对战是社会日常
- 多地区结构：世界由风物各异的地区拼成，每个地区 = 一段旅途 + 一套本地物种生态
- 旅途文化：以"训练家踏上旅程、挑战道馆/试炼、成为冠军"为社会化的成长仪式
- 生态分布即叙事：不同栖息地(森林/火山/海洋/古迹)决定物种分布与发现的惊喜
- 守护神话/传说物种：每个地区有其神话级物种与古老传说，承载世界观的神圣层
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明亮、治愈、充满探索惊奇感；旅途的孤独被伙伴的陪伴温柔化解
- 世界观以"地区图鉴册"方式呈现：一个地区一套生态、文化、道馆与传说
- 强调"发现的快乐"：新栖息地、新物种、新羁绊都是世界观给玩家的礼物
- 为版本扩充留口：新地区/新物种可作为新篇章无缝接入，不破坏既有生态
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界观须坚持"人与生物共生"的温暖基调，禁止滑向纯压迫/虐待生物的黑暗叙事
- 每个地区须自带可独立成章的生态与文化，新玩家从任意地区接入皆可成立
- 物种生态须与栖息地自洽（属性/习性/分布），杜绝随意堆砌
- 须为新地区/新物种的版本扩充留出接口，禁止写死封闭的世界边界
`.trim();

const CHARACTER_ARCHETYPE = `
# 宝可梦-like 角色原型（旅途上的人物群像 + 伙伴生物）
- 主角：踏上旅程的训练家，成长弧是"从新手到独当一面"的旅途成长
- 旅途伙伴/对手：同行的友人、亦敌亦友的劲敌、各具个性的道馆主理人
- 伙伴生物即情感核心：玩家与队伍中生物的羁绊是叙事的灵魂，须可被"养成"出感情
- 反派组织：怀有偏执理念的组织(掠夺/改造/统治生物)，理念可被理解而非纯粹作恶
- 关键 NPC：博士(引路人)、地区冠军(目标象征)、传说守护者，构成旅途的坐标
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角成长须落在"与伙伴共同变强"上，而非孤胆英雄式的个人神话
- 伙伴生物须被赋予可感知的个性与羁绊节点，杜绝沦为纯数值工具
- 劲敌须有独立成长线并与主角形成镜像/激励，避免脸谱化的嘲讽角色
- 反派组织理念须可被理解（哪怕扭曲），禁止无动机的为恶
`.trim();

const ITEM_DATABASE_STYLE = `
# 宝可梦-like 图鉴 / 物种 / 道具数据库
- 物种图鉴(Lore)是核心长期资产：每个物种 = 名称 + 属性 + 栖息地 + 习性 + 图鉴小记
- 图鉴小记要有"博物志"味道：一两句带观察感的描述，让物种"活"起来而非数值表
- 进化链叙事：进化不只是数值跃迁，须赋予形态变化背后的生态/情感逻辑
- 道具体系分层：捕捉道具/培育道具/对战道具/剧情关键道具，各自服务玩法与叙事
- 传说/神话物种单列：以更厚的传说文本承载世界观神圣层，控制稀有度与登场仪式感
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 物种图鉴须与世界观生态自洽（属性-栖息地-习性三者不矛盾）
- 图鉴小记须凝练且富观察感，禁止写成枯燥的数值/技能罗列
- 进化链须有叙事/生态逻辑支撑，杜绝无理由的形态突变
- 传说物种须稀有且仪式感强，禁止泛滥以致削弱其神圣性
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 宝可梦-like 故事框架（道馆/章节式旅途 + 版本新篇）
- 主线以"地区旅途"承载：每个地区 = 一章，章节内以道馆/试炼为节点串联剧情
- 道馆结构：每座道馆 = 主题属性 + 个性馆主 + 一段在地剧情 + 通关后的旅途推进
- 旅途成长曲线：从初心者→收集徽章/试炼→挑战冠军，伙伴羁绊随旅途逐步加深
- 版本新篇框架：每个版本开放新地区/新篇章，引入新物种、新道馆与新对手
- 主线与支线交织：在地小事件(村镇困境/失踪生物)穿插主线，丰富旅途的人情味
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 每个地区章节须能独立成段，保证版本扩充时新篇章可无缝接入
- 道馆/试炼节点须各具主题与个性，杜绝重复套路的流水线关卡
- 旅途成长须体现"人与伙伴共同变强"的情感曲线，而非纯打卡式推图
- 版本新篇须与既有世界观/图鉴自洽，长期资产前后一致不冲突
`.trim();

const QUEST_GENERATION_STYLE = `
# 宝可梦-like 任务设计（旅途主线 / 日常 / 活动 / 版本任务）
- 旅途主线任务：以"前往下一城镇→挑战道馆→揭开在地事件"为骨架推进章节
- 图鉴收集任务：引导玩家在不同栖息地发现、捕捉、登记物种，奖励收集成就感
- 伙伴羁绊任务：围绕特定伙伴生物的培育/羁绊事件，解锁专属小剧情或进化
- 限时活动任务：节日/季节主题活动(如丰收祭、群落大量出现)，配套限定物种登场
- 版本任务：新地区开放时的探索任务链，把新物种获取与新篇章剧情绑定
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 旅途主线任务须保持"探索-挑战-人情"三味，禁止退化为纯战斗清单
- 图鉴/羁绊任务须服务"收集与情感"双核，奖励须强化长期养成动机
- 活动任务须限时且主题鲜明，限定物种登场须保持稀有度与仪式感
- 版本任务须把新物种获取与新篇章叙事显式绑定，且与既有 Lore 自洽
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："宝可梦式怪物收集 / 道馆旅途 / 伙伴羁绊"
- 世界观：人与'灵兽'共生的'霞光地区'，八座主题道馆串起一段成长旅途
- 物种图鉴：'苗火狐'——火属性，栖息于火山温泉带，图鉴记"夜里会用尾火为迷路者引路"
- 道馆结构：初镇'草系道馆'，馆主是温柔的园丁老人，通关剧情教会主角"耐心培育"
- 活动任务：季节限定'萤海祭'，水边大量出现稀有'萤光鳗'，登记图鉴可获纪念道具
`.trim();

export const MISC_POKEMON_SKILL: NarrativeSkill = {
  genreCode: "misc-pokemon",
  tier: "tier2",
  matchKeywords: ["宝可梦", "幻兽帕鲁", "pokemon", "palworld", "怪物收集", "精灵", "宠物对战"],
  // 运营叙事链（含图鉴）：世界观 → 角色 → 图鉴/物种 → 故事框架 → 任务
  narrativeSteps: ["worldview", "character_enrichment", "item_database", "story_framework", "quest_generation"],
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
        style_guide: "宝可梦-like 角色塑造：主角与伙伴生物共同成长是情感核心，劲敌为镜像激励，反派组织理念可被理解，关键 NPC 构成旅途坐标。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
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

registerSkill(MISC_POKEMON_SKILL);
