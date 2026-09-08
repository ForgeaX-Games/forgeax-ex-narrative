/**
 * str-grand — 品类叙事包（大战略 / Grand Strategy）
 *
 * 大战略 = 涌现叙事型（"P 社味"历史沙盒）。叙事由「历史厚重 + 王朝继承 + 角色特质事件」
 * 在数百年的国祚长河中涌现：没有主角剧本，只有由人物特质、继承法、宗教与外交
 * 编织出的活历史（钢铁雄心 / 十字军之王 / 欧陆风云 一脉）。
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
# 大战略 世界观原型（"历史长河中的王朝棋局"）
- 世界 = 一张可被改写的历史地图：以真实或拟真的历史断面开局（封建欧陆/二战格局/列国并立）
- 厚重的历史质感：宗教、继承法、头衔法理、贸易节点、民族认同共同构成统治的约束网
- 王朝/政权为单位：玩家扮演的是一个延续数代的"血脉/国家"，而非单一人物
- 法理与正统：宣称、加冕、绝罚、王位继承危机是战争与政变的合法性来源
- 时代潮流：科技、思潮、宗教改革、革命浪潮，让同一片土地在世纪间换上新规则
`.trim();

const WORLDVIEW_STYLE = `
- 语调：史书编年体，冷静、厚重，带"后世史家回望"的克制感
- 开局须铺好"历史势能"：未决的继承危机、教派裂痕、边境宣称，皆是火种
- 让宗教/继承/法理成为可被博弈的叙事变量，而非装饰性背景
- 时间跨度以"代"为尺：强调血脉延续与王朝兴衰的长周期回响
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 严禁写成单代英雄传记；叙事主体是跨越数代的王朝/政权
- 历史要素须可被规则化（继承法/法理/宗教权威），并能驱动事件，而非纯设定
- 至少埋设 2 处"历史火药桶"（继承危机/教派冲突/边境宣称）作为长局发火点
- 不预设结局；世界须容纳征服扩张、王朝联姻、宗教统合等多条历史走向
`.trim();

const CHARACTER_ARCHETYPE = `
# 大战略 角色原型（人物特质 = 历史的偶然性）
- 君主/统治者：由一组"特质"定义（贪婪/睿智/暴虐/虔诚/病弱），特质直接改写治国与事件
- 王朝成员：继承人、配偶、私生子、摄政——血脉关系网是政变、内战、联姻的舞台
- 朝臣与封臣：各怀野心与忠诚度，派系倾轧随君主威望与恩荫此消彼长
- 历史名人：可被招揽或对抗的时代人物，其登场为长局注入"个体改变历史"的偶然
`.trim();

const CHARACTER_CONSTRAINTS = `
- 君主须由可读的"特质组合"定义，特质须真实影响事件触发与 AI 行为
- 王朝须有可追踪的血脉/继承链，让"继承危机"成为可预演的戏剧
- 封臣/朝臣须有独立野心与忠诚度，玩家威望波动应改写其立场
- 禁止把人物写成纯数值面板；每个特质都要有可叙事的行为投影
`.trim();

const EMERGENT_CATEGORY_RULES = `
# 大战略 涌现事件池（分类配比 · P 社味）
- 王朝/继承事件（约 28%）：继承危机、私生子风波、联姻邀约、家族诅咒——血脉长河的戏剧
- 角色特质事件（约 24%）：君主因贪婪/偏执/虔诚触发的私人抉择、密谋、信仰危机
- 宫廷/封臣事件（约 18%）：派系阴谋、封臣叛乱、摄政夺权、宫廷丑闻——内政张力
- 外交/战争事件（约 18%）：宣称战争、教廷绝罚、和约背弃、王朝战争——对外博弈
- 时代/宗教事件（约 12%）：宗教改革、瘟疫、十字军号召、思潮变革——时代级冲击
`.trim();

const EMERGENT_BALANCE_RULES = `
# 触发与平衡守则（P 社味）
- 事件须由"人物特质 + 王朝状态 + 历史背景"共同触发，让每个君主的故事独一无二
- 角色特质事件须呈现"性格即命运"：贪婪的君主更易卷入贿赂阴谋，虔诚者面临信仰两难
- 继承危机须可被提前预演（继承法/候选人特质），让玩家在数代前布局或受其反噬
- 抉择须改写王朝状态（法理/威望/血脉/封臣忠诚），后果跨代回响
- 高烈度事件（绝罚/内战/王朝灭亡）须有前兆与缓冲，但保留"一着错满盘崩"的历史残酷
`.trim();

const EMERGENT_STYLE = `
# 涌现事件文风（P 社味）
- 史册口吻：以编年史/宫廷密录的笔调记述，仿佛后世史家翻阅的一页
- 突出"个体特质改写历史"的偶然趣味：一位病弱继承人、一桩丑闻足以倾覆王朝
- 抉择文案呈现真实两难，不替玩家做道德判断，把代价摊在台面上
- 结果文案给"载入史册"的余韵：一句对王朝长河的冷峻注脚
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："中世纪王朝兴衰 / 大战略 / 继承危机"
- 历史火药桶：老王无嫡子，三位封臣各拥一名候选人，教廷态度暧昧
- 君主特质：现任摄政"野心+伪善"，借宗教之名行夺权之实
- 角色特质事件：虔诚的幼主在加冕前夜面临"接受教廷条件 vs 保全王权"的信仰两难
- 跨代回响：本代的联姻选择，将在两代后引爆一场争夺王位的王朝战争
`.trim();

export const STR_GRAND_SKILL: NarrativeSkill = {
  genreCode: "str-grand",
  tier: "tier2",
  matchKeywords: ["大战略", "grand strategy", "钢铁雄心", "十字军之王", "欧陆风云", "p社", "Paradox", "CK", "EU", "HOI"],
  narrativeSteps: ["worldview", "character_enrichment", "plot_generation"],
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
        style_guide: "大战略角色塑造：君主由特质定义、特质即命运；王朝血脉链是继承危机的舞台，封臣各怀野心随威望浮沉。",
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

registerSkill(STR_GRAND_SKILL);
