/**
 * Card Game (card-ccg / card-narrative / card-dbg / card-boardgame) — F3 模板示例 skill
 *
 * 适配通用管线：worldview / lore_generation / plot_generation。
 * 同时为 card-narrative 提供叙事卡牌的特化覆盖（更重剧情 + dialogue 风格）。
 *
 * C3（2026-08）已封存：card_lore / event_pool 两个品类特化 step 吸收进通用
 * lore_generation / plot_generation，形态差异交给 network/emergent/fragmented
 * 三张结构卡；本文件下方各 CCG 卷附属的势力 / 稀有度 / 节奏 / 奖励守则不再是
 * 独立槽位，而是折入 lore_generation.style_guide 与 plot_generation.style_guide。
 *
 * 后续修正：C3 当时把稀有度档位表与"6-10 个物品叙事"留在了 lore_generation 的通用
 * 基线里，等于让全 tier3 品类都吃卡牌形态。本轮已把它们收进下方 CCG_ITEM_COVERAGE /
 * DBG_ITEM_COVERAGE 由 genre 门控，基线只保留品类中性的物品叙事字段要求。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const CCG_WORLDVIEW = `
# CCG 世界观要点
- 世界观必须模块化：每个"系列 / 资料片"可独立成主题，又能互相串联
- 至少 4-6 个势力，每个势力有鲜明的颜色 / 元素 / 哲学（参考万智牌五色）
- 时间线必须能装载未来的扩展剧情
- 不可"一锤定音"——为留白与翻盘留余地
`.trim();

const CCG_CARD_STYLE = `
# CCG 卡牌叙事风格
- flavor_text 长度 ≤ 40 字 / 1 句话；要"有作者"、像引用
- 同一张卡的 flavor 可来自多个不同声音（NPC / 古书 / 民谣）以营造真实感
- lore 段强调"事件感"：一句话铺设场景 + 一句话推进 + 一句话留尾
`.trim();

const CCG_FACTION_RULES = `
# CCG 势力守则
- 每个势力都必须可被玩家"代入"——他想要什么、他害怕什么、他会怎么赢
- 势力间 6 种关系：亲密 / 联盟 / 中立 / 紧张 / 对立 / 死敌（对应卡组协同与克制）
- 写 lore 时要把势力间的"故事冲突点"埋成卡牌
`.trim();

const CCG_RARITY_RULES = `
# 稀有度文本规则
- common：日常事件 / 小角色，flavor 1 句即可
- rare：转折性场景 / 配角主场，flavor 2 句
- epic：势力大事件 / 关键 NPC 登场，flavor 必须留尾
- legendary：跨势力 / 传奇人物，可以 2-3 句完整微叙事
- mythic：保留给"神级 / 时代终结"，每张都必须独立改变世界观
`.trim();

/**
 * 物品叙事的数量与分级覆盖要求。
 *
 * 这段原本写在 `lore-generation.ts` 的 step 基线里（"6-10 个物品叙事、涵盖不同稀有度"
 * + `common→legendary` 档位表），但 `lore_generation` 是 `pl-codex` 全 tier3 共用的
 * 通用席——RTS / 大逃杀 / 纯益智跑到那一步也会被要求产出卡牌式稀有度。按吸收滤芯的
 * 内容分层轴（见 `docs/absorption-filter.md`），品类形态只能由 genre 门控的 skill 注入。
 */
const CCG_ITEM_COVERAGE = `
# 物品叙事覆盖要求
- 本品类的物件即卡面，是叙事的主要载体：给出 6-10 个物品叙事，涵盖不同类型
- rarity 字段必填，取值限定 common / uncommon / rare / epic / legendary
- 各档位都要有，且档位越高 flavor 的分量越重（见稀有度文本规则）
`.trim();

const DBG_ITEM_COVERAGE = `
# 物品叙事覆盖要求
- 构筑类的卡牌即物件：给出 6-10 个物品叙事，涵盖不同类型
- 本品类不强制分级体系，rarity 可留空
`.trim();

const CCG_EVENT_STYLE = `
# CCG 事件池文学调性
- daily / weekly：贴近"卡组挑战 / 资源互动" 的小事件
- seasonal：当前赛季的剧情主轴的一个章节，要让玩家"等下次更新"
- story：跨赛季 / 跨年的大事件链；解锁条件可以是"完成某剧情成就"
`.trim();

