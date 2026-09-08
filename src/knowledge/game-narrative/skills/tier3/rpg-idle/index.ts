/**
 * rpg-idle — 品类叙事包（放置/挂机 RPG）
 *
 * 放置/挂机 RPG = 运营叙事型。角色与世界观为长期资产，剧情按版本/章节轻量产出。
 * 玩家"离线挂机"获取收益，剧情是回归时的"奖励性阅读"，须短小、明亮、可碎片化吞咽。
 *
 * 采用运营叙事链（精简）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 故事框架 → 任务]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 放置 RPG 世界观原型（"可被英雄填满的明亮大陆"）
- 轻奇幻世界基调：阳光、童话感、低压迫——挂机回归时不该带来沉重情绪
- 世界由"可解锁区域"拼成：每个新地图 = 一个新版本的叙事舞台与新英雄来源
- 英雄即长期资产：世界观须为"源源不断引入新角色"留出口（异界召唤/觉醒/转生）
- 阵营/种族体系清晰可分类：光暗、自然、亡灵等，方便后续版本按阵营做主题更新
- 大反派可被"分章节蚕食"：终极威胁存在，但允许被无限期延后，服务长线运营
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明快、轻松、英雄主义；避免大段沉郁，保持"打开就能读完一段"的轻盈
- 世界观以"地图册"方式呈现：一个区域一段风物 + 一个钩子，便于版本逐块开放
- 为"召唤/集结英雄"提供世界观合理性（一个能跨界召集英雄的核心装置/契约）
- 留白优先：世界设定不必一次讲完，给未来版本留下可填充的空白地带
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁一次性写死终局：终极威胁须可被无限延后，为长线运营保留空间
- 每个区域须自带"可独立成章"的叙事钩子，不依赖前置剧情即可让新玩家进入
- 世界观须能容纳"持续涌入的新英雄"，禁止封闭式固定角色表
- 文案体量克制：单段世界观描述以"挂机回归后 30 秒可读完"为度量
`.trim();

const CHARACTER_ARCHETYPE = `
# 放置 RPG 角色原型（可收集的英雄图鉴）
- 英雄是核心收集物：每个英雄 = 一张"立绘 + 阵营 + 一句话定位 + 一段轻背景"
- 背景故事短小独立：每名英雄一段可单独阅读的小传，不强制串联主线
- 阵营归属明确：便于按阵营做羁绊、活动与版本主题
- 人设鲜明易记：用一个标志性性格/口头禅/外观符号让英雄被快速记住
- 预留"觉醒/进阶"叙事位：高养成阶段解锁角色的隐藏过去，延长情感投入
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每名英雄须能脱离主线被单独理解（碎片化阅读友好）
- 角色背景须留"进阶解锁"钩子，避免一次把人物挖空
- 严禁角色定位重复：同阵营英雄须在性格/职能上有清晰区分度
- 文案短小：单个英雄基础小传控制在百字级，深度交由觉醒剧情释出
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 放置 RPG 故事框架（轻量章节 + 版本主线）
- 主线以"章节地图推进"承载：每章对应一张地图，章节即一段可独立阅读的小冒险
- 版本剧情框架：每个版本围绕一个新区域/新阵营展开短篇主线 + 配套英雄登场
- 章节文案轻量化：进入战斗前的过场对话 1-3 句，胜利后一句结语收束
- 长线悬念分摊：把"终极威胁"拆成跨多版本的悬念碎片，逐版本释出一点
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- 每章须能独立成段，新玩家从任意章节接入都不至于完全迷失
- 版本主线须自带"本版本英雄登场理由"，叙事与商业化节奏对齐
- 禁止把单章文案写成长篇：以"挂机回归→快速读完→继续推图"为节奏标尺
- 终极威胁的揭露须可延后，杜绝过早写死结局而堵死后续版本
`.trim();

const QUEST_GENERATION_STYLE = `
# 放置 RPG 任务设计（日常 / 活动 / 版本任务）
- 日常任务：以"挂机收益领取 / 推图 / 上阵英雄"为骨架，文案轻提示即可
- 推图章节任务：每张地图一条主线任务串，引导玩家逐章解锁与阅读小剧情
- 限时活动任务：围绕版本主题（节日/新阵营）做短篇剧情活动，配套专属奖励英雄
- 版本任务：新版本上线时的"开荒任务链"，把新区域剧情与新英雄获取绑定
- 任务奖励须强挂养成资源，让"读剧情"与"变强"形成正反馈
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 日常任务文案须极简，禁止冗长说明打断挂机-领奖的爽快循环
- 活动任务须限时且主题鲜明，剧情服务于新英雄/新内容的曝光
- 版本任务须把"新区域叙事"与"新英雄获取路径"显式绑定
- 严禁任务剧情与主线设定冲突，长期资产（角色/世界观）须前后一致
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："剑与远征式放置 RPG / 光暗阵营 / 长线英雄收集"
- 世界观：明亮的"亚瑟兰大陆"，靠"英雄纪念碑"跨界召集历代英雄
- 新版本：开放"亡灵荒野"区域，登场亡灵阵营新英雄"挽歌咏者"
- 章节文案：进图一句"荒野的风里有未散的怨念"，胜利一句"安息吧，此地已无战火"
- 活动任务：限时"亡灵祭"活动，通关短篇剧情可领取限定英雄碎片
`.trim();

export const RPG_IDLE_SKILL: NarrativeSkill = {
  genreCode: "rpg-idle",
  tier: "tier3",
  matchKeywords: ["放置rpg", "挂机rpg", "剑与远征", "放置", "挂机", "AFK", "idle rpg"],
  // 运营叙事链（精简）：世界观 → 角色 → 故事框架 → 任务
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
        style_guide: "放置 RPG 角色塑造：英雄是可收集的长期资产，背景短小独立、阵营鲜明、可碎片化阅读，并预留觉醒/进阶解锁的深度叙事位。",
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

registerSkill(RPG_IDLE_SKILL);
