/**
 * str-tbs — 品类叙事包（回合制策略 / Turn-Based Strategy）
 *
 * 回合制策略 = 涌现叙事型。叙事不来自预编排主线，而由「文明长河 + 势力张力 + 回合事件」
 * 在玩家逐回合决策中自然生长（文明 / 全面战争 / XCOM 一脉）。
 *
 * 涌现叙事链（通用前驱之后）：世界观 → 角色丰满 → 剧情生成
 *
 * C3（2026-08）已封存：原品类特化的 emergent_event step 吸收进通用 plot_generation，
 * 事件分类配比/触发平衡守则改由 plot_generation 的 style_guide / constraints 槽位承载，
 * 形态差异交给 network/emergent/fragmented 三张结构卡区分。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 回合制策略 世界观原型（"文明长河中的多极棋盘"）
- 世界是一张"活的战略地图"：地形、资源、城邦、奇观决定文明的命运走向
- 多文明并立：每个文明带独特的国民性格、领袖偏好与历史宿怨，无玩家也在扩张
- 时代演进轴：从远古蒙昧到太空时代，科技/制度跃迁让同一张地图反复改写规则
- 资源与战略要冲：铁/马/石油等战略资源稀缺，咽喉关隘与海峡是世代争夺的火药桶
- 胜利路径多元：征服 / 科技 / 文化 / 外交并存，世界格局随玩家选择的路线倾斜
`.trim();

const WORLDVIEW_STYLE = `
- 语调：史诗编年体，以"文明兴衰的长镜头"俯瞰每一个回合的微小决策
- 世界须先于玩家存在：开局即给出多文明的初始张力与领土纠葛
- 地理即叙事：用资源分布与地形差异预埋"必争之地"，让冲突有地理根因
- 时代切换须有质感：每跨入新时代，世界的威胁与机遇都应改写一轮
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写成单一主角的英雄史；主角视角让位于"文明 vs 文明"的宏观博弈
- 每个文明须有可被玩家感知的"国策倾向"（扩张/科技/信仰/商贸），避免同质化
- 至少铺设 3 处战略要冲与 2 对结构性宿敌，作为回合事件的发火点
- 不预设结局；世界须为多条胜利路径同时供给土壤
`.trim();

const CHARACTER_ARCHETYPE = `
# 回合制策略 角色原型（领袖 = 文明的人格化）
- 各文明领袖：以鲜明的历史人格承载文明性格（好战/睿智/虔诚/贪婪），是外交舞台的主角
- 玩家文明 = 半白板：由玩家的扩张/结盟/背叛行为逐步定义其"历史形象"
- 顾问/将领群像：科技顾问、军事统帅、宗教领袖，在关键回合给出带立场的进言
- 宿敌领袖：与玩家文明有结构性矛盾，其议程独立推进，构成长期张力源
`.trim();

const CHARACTER_CONSTRAINTS = `
- 领袖须有稳定的行为逻辑（外交记忆/宿怨/好感），让 AI 决策可被玩家预判与博弈
- 玩家文明的"历史形象"由行为累积，禁止预设固定善恶人设
- 顾问进言须带立场偏向，而非中立旁白，制造决策两难
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 回合制策略 涌现事件池（分类配比）
- 文明事件（约 35%）：黄金时代、人口暴动、伟人诞生、奇观竣工——绑定文明长期状态
- 外交事件（约 25%）：联盟邀约、宣战通牒、背刺、贸易禁运——绑定多文明张力
- 战争事件（约 20%）：要冲陷落、增援抵达、围城断粮、决定性会战——绑定战术局势
- 时代/科技事件（约 12%）：科技突破、制度革新、新威胁登场——随时代切换刷新
- 突发事件（约 8%）：瘟疫、天灾、蛮族入侵、流亡贤者来投——为长局注入变数
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则
- 事件触发须读取"世界状态 + 文明状态 + 回合阶段"，杜绝纯随机弹窗
- 高烈度事件（宣战/天灾）须有冷却与前兆，避免连续打击让长局崩盘
- 每个抉择须改写后续世界状态（外交记忆/资源/领土），让回合决策有长期回响
- 落后文明应获得"翻盘种子"事件，领先文明应承受"树大招风"压力，维持张力曲线
- 事件后果须对所有文明可见、可反应，体现"世界在运转"而非只围着玩家转
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风
- 编年史口吻：以史官记录的笔调陈述"发生了什么"，让事件像史册的一页
- 描述世界变化而非指示玩家："北境的铁矿落入敌手"，把判断留给玩家
- 领袖发言带其文明性格的腔调，让外交事件有人格温度
- 重大事件给"时代回响"的余韵：一句对文明长河的远景注脚
`.trim();

export const STR_TBS_SKILL: NarrativeSkill = {
  genreCode: "str-tbs",
  tier: "tier2",
  matchKeywords: ["回合制策略", "tbs", "文明", "全面战争", "xcom", "Civilization", "策略"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        constraints: WORLDVIEW_CONSTRAINTS,
      },
    },
    character_enrichment: {
      slots: {
        character_archetype: CHARACTER_ARCHETYPE,
        style_guide: "回合制策略角色塑造：领袖是文明的人格化，行为逻辑稳定可博弈；玩家文明由行为定义历史形象。",
        constraints: CHARACTER_CONSTRAINTS,
      },
    },
    // C3：原 emergent_event（涌现事件池）吸收进通用 plot_generation
    plot_generation: {
      slots: {
        style_guide: EMERGENT_STYLE,
        constraints: `${EMERGENT_CATEGORY_RULES}\n\n${EMERGENT_BALANCE_RULES}`,
      },
    },
  },
};

registerSkill(STR_TBS_SKILL);
