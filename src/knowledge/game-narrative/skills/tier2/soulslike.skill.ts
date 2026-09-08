/**
 * Soulslike (rpg-soulslike) — Tier2 碎片化叙事品类 skill
 *
 * Archetype C（碎片化叙事），核心：环境叙事、物品描述即 Lore、
 * 极简对白、压迫性氛围、互相连通的世界设计。
 *
 * 参考：Dark Souls、Elden Ring、Bloodborne、Hollow Knight、Lies of P
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# Soulslike 世界观原型（"文明废墟"宇宙学）
- 世界处于"第 N 次轮回"或"黄金时代终末"——玩家到达时一切已经结束
- 宇宙学三层：表层物质世界 / 底层规则力量（火/梦/血/虫） / 两者之间的媒介（王/神/契约者）
- 地理即叙事轴：垂直结构（地上=已死文明/地下=被封印的真相/深渊=原初力量）
- 区域环形连通：不同路径通往同一核心，每条路对应一位"失败的前任"
- 灾变的原因 = 核心设计谜团（延续火焰？打碎轮回？拥抱深渊？）
- 必须存在"观察者/记录者"NPC——他比你更早到达，但选择了不行动
`.trim();

const WORLDVIEW_STYLE = `
- 语调：肃穆、古典、含蓄——像在阅读一位失落文明学者的田野笔记
- 第一段建立"这个世界曾经辉煌"的对比感（废墟中残存的美丽）
- 禁止直接说明因果——用"有人说…""据传…""残存的铭文记载…"留出解读空间
- 命名规则：专有名词使用生僻/古典感用词（"灰烬审判所"而非"裁判所"）
- 在描述世界整体时使用"编年体"片段，而非完整线性历史
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁明确回答"世界为什么变成这样"——必须保留至少 2 种合理解读
- 每个区域的世界观描述必须包含：1)曾经是什么 2)现在是什么 3)暗示为什么（但不确认）
- 力量体系不可过度量化——"火焰渐弱"而非"火焰还剩 30%"
- 至少 1 个核心设定存在"官方给出的解释可能是谎言"的层次
`.trim();

const ITEM_DATABASE_STYLE = `
# Soulslike 物品描述（核心 Lore 载体）
- 每条物品描述 ≤ 80 字，最多 3 句
- 第一句：物理描述（形态/材质/状态）
- 第二句：归属/来源暗示（"曾属于…""出土于…""据说是…的遗物"）
- 第三句（可选）：暗示性信息（"使用者无一善终""刀刃上的痕迹并非来自战斗"）

写作技巧：
- 使用"不在场证明"叙事：通过描述物品的状态，暗示持有者发生了什么
- 同一事件的不同物品给出不同视角——互相补完但也互相矛盾
- 关键 Lore 物品的描述故意模糊（"据传""或许""似乎"）
- Boss 掉落物是该 Boss 生前故事的浓缩——3 句话讲完一个悲剧

参考（Elden Ring风格）：
"镀金的义肢刀刃，曾属于一位誓言切断宿命之人。她最终切断的，是自己与人类之间的牵绊。"
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁在物品描述中直接解释世界观设定——物品是"证据"不是"百科词条"
- 同一组关联物品（套装/系列武器）的描述禁止重复相同信息
- 消耗品/素材也需要 Lore 意义（"采集自不应存在的花朵"而非"恢复 HP 的药草"）
- Boss 魂/核心物品的描述必须让玩家"重新理解刚才的战斗"
`.trim();

const SCENE_GENERATION_STYLE = `
# Soulslike 场景叙事（环境即剧本）
- 每个场景是一个"无声的故事现场"——进入时就能感受到"这里发生过什么"
- 环境叙事三要素：
  1) 静物布置（尸体/倒塌方向/物品散落位置）→ 重建事件
  2) 空间情绪（光源/色温/空间开阔度）→ 引导情感
  3) 声音暗示（风声方向/滴水/远处金属声）→ 制造不安

场景类型：
- 废墟探索区：多层叙事（表面可读 + 隐藏可推断 + 深层永远模糊）
- Boss 前厅：沉默走廊，用环境暗示即将面对的存在（巨大抓痕/融化的墙壁/跪拜的石像）
- 安全区/篝火：唯一温暖，NPC 在此提供碎片化对白
- 隐藏区域：奖励最重要的 Lore，用难度/隐蔽性过滤到达者

NPC 对白规则：
- 每位 NPC 总台词 < 200 字（全游戏所有对话加起来）
- 首次对话：谜语般的自我介绍（"你也是被召唤来的吗…和之前那些一样"）
- 后续对话：每次推进主线后解锁 1-2 句新台词
- 最终对话：消失或死亡前的 1 句话（回收此角色所有暗示的真相）
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 禁止任何解释性旁白/教程文案破坏氛围——引导通过关卡设计而非文字
- NPC 对白禁止解释机制（不说"前方有陷阱"，改为"很多人倒在那条走廊里"）
- 场景描述必须同时服务于"氛围营造"和"Lore 投递"两个目的
- Boss 战前不安排过场动画式长对白——Boss 出场靠环境铺垫+极简台词（≤ 2 句）
- 安全区对白不能一次性倾倒信息——必须分多次逐步解锁
`.trim();

export const SOULSLIKE_SKILL: NarrativeSkill = {
  genreCode: "rpg-soulslike",
  tier: "tier2",
  matchKeywords: [
    "魂系", "Soulslike", "魂类", "Dark Souls", "黑暗之魂",
    "Elden Ring", "艾尔登法环", "Bloodborne", "血源诅咒",
    "Hollow Knight", "空洞骑士", "Lies of P", "匹诺曹的谎言",
    "碎片化叙事", "环境叙事", "物品描述", "高难度动作RPG",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
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

registerSkill(SOULSLIKE_SKILL);
