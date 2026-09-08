/**
 * rhy-action — 品类叙事包（音乐动作 / Rhythm Action）
 *
 * 轻量线性叙事（中等占比 20-35%）：节奏即玩法，关卡即曲目。音乐风格定义世界
 * 基调，剧情是串联曲目的轻量线，服务于"打击感 + 听觉沉浸"而非反向喧宾夺主
 * （节奏地牢 Crypt of the NecroDancer）。
 *
 * 节奏链：通用前驱(偏好→初步方案) +
 *   [世界观 → 角色 → 道具 → L0框架 → 大纲批次 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 音乐动作世界观原型（"由节拍统治的世界"）
- 音乐是世界的物理法则：万物随节拍律动，行动必须踩点，连呼吸都合着鼓点
- 关卡 = 曲目：每首曲子是一个独立的"乐章关卡"，曲风决定该区域的气质、敌人与难度
- 音乐风格定义世界基调：电子/合成波的霓虹都市、金属乐的炼狱、民谣的田园——曲风即世界观
- 轻量串联线：一条简单清晰的旅程（追寻/逃离/对决）把一首首曲目穿成珠链
- 听觉沉浸优先：世界设定服务于"想让人跟着摇摆"的氛围，而非复杂设定考据
- 代表母题：踩着节拍闯地牢（节奏地牢）、用音乐对抗黑暗、跟随旋律的奇幻之旅
`.trim();

const WORLDVIEW_STYLE = `
- 语调：律动、鲜明、有画面感；文字本身要有节奏感与韵律
- 世界观以"曲风分区 + 节拍法则 + 一条轻量旅程线"铺设
- 每个分区绑定一种音乐风格，曲风、配色、敌人节奏三位一体
- 设定须为"关卡即曲目"留接口：每个地点都能对应一首可玩的乐章
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界设定须服务于节奏玩法与听觉沉浸，杜绝压过玩法的厚重设定
- 每个分区须绑定明确曲风并以此定调，避免风格混杂的失焦世界
- 剧情线须保持轻量线性，禁止喧宾夺主的复杂支线网
- 节拍法则须自洽（万物踩点），世界逻辑须能解释"为何必须合拍"
`.trim();

const WORLDVIEW_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："合成波霓虹都市 / 音乐动作 / 追寻失窃节拍核心"
- 节拍法则：城市的霓虹随贝斯脉动，居民的脚步天生卡在鼓点上
- 曲风分区：合成波街区(轻快) → 工业舞曲地下城(高压) → 主控塔的史诗电子(终章)
- 轻量旅程线：主角的"节拍核心"被夺，循着音乐线索一路打回去夺回城市的心跳
`.trim();

const CHARACTER_ARCHETYPE = `
# 音乐动作角色原型（律动化的鲜明剪影）
- 主角：与音乐共生的舞者/乐手/战士，性格用一种"专属节奏感"外化（轻快、冷峻、狂野）
- 角色即音色：每个角色绑定一种乐器或音色，登场就是一段可辨识的旋律动机
- 敌人按曲风成组：每个分区的敌人有专属的节奏行为模式，是该曲目的"演奏者"
- Boss = 一首高潮曲目的化身：以乐章结构编排其攻击段落（主歌→副歌→solo→终章）
- 同伴/对手轻量化：靠一两个鲜明记忆点立住，服务旅程调味而非深度群像
`.trim();

const CHARACTER_STYLE = `
音乐动作角色塑造：用最少笔墨立最鲜明的律动剪影——一种音色、一个动机旋律、一套节奏化的动作语言即可定义角色。
情感与性格通过"节奏感"外化，台词与登场都自带韵律，服务于"想跟着动起来"的冲动。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色须有可辨识的音色/节奏标签，杜绝与音乐无关的扁平人设
- 敌人须按曲风成组并带专属节奏行为，避免无律动逻辑的杂兵堆砌
- Boss 须以乐章结构编排攻击段落，禁止与音乐节奏脱节的战斗设计
- 配角须轻量鲜明，不喧宾夺主深挖内心戏拖慢节奏
`.trim();

const ITEM_DATABASE_STYLE = `
# 音乐动作道具 Lore 守则（道具即乐器与节奏增益）
- 道具首先是"演奏工具与节奏增益"：乐器武器、节拍护符、变调饰品，功能与音乐挂钩
- 装备带音色身份：每件乐器武器对应一种音色与攻击节拍型，外观呼应所属曲风
- 稀有物承载微叙事：传说中的乐器、失传的乐谱碎片，掉落即带一段轻量乐坛传说
- 道具影响节奏体验：加速曲速、改变拍号、解锁连击的物品，把"养成"译为听感变化
- 收集品做成"曲库/唱片"：拾取解锁新曲目或混音，让探索的回报是听觉惊喜
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 道具须与音乐/节奏玩法绑定，杜绝与听感无关的纯数值物品
- 乐器武器须带音色身份并呼应所属曲风，避免风格错位
- 稀有物须带轻量乐坛传说一句来历，保持与世界调性一致
- 收集品须以听觉回报为核心（新曲/混音），不做无意义的数值堆叠
`.trim();

const STORY_FRAMEWORK_STYLE = `
# 音乐动作故事框架（曲目串联的轻量旅程）
- L0 是一条"穿珠式"的轻量主线：用最简洁的动机（追寻/夺回/对决）把曲目关卡依次串起
- 章节即曲风段落：旅程从轻快曲风出发，逐段升压，终章是最高潮的史诗乐章
- 叙事密度刻意克制：每关之间用一两句过场推进，绝不打断"一关接一关"的律动流
- 情绪曲线对应音乐曲线：故事的起伏与专辑式的曲序编排同频共振
`.trim();

const STORY_FRAMEWORK_EXAMPLES = `
# L0 轻量旅程风味示例
## 主题："夺回城市心跳"
- 起点（轻快段）：主角在霓虹街区觉醒节拍之力，踏上夺回核心之路
- 升压段：穿越工业地下城，曲风转为高压舞曲，遭遇按拍进攻的机械守卫
- 终章（史诗段）：主控塔顶与夺心者对决，一首多段式电子史诗作为最终战
`.trim();

const STORY_FRAMEWORK_CONSTRAINTS = `
- L0 须保持轻量线性，杜绝复杂分支拖慢"关卡即曲目"的推进节奏
- 章节须对应曲风段落并呈现升压曲线，避免情绪与曲序脱节
- 过场叙事须极简，禁止冗长剧情打断连续闯关的律动流
- 情绪曲线须与音乐曲线同频，杜绝叙事高潮与曲目高潮错位
`.trim();

const OUTLINE_BATCH_STYLE = `
# 音乐动作大纲批次守则（曲目关卡素材库）
- 大纲产出的是"一首首乐章关卡的设定卡"：曲风、基调、敌人节奏型、环境意象
- 每张卡绑定其在旅程曲线中的位置（开场/升压/喘息/高潮），保证整体专辑式起伏
- 关卡须高度模块化：可调整曲序而不破坏轻量主线，便于增减曲目
- 优先批量产出风格各异的乐章骨架，确保曲风多样、听感不重复
`.trim();

const OUTLINE_BATCH_CONSTRAINTS = `
- 大纲须以"乐章关卡卡片"组织，每卡标注曲风与旅程曲线位置
- 关卡须模块化可调序，杜绝强耦合到唯一固定曲序的写法
- 须保证曲风多样性，避免听感雷同的重复乐章
- 叙事信息须极简，禁止单关卡塞入压过节奏玩法的剧情
`.trim();

const SCENE_GENERATION_STYLE = `
# 音乐动作环境叙事守则（用视觉律动呼应音乐）
- 场景是"可视化的音乐"：背景元素随节拍律动、闪烁、脉冲，让玩家用眼睛也能"听"到拍子
- 配色与曲风绑定：合成波的霓虹紫蓝、金属的暗红、田园的暖绿，一眼定调曲目情绪
- 环境节奏化：会卡拍开合的机关、随鼓点亮起的踏板，把场景本身变成节奏提示
- 终章场景升格为"演唱会现场"感：灯光、人群、舞台规模随曲目高潮层层放大
- 轻量叙事点点缀：墙面涂鸦、霓虹招牌暗示世界背景，但绝不打断闯关流
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须随节拍产生可视律动，杜绝与音乐无关的静态背景
- 配色与视觉风格须严格绑定该关曲风，避免风格错位
- 环境机关须节奏化并辅助玩家读拍，不做干扰节奏判断的视觉噪音
- 叙事点缀须轻量不打断闯关流，杜绝强制停手的过场
`.trim();

export const RHY_ACTION_SKILL: NarrativeSkill = {
  genreCode: "rhy-action",
  tier: "tier2",
  matchKeywords: ["音乐动作", "节奏地牢"],
  // 节奏链：世界观 → 角色 → 道具 → L0框架 → 大纲批次 → 场景
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "scene_plan",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
        examples: WORLDVIEW_EXAMPLES,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: CHARACTER_STYLE,
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
        examples: STORY_FRAMEWORK_EXAMPLES,
        constraints: STORY_FRAMEWORK_CONSTRAINTS,
      },
    },
    outline_batch: {
      slots: {
        style_guide: OUTLINE_BATCH_STYLE,
        constraints: OUTLINE_BATCH_CONSTRAINTS,
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

registerSkill(RHY_ACTION_SKILL);
