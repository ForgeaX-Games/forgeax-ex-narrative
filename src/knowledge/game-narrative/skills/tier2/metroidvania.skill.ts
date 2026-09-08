/**
 * Metroidvania (act-metroidvania) — Tier2 碎片化叙事品类 skill
 *
 * Archetype C（碎片化叙事），核心：能力门控探索叙事、沉默主角+表达性世界、
 * 隐藏NPC支线、地图即故事结构、环境视觉叙事、Boss战作为叙事高潮。
 *
 * 参考：Hollow Knight、Metroid、Castlevania: SotN、Ori、Axiom Verge、
 *       Blasphemous、Salt and Sanctuary、Dead Cells
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 银河恶魔城 世界观原型（"被封印的活地图"）
- 世界是一个巨大的、互相连通的有机体——区域之间的通道本身就是叙事
- 空间门控=叙事门控：能力获取不只是"钥匙"，而是"理解世界的新视角"
  （二段跳=到达遗忘的高处/潜水=发现淹没的历史/破墙=揭开被掩盖的真相）
- 世界的"封闭"有原因：感染/诅咒/封印/遗忘——整个地图就是一个被隔离的故事
- 垂直+水平双轴叙事：水平=文明延伸的广度，垂直=时间/权力的深度
- 地图中心存在"引力"：所有路径最终指向核心区域——世界的秘密/创伤/源头
- 被遗忘的区域=被压抑的记忆：越隐蔽的区域包含越核心的世界真相
- 区域间的"生态梯度"构成无声叙事：从翠绿→腐烂→结晶→虚空——衰败有方向
`.trim();

const WORLDVIEW_STYLE = `
- 语调：诗意、克制、留白充分——像一首没有歌词的史诗配乐
- 世界描写使用"第一视觉印象"法：先给感官冲击（色彩/声音/温度），再给细节解读
- 命名采用"意象化"策略：地名即情绪（"悲泣深渊""真菌荒原""水晶峰"而非"B-3区域"）
- 文字极度节制：整个游戏的文本量可能不到一本短篇小说——每句话都承载密度极高的信息
- NPC对白是"孤岛上的独白"——他们在自言自语，你恰好路过
- 环境描写优先于对白——90%的故事通过背景美术/场景布置讲述
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 世界的完整真相不能通过单次通关完全获取——必须保留"探索奖励"层次的叙事
- 能力门控必须有世界观逻辑：为什么这个能力能打开这条路？不能是纯机械设计
- 区域之间的生态/风格过渡必须自然——不允许毫无过渡的风格跳变
- 地图的"不可达区域"在视觉上必须先给玩家留下印象——回访时产生"原来如此"的满足感
- 禁止区域叙事独立——每个区域的故事必须是整体叙事的一个有机切面
`.trim();

const SCENE_GENERATION_STYLE = `
# 银河恶魔城 场景叙事（"无声剧场"）

## 区域作为叙事章节
- 每个区域是一个"情绪主题"：绝望/希望/疯狂/宁静/残忍/悲悯
- 区域入口是"第一句话"：视觉冲击+音乐变化告诉玩家"这里的故事基调"
- 区域深处是"高潮"：Boss/重要NPC/关键Lore——用关卡难度作为叙事节奏的"慢镜头"
- 区域出口/快捷通道是"回响"：开启捷径时回望来路，产生"旅途感"

## 环境视觉叙事
- 背景层叙事：远景中的巨大遗迹/倒塌的雕像/被链条束缚的什么——暗示历史规模
- 前景细节叙事：NPC遗骸的姿态（保护？逃跑？战斗？绝望？）/墙上的爪痕方向/植物生长模式
- 光源即情感指引：自然光=安全或希望/人造光=文明残存/发光菌=未知/黑暗=威胁或秘密

## Boss前区/Boss房设计
- Boss前的长走廊/大厅=仪式感铺垫：氛围压迫逐步升级
- Boss房的环境暗示Boss身份：王座上的巨人/被自己的力量扭曲的空间/用尸骸搭建的巢穴
- Boss战后的场景变化：Boss死亡改变区域状态（解封/崩塌/净化）——战斗有世界性后果

## NPC交互
- 散落在世界各处的NPC是"幸存者"——各有各的执念/目的/命运
- NPC台词 ≤ 150字/整条线（全流程）：每句话都是浓缩的诗
- NPC位置本身是叙事：为什么他在这里？他在等什么/守护什么/逃避什么？
- NPC支线通过"多次偶遇"推进——不是任务系统而是世界中的自然相遇
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 禁止大段文字说明/教程弹窗——所有引导通过关卡设计和视觉暗示完成
- Boss出场不安排冗长过场——用环境+极简台词（≤1句）建立存在感
- 不同区域之间的连接通道必须有"过渡叙事"——哪怕只是颜色/音乐的渐变
- NPC不能作为"信息贩卖机"——对白必须反映他们自己的处境和情感
- 隐藏区域的叙事价值必须配得上探索难度——不能用平庸Lore奖励高难度探索
`.trim();

const ITEM_DATABASE_STYLE = `
# 银河恶魔城 物品描述（"沉默世界的证词"）

## 能力/技能获取物
- 描述必须连接能力的"世界观来源"：谁创造了这个能力/为什么它被遗留在这里
- 获取场所和描述互为补充：在废弃实验室获得的力量 vs 在神殿获得的祝福——语气截然不同
- 能力名称使用意象化命名："君主之翼"而非"二段跳"，"深渊之泪"而非"潜水能力"

## 装备/护符/徽章
- 每件装备是一个角色的"遗物"——3句话内浓缩持有者的命运
- 同一套装的不同部件给出同一故事的不同视角
- 效果和Lore呼应："牺牲者的护符"增加受伤时的攻击力——以痛苦换力量

## 消耗品/素材
- 世界生态的碎片：采集物的描述暗示区域的生态历史
- 用途和来源关联："这种蘑菇只在尸骸密集处生长"
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 能力获取物的描述禁止透露该能力可以开启哪些门控——保持探索的惊喜感
- 装备描述禁止重复已知NPC的信息——必须补充新的叙事切面
- 同一区域掉落的物品描述不能互相矛盾（除非矛盾本身是设计）
- 消耗品也需要Lore——"回复生命"的机械描述不可接受
- Boss掉落物必须让玩家"重新理解这场战斗的意义"
`.trim();

export const METROIDVANIA_SKILL: NarrativeSkill = {
  genreCode: "act-metroidvania",
  tier: "tier2",
  matchKeywords: [
    "银河恶魔城", "Metroidvania", "银河城",
    "Hollow Knight", "空洞骑士", "Metroid", "密特罗德",
    "Castlevania", "恶魔城", "月下夜想曲",
    "Ori", "奥日", "Axiom Verge", "公理边缘",
    "Blasphemous", "渎神", "Salt and Sanctuary",
    "能力门控", "地图探索", "非线性探索",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    scene_plan: {
      slots: {
        style_guide: SCENE_GENERATION_STYLE,
        constraints: SCENE_GENERATION_CONSTRAINTS,
      },
    },
    item_database: {
      slots: {
        style_guide: ITEM_DATABASE_STYLE,
        constraints: ITEM_DATABASE_CONSTRAINTS,
      },
    },
  },
};

registerSkill(METROIDVANIA_SKILL);
