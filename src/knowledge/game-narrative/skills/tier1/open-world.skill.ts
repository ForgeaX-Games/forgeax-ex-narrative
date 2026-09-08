/**
 * Open World RPG (rpg-open-world) — F2 模板示例 skill
 *
 * 适配通用管线：worldview / character_enrichment / lore_generation / plot_generation。
 *
 * C3（2026-08）已封存：region_design / emergent_event 两个品类特化 step 吸收进
 * 通用 lore_generation / plot_generation，形态差异交给 network/emergent/fragmented
 * 三张结构卡。原 region_design 的风格 / 势力 / 密度守则并入
 * lore_generation（该 step 原本已有一份开放世界 Lore 风格，现两者合并）；
 * 原 emergent_event 的分类 / 平衡守则并入 plot_generation。
 */
import type { NarrativeSkill } from "../../skill-types.js";
import { registerSkill } from "../../skill-loader.js";

const OW_WORLDVIEW = `
# 开放世界 RPG 世界观要点
- 世界要"足够大且足够熟悉"：奇幻 / 末世 / 西部 / 赛博 之一基调
- 写实历史厚度：派系、宗教、贸易路线、王权更迭都要可考据
- 玩家能在任何方向探索 100+ 小时仍有内容，主线只占 30%-50%
- 时间流动 / 季节 / 昼夜 / 生态对玩法形成持续叙事张力
`.trim();

const OW_REGION_STYLE = `
# 区域设计风格
- 5-10 个核心区域，每个区域必须有不同的视觉记忆点（地标、生物、文化）
- 区域之间形成有意义的拓扑（峡谷-平原-森林-山脉），便于自然导航
- 边缘地带也要有设计意图，不可"用迷雾糊弄"
`.trim();

const OW_FACTION_RULES = `
# 势力体系守则
- 至少 3-5 个主要势力，互相之间存在友好 / 敌对 / 中立的有向关系网
- 每个区域应至少存在 1 主导势力 + 1 影响势力（避免势力真空）
- 势力的"利益主张"要可回答："如果我加入它，我会得到什么"
`.trim();

const OW_REGION_DENSITY = `
# 内容密度守则
- 每 5x5 km 区域至少 3 个 narrative_hooks
- 至少 2 个 hooks 要支持"无任务自然探索发现"（避免过度依赖任务标记）
- 主城与起点必须信息密度最高
`.trim();

const OW_EVENT_CATEGORY = `
# 涌现事件分类策略
- moral_dilemma 占 25-30%（让玩家不爽地做选择）
- faction_clash 占 15-20%（推动势力关系演变）
- discovery 占 20%（自然引导玩家"再走 100m 看看"）
- 其他类别均衡分布；避免单一类别堆积
`.trim();

const OW_EVENT_BALANCE = `
# 事件平衡 / 触发守则
- 同一区域内事件触发间隔 ≥ 5 分钟游戏时间，避免过度密集
- 高权重事件（weight ≥ 7）必须有前置条件防止过早触发
- 后果不可单向叠加：每一种正面后果应有相应的代价
`.trim();

const OW_LORE_STYLE = `
# 开放世界 Lore 风格
- 通过书信、墓志铭、雕塑、废墟铭文等多重载体投递
- 不堆叠 setting，让玩家自己拼凑 — 至少留 30% 不被显式说明的留白
- Lore 与玩法挂钩（书页提示某个隐藏地点、某个 NPC 的真实身份）
`.trim();

export const OPEN_WORLD_SKILL: NarrativeSkill = {
  genreCode: "rpg-open-world",
  tier: "tier1",
  matchKeywords: [
    "开放世界",
    "open world",
    "塞尔达",
    "上古卷轴",
    "巫师3",
    "GTA",
    "荒野大镖客",
    "赛博朋克2077",
    "侠盗猎车",
    "类GTA",
  ],
  // 史诗叙事型·开放世界专属链（通用前驱 偏好→初步方案 之后）：
  //   世界观 → 角色 → lore_generation（含原区域设计）→ plot_generation（含原涌现事件）→ 道具 → (任务 ∥ 场景)
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "lore_generation",
    "plot_generation",
    "item_database",
    ["quest_generation", "scene_plan"],
  ],
  stepSkills: {
    worldview: { slots: { worldview_archetype: OW_WORLDVIEW } },
    character_enrichment: {
      slots: {
        character_archetype:
          "开放世界角色：玩家自定义主角 + 5-8 名「路上结识」的同伴；每名同伴有独立故事线、忠诚度阈值、可被玩家行为劝退或转化",
      },
    },
    // C3：原 region_design（风格/势力/密度）与原 lore_generation（Lore 风格）合并
    lore_generation: {
      slots: {
        style_guide: `${OW_LORE_STYLE}\n\n## 区域设计风格\n\n${OW_REGION_STYLE}\n\n## 势力体系守则\n\n${OW_FACTION_RULES}`,
        constraints: OW_REGION_DENSITY,
      },
    },
    // C3：原 emergent_event（分类配比/触发平衡）吸收进通用 plot_generation
    plot_generation: {
      slots: {
        constraints: `${OW_EVENT_CATEGORY}\n\n${OW_EVENT_BALANCE}`,
      },
    },
  },
};

registerSkill(OPEN_WORLD_SKILL);
