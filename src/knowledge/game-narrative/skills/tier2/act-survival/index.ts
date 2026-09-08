/**
 * act-survival — 品类叙事包（生存动作）
 *
 * 碎片叙事型：没有完整 L0-L5 主线，叙事由"资源压力下的处境 + 前人遗留 +
 * 营地建造痕迹"承载。核心不是讲故事，而是让玩家在匮乏中亲历人性的取舍
 * （方舟 / 森林 / 绿色地狱 / 漫漫长夜）。
 *
 * 碎片链：通用前驱(偏好→初步方案) + [世界观 → 角色 → 道具 → 场景]
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 生存动作世界观原型（"敌意环境中的孤立处境"）
- 孤立母题：坠机/海难/末世，主角被抛入一个文明缺席、资源稀缺的敌意环境
- 环境即对手：昼夜、饥渴、寒暑、天气与生态链构成持续的生存压力系统
- 前文明的废墟：环境中散落着先到者/原住文明的遗留，暗示"你不是第一个"
- 生态自洽：动植物、地形、气候须形成可被理解和利用的规则，而非随机刁难
- 真相藏于探索深处：这片土地为何如此？常有一个可被逐步揭开的隐秘根源
`.trim();

const WORLDVIEW_STYLE = `
- 语调：冷峻、真实、带"求生本能"的紧绷感；美丽与致命并存的自然
- 世界观以"生存压力系统 + 可利用规则"为核心铺设，让威胁可预期、可应对
- 用前人遗留埋设碎片真相：营地废墟、求救信号、未寄出的信件
- 为开放探索与建造留接口：资源分布与地形须支撑玩家自主规划据点
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁纯随机的"为难玩家"机制；生存威胁须有可被学习的规则
- 真相碎片须可在自由探索中被发现，不依赖线性剧情推进
- 前文明遗留须与当前生态自洽，杜绝突兀的设定堆砌
- 环境之美与致命须并置呈现，避免一味的压抑或一味的风光
`.trim();

const CHARACTER_ARCHETYPE = `
# 生存动作角色原型（被剥离文明的人）
- 主角：从现代/文明状态被抛入绝境，性格在匮乏中被逐步暴露与重塑
- 前到者群像：以日志、尸体、营地遗迹"缺席登场"的先行者，是人性试验的预演
- 同伴/NPC（若有）：信任成本极高，合作与背叛都带资源代价的真实重量
- 环境中的"生灵"：野兽/原住者既是威胁也是生态的一部分，可读出其行为逻辑
- 内在对手：主角自身的恐惧、道德底线与求生欲之间的拉锯才是核心戏剧
`.trim();

const CHARACTER_CONSTRAINTS = `
- 角色塑造须落在"资源压力下的选择"上，而非台词式的性格宣告
- 前到者遗留须构成"人性预演"：他们如何撑住或崩溃，预示主角的可能结局
- 同伴关系须带资源博弈成本，杜绝无代价的便利合作
- 严禁把生存写成纯打猎流程；每次取舍都应触及道德或情感层面
`.trim();

const ITEM_DATABASE_STYLE = `
# 生存物资/遗物守则（道具描述即处境碎片）
- 工具与物资文案体现"用途与代价"：得来不易、损耗真实、取舍有重量
- 拾得物（旧背包、求救电台、私人物品）附微叙事，是前到者命运的物证
- 食物/药品/材料的描述传达匮乏感：每一份消耗品都关乎"撑过今晚"
- 手作装备的进化线讲"从赤手到立足"的处境跃迁，是无声的成长叙事
- 关键剧情物品（坠机黑匣、研究样本）作为真相拼图，散落在高风险区域
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 严禁纯数值堆砌的物资表；每件值得记忆的拾得物都带处境或人物碎片
- 物资文案须传达匮乏与代价，杜绝"应有尽有"的丰裕错觉
- 前到者遗物须与世界观的人性预演自洽，互相印证
- 关键真相物品须置于与风险匹配的位置，杜绝唾手可得
`.trim();

const SCENE_GENERATION_STYLE = `
# 生存环境叙事守则（用营地与残迹讲故事）
- 用废弃营地讲故事：搭了一半的庇护所、熄灭的篝火、堆叠的求救石堆
- 环境时间感：腐坏程度、植物覆盖、动物啃食痕迹暗示"这里发生过什么、多久了"
- 危险地标的双重性：既是资源富集地也是死亡高发区，环境自带风险叙事
- 昼夜与天气的叙事化：暴风雪/长夜不只是机制，更是处境的情绪放大器
- 玩家自建据点也参与叙事：建造痕迹记录其求生策略与挣扎史
`.trim();

const SCENE_GENERATION_CONSTRAINTS = `
- 场景须承载处境叙事，禁止只做资源刷新的功能性地块
- 每个关键区域至少布置 2-3 处前人遗迹/死亡现场，与人性预演呼应
- 环境的时间与腐坏线索须自洽，杜绝矛盾的时序暗示
- 天气/昼夜须同时具备机制与情绪双职能，不沦为纯数值惩罚
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："坠机荒岛 / 生存动作 / 人性试炼"
- 生存压力：热带雨季的失温、淡水稀缺、夜间掠食者构成三重压力系统
- 前到者碎片：一处搭了一半的吊脚楼 + 一本字迹由工整渐疯的求生日记
- 关键拼图：坠机黑匣藏于鳄鱼出没的红树林深处，揭示这并非意外
- 人性预演：日记主人最终为独占淡水而放逐同伴，预示主角将面临的同款抉择
`.trim();

export const ACT_SURVIVAL_SKILL: NarrativeSkill = {
  genreCode: "act-survival",
  tier: "tier2",
  matchKeywords: ["生存动作", "生存", "方舟", "ARK", "森林", "The Forest", "绿色地狱", "Green Hell", "漫漫长夜", "求生", "建造生存"],
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
        style_guide: "生存动作角色塑造：人性在资源匮乏中被暴露，前到者遗留是人性预演，合作与背叛皆有真实代价。",
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

registerSkill(ACT_SURVIVAL_SKILL);
