/**
 * fps-looter — 品类叙事包（掠夺射击 / Looter Shooter）
 *
 * 碎片叙事型：没有完整 L0-L5 主线，叙事由"装备词条 Lore + 掉落物背景 +
 * 赛季更迭 + 据点世界状态"承载。玩家在"刷装备—变强—再刷"的循环里，
 * 通过武器铭文、护甲来历逐步拼出世界故事（命运2 / 全境封锁 / 无主之地）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 掠夺射击世界观原型（"持续演进的战利品宇宙"）
- 末世/边疆母题：文明崩塌或星际拓殖后的混乱地带，强者靠装备立足
- "活的世界"结构：世界随赛季推进而演变，旧威胁退场、新阵营登场
- 装备即文明遗产：传奇武器/护甲承载着英雄、阵营、灾变的历史，是可掠夺的 Lore
- 多阵营势力网：玩家阵营 vs 多个敌对势力，每个势力有独特科技与美学标签
- 据点（社交空间）作为世界状态展板：NPC、布告、活动反映当前赛季叙事进程
`.trim();

const WORLDVIEW_STYLE = `
- 语调：硬核、燃、带"军事科幻/末世美学"质感；宏大世界服务于持续可玩
- 世界观以"可演进的阵营冲突 + 装备 Lore 层"铺设，让刷取过程持续渗透故事
- 用赛季框架埋叙事节奏：每个赛季是一个可独立消费的章节，又串入主线大势
- 为长线运营留接口：世界须能容纳新地图、新阵营、新装备而不破坏既有设定
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁把世界写死；须为赛季更迭、阵营兴替、装备扩充预留可演进空间
- 核心叙事须可拆进装备 Lore 与据点世界状态，不依赖单一线性主线
- 阵营须各具鲜明科技与美学标签，杜绝换皮敌人
- 赛季叙事须既能独立成章，又服务于一条可长期延展的世界大势
`.trim();

const CHARACTER_ARCHETYPE = `
# 掠夺射击角色原型（崛起的掠夺者与势力群像）
- 主角：可高度自定义的掠夺者/特工，身份留白以承载玩家投射与 Build 自由
- 据点 NPC 群像：军需官、阵营领袖、任务发布者，是世界状态与赛季叙事的发声口
- 阵营领袖/反派：每个敌对势力有可读的领袖与动机，随赛季登场退场
- 传奇人物的"缺席在场"：许多英雄已逝，其事迹只在装备 Lore 与据点纪念中流传
- 战友/同行玩家定位：世界须为多人协作叙事预留"我们共同书写历史"的空间
`.trim();

const CHARACTER_CONSTRAINTS = `
- 主角身份须留白以支持自定义与 Build 投射，杜绝固定性格压制玩家代入
- 据点 NPC 须随赛季推进有状态/台词演变，避免静态布景人
- 阵营领袖须动机鲜明且可随赛季兴替，杜绝一成不变的常驻反派
- 传奇人物宜以"装备 Lore + 纪念"缺席登场，强化世界的历史厚度
`.trim();

const ITEM_DATABASE_STYLE = `
# 掠夺射击装备 Lore 守则（词条与掉落即故事）
- 每件传奇/异域装备附"风味文本"：一句诗意铭文 + 一段来历，掉落即解锁一块 Lore
- 词条/特效命名须叙事化，呼应武器的历史与原主（"亡者的最后誓言"）
- 套装/系列武器讲一个跨装备的故事，集齐拼出某位英雄或某场战役的全貌
- 稀有度即叙事密度：越高品质的掉落附越厚重的历史，奖励"刷取"的好奇心
- 赛季限定装备绑定当季叙事，成为玩家"亲历过那个赛季"的故事凭证
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯数值词条；每件值得记忆的装备都要带一句风味铭文或一段来历
- 装备 Lore 须与所属阵营/赛季自洽，杜绝设定错位
- 系列叙事须可"分件掉落、集齐拼合"，单件暗示整体却不剧透
- 赛季装备文案须锚定当季事件，让装备成为可回味的时间凭证
`.trim();

const SCENE_GENERATION_STYLE = `
# 掠夺射击环境叙事守则（用战场与据点讲故事）
- 用战场遗迹讲世界史：废弃前哨、阵营交火痕迹、被掠夺一空的补给站
- 据点是"活的世界状态展板"：随赛季更换的布告、纪念碑、NPC 聚集反映叙事进程
- 高难度区域（团本/暗区）的环境叙事最厚重，奖励深入者以世界真相
- 阵营领地的视觉标签即叙事：从建筑、涂装、战利品读出占领者是谁、来历如何
- 战利品现场化：Boss 倒下处、宝箱所在地的环境暗示这件装备"为何在此"
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须承载世界史与阵营叙事，禁止纯刷怪场地的功能性堆砌
- 据点须随赛季有可见状态变化，杜绝长期一成不变的静态社交空间
- 高难度区域的叙事密度须高于常规区，奖励深入探索
- 阵营领地视觉标签须与该势力设定自洽，强化可辨识度
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："末世都市掠夺 / 掠夺射击 / 阵营割据"
- 活的世界：瘟疫后被多方武装割据的都市，本赛季"清道夫帮"崛起为新威胁
- 装备 Lore：异域步枪"长夜的回声"铭文记录前持有者死守医院的最后一战
- 据点状态：基地布告栏随赛季更新通缉令，纪念墙新增上赛季阵亡干员名牌
- 战利品现场：暗区一处被路障围死的诊所，Boss 倒地处掉落的护甲属于失踪的医疗队长
`.trim();

export const FPS_LOOTER_SKILL: NarrativeSkill = {
  genreCode: "fps-looter",
  tier: "tier2",
  matchKeywords: ["掠夺射击", "looter shooter", "命运2", "Destiny", "全境封锁", "The Division", "无主之地", "Borderlands", "刷枪", "刷装备射击"],
  // 碎片链：世界观 → 角色 → 道具 → 场景（无 L0-L5 主线）
  narrativeSteps: ["worldview", "character_enrichment", "item_database", "scene_plan"],
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
        style_guide: "掠夺射击角色塑造：主角留白承载自定义与 Build，据点 NPC 随赛季演变，传奇人物以装备 Lore 缺席登场。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
  },
};

registerSkill(FPS_LOOTER_SKILL);