const CCG_EVENT_PACING = `
# CCG 事件节奏
- 赛季开局两周：高频日常 + 1-2 个揭幕剧情，让玩家熟悉新势力
- 赛季中期：周事件密度最高，配合卡组玩法生态形成
- 赛季尾声：1-2 个高潮 story 事件 + 1 个伏笔指向下个赛季
`.trim();

const CCG_REWARD_RULES = `
# CCG 奖励曲线
- daily 奖励：基础货币 / 体力补给，避免影响竞技平衡
- weekly：碎片 / 卡背 / 头像
- seasonal：本赛季限定卡 / 故事章节
- story：跨赛季纪念性奖励 + 称号
`.trim();

const NARRATIVE_CARD_STYLE = `
# 叙事卡牌专属风格（card-narrative）
- 每张卡是一段微叙事：可独立阅读，也能拼出大故事
- 牌库本身就是"主角的人生记录"——不同卡 = 不同记忆
- 战斗描述要让玩家相信"这是我的角色，不是抽象骨架"
`.trim();

const CCG_SKILL: NarrativeSkill = {
  genreCode: "card-ccg",
  tier: "tier3",
  matchKeywords: ["CCG", "TCG", "炉石传说", "万智牌", "影之诗", "符文之地", "游戏王"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: CCG_WORLDVIEW } },
    lore_generation: {
      slots: {
        style_guide: `${CCG_CARD_STYLE}\n\n${CCG_FACTION_RULES}\n\n${CCG_RARITY_RULES}`,
        constraints: CCG_ITEM_COVERAGE,
      },
    },
    plot_generation: {
      slots: {
        style_guide: `${CCG_EVENT_STYLE}\n\n${CCG_EVENT_PACING}\n\n${CCG_REWARD_RULES}`,
      },
    },
  },
};

const CARD_NARRATIVE_SKILL: NarrativeSkill = {
  genreCode: "card-narrative",
  tier: "tier1",
  matchKeywords: ["叙事卡牌", "Card Narrative", "杀戮尖塔", "Inscryption", "卡牌之声"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: CCG_WORLDVIEW } },
    lore_generation: {
      slots: {
        style_guide: `${NARRATIVE_CARD_STYLE}\n\n${CCG_FACTION_RULES}\n\n${CCG_RARITY_RULES}`,
        constraints: CCG_ITEM_COVERAGE,
      },
    },
    plot_generation: {
      slots: {
        style_guide: `${CCG_EVENT_STYLE}\n\n叙事卡牌的事件节奏要与角色心境同步：低谷期事件偏暗，主角崛起时事件偏温暖。`,
      },
    },
  },
};

const CARD_DBG_SKILL: NarrativeSkill = {
  genreCode: "card-dbg",
  tier: "tier2",
  matchKeywords: ["DBG", "构筑", "杀戮尖塔", "怪物火车", "邪恶冥刻"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: CCG_WORLDVIEW } },
    lore_generation: {
      slots: {
        style_guide: `${CCG_CARD_STYLE}\n\n${CCG_FACTION_RULES}`,
        constraints: DBG_ITEM_COVERAGE,
      },
    },
    plot_generation: { slots: { style_guide: CCG_EVENT_STYLE } },
  },
};

const CARD_BOARDGAME_SKILL: NarrativeSkill = {
  genreCode: "card-boardgame",
  tier: "tier3",
  matchKeywords: ["桌游", "board game", "桌游数字化"],
  stepSkills: {
    worldview: { slots: { worldview_archetype: CCG_WORLDVIEW } },
    lore_generation: { slots: { style_guide: "桌游卡牌：保持原版桌游的简洁文本调性，避免过度叙事化。" } },
  },
};

registerSkill(CCG_SKILL);
registerSkill(CARD_NARRATIVE_SKILL);
registerSkill(CARD_DBG_SKILL);
registerSkill(CARD_BOARDGAME_SKILL);

export const CARD_GAME_SKILLS = [
  CCG_SKILL,
  CARD_NARRATIVE_SKILL,
  CARD_DBG_SKILL,
  CARD_BOARDGAME_SKILL,
];
