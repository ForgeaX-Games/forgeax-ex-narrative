/**
 * fps-hero — 品类叙事包（英雄射击）
 *
 * 英雄射击 = 运营叙事型（角色 Lore 驱动）。以"守望先锋 / Valorant"为代表：
 * 没有强线性主线，叙事核心是"鲜明英雄群像 + 阵营对立 + 碎片化短篇释出"。
 * 英雄与世界观为长期资产，每个赛季/新英雄上线时以短片/漫画/语音逐步揭露 Lore。
 *
 * 采用运营叙事链（轻量，角色 Lore 驱动）：
 *   通用前驱(偏好→初步方案) + [世界观 → 角色 → 任务(短篇/赛季内容释出)]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 英雄射击世界观原型（"近未来阵营对立的舞台"）
- 近未来/科幻基调：科技、超能、机甲并存，为风格各异的英雄提供登场土壤
- 双方/多方阵营对立：以两大组织的理念冲突为骨（秩序 vs 自由 / 守护 vs 颠覆）
- 全球化舞台：地图分布于世界各地名城，每张地图自带一段地域文化与事件背景
- 世界观服务"英雄来源多样性"：不同国家/组织/种族输送性格迥异的可玩英雄
- 冲突可持续：阵营对立是长期张力，不追求终结，为持续运营留出叙事空间
`.trim();

const WORLDVIEW_STYLE = `
- 语调：明亮、酷炫、英雄主义；即便有阵营对立也保持希望与魅力，而非压抑末世
- 世界观以"舞台 + 阵营 + 英雄来源"三件套呈现，地图即可视化的世界切片
- 阵营对立须双方都有可被理解的理念，避免脸谱化的纯反派组织
- 留白服务长线：核心冲突不写死结局，给新英雄/新阵营的加入留下接口
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写死阵营战争的终局，对立须可持续以支撑长线运营
- 世界观须能容纳"持续涌入、风格各异的新英雄"，禁止封闭固定角色表
- 每张地图须带可独立阅读的地域背景，不依赖主线即可成立
- 双方阵营须各有正当理念与魅力，杜绝单一绝对恶的组织设定
`.trim();

const CHARACTER_ARCHETYPE = `
# 英雄射击角色原型（鲜明可玩的英雄群像）
- 英雄是绝对核心资产：每个英雄 = 强烈视觉符号 + 国籍/职业 + 阵营 + 一段背景故事
- 人设极致鲜明：用一个标志性性格、信念或反差让英雄一眼难忘、可被玩家"自我投射"
- 背景故事碎片化：每名英雄一段可独立阅读的小传，过往伤痛/信念成为 Lore 钩子
- 阵营归属与关系网：英雄间存在旧识/宿敌/师徒关系，构成可挖掘的群像张力
- 英雄台词即人格名片：选人语音、技能喊话、互动彩蛋承载性格与世界观线索
`.trim();

const CHARACTER_CONSTRAINTS = `
- 每名英雄须能脱离主线被单独理解，背景故事支持碎片化释出
- 人设须高辨识度且彼此区隔，禁止性格/定位雷同的英雄
- 英雄背景须留"未尽之谜"钩子，便于后续短片/漫画逐步揭露
- 阵营立场须服务于英雄魅力，而非把英雄降格为阵营宣传工具
`.trim();

const QUEST_GENERATION_STYLE = `
# 英雄射击叙事产出（短篇 Lore / 赛季内容释出）
- 以"非线性碎片"取代任务链：通过短片、漫画、语音彩蛋、地图细节逐步释出世界观
- 新英雄登场叙事：每位新英雄配一段"起源短篇"，揭示其加入阵营的理由与过往
- 赛季叙事释出：每赛季围绕一个事件/地点推出系列短篇，渐进推动阵营关系变化
- 英雄互动语音：设计英雄之间的对话彩蛋，用只言片语暗示关系与未公开 Lore
- 地图叙事：在地图场景中埋藏事件遗迹/海报/涂鸦，让世界观可被"逛"出来
`.trim();

const QUEST_GENERATION_CONSTRAINTS = `
- 叙事须以碎片化、可独立消费为原则，禁止强制线性长任务
- 新英雄起源短篇须与其人设/阵营自洽，不得与既有 Lore 冲突
- 赛季释出须推进而非颠覆世界观，长期资产（英雄/阵营）保持连续性
- 互动语音/地图彩蛋须信息精炼，点到为止，留给玩家拼图的乐趣
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："守望先锋式英雄射击 / 双阵营对立 / 碎片化 Lore"
- 世界观：近未来全球舞台，'守望者'(秩序守护) vs '黑爪'(颠覆变革)的持续对立
- 新英雄：流亡的机甲工程师'织星'，因故乡被毁加入守望者，起源短篇揭其执念
- 互动语音：与宿敌相遇时一句"你那双手，本可以创造，而非摧毁"
- 赛季释出：围绕'里约事件'推出三集漫画，逐步揭示黑爪渗透计划
`.trim();

export const FPS_HERO_SKILL: NarrativeSkill = {
  genreCode: "fps-hero",
  tier: "tier3",
  matchKeywords: ["英雄射击", "守望先锋", "valorant", "overwatch", "hero shooter", "团队射击"],
  // 运营叙事链（轻量，角色 Lore 驱动）：世界观 → 角色 → 任务(短篇释出)
  narrativeSteps: ["worldview", "character_enrichment", "quest_generation"],
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
        style_guide: "英雄射击角色塑造：英雄是高辨识度的核心资产，人设极致鲜明、背景碎片化可独立阅读，台词即人格名片，阵营关系网构成群像张力。",
        constraints: CHARACTER_CONSTRAINTS,
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

registerSkill(FPS_HERO_SKILL);
