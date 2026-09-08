/**
 * adv-horror-vn — 品类叙事包（恐怖视觉小说 / Tier1 重叙事）
 *
 * 叙事占比 80-95%：玩法几乎全部是"读 + 选择 + 重来"。恐怖不靠操作压力，
 * 而靠封闭空间、轮回结构、人物崩坏与真相的层层揭开。bad end 不是失败而是
 * 美学的一部分——每一次"死法"都在补完真相拼图。
 *   代表作：寒蝉鸣泣之时 / 海猫鸣泣之时(when they cry) / 尸体派对(corpse party) / Saya之歌。
 *
 * 分支叙事链：通用前驱 + [世界观 → 角色 → 道具 → 大纲 → 情节 → 剧本]
 *
 * C2（2026-08）已封存：原分支树 / 对白脚本 / 电影化分镜三段专属 step 随 vn-v1
 * 一并搬进 `pipeline/_archive/vn-v1/`。业务内容原样保留，slot key 改挂到
 * 吸收后的通用大纲（outline_batch）/ 情节（plot_generation）/
 * 剧本（script_generation）席位上（下游 composer 仅消费 style_guide /
 * constraints / examples 三个槽位，原分镜专属的镜头语言与 QTE 守则并入
 * style_guide）。
 */
import type { NarrativeSkill } from "../../../skill-types.js";
import { registerSkill } from "../../../skill-loader.js";

const WORLDVIEW_ARCHETYPE = `
# 恐怖视觉小说世界观原型（看似日常的封闭牢笼）
- 舞台小而密闭：废弃校舍、被诅咒的村落、暴雨夜的孤宅、回不去的异空间，物理上"无路可逃"
- 日常表象在前、异常裂缝在后：先用平凡校园/小镇建立安全感，再让规则悄悄失效
- 轮回是世界的底层法则：时间会重置、记忆会残留，"似曾相识"是真相的提示而非错觉
- 世界藏着一条"成立的怪谈/民俗禁忌"：祭祀、传说、都市传闻，是恐怖事件的合法性来源
- 真相分层存在：表层惨案、中层阴谋、底层超自然/系统性诅咒，越深越冷
`.trim();

const WORLDVIEW_STYLE = `
- 语调：先暖后寒，用明媚日常的反差放大坠落感；恐怖靠"不对劲"的累积而非一惊一乍
- 空间即牢笼：反复强调"出不去"，让封闭感成为持续压力源
- 把轮回写进世界规则：明确"重置点/触发条件/残留物"，让多周目有可解读的逻辑
- 怪谈考据感：给禁忌一套自洽的民俗/规则体系（寒蝉的"鬼隐"、尸体派对的"天神小学"）
`.trim();

const WORLDVIEW_CONSTRAINTS = `
- 必须是封闭/半封闭舞台，严禁开放世界式自由探索稀释压迫感
- 轮回规则要前后自洽：重置的触发、保留的记忆、可变的变量必须有明文设定
- 真相分层须可被分支逐步解锁，杜绝一次性全盘托出
- 超自然元素要"晚出场、留余味"，前期靠氛围与心理而非直给怪物
`.trim();

const CHARACTER_ARCHETYPE = `
# 恐怖视觉小说角色原型（会崩坏的"普通人"）
- 主角是带入口：普通学生/访客，理性自持，将在轮回中被逼到精神临界
- 同伴群像即"待崩坏素材"：每人有一层温和表象 + 一道隐藏裂痕（猜忌、罪疚、占有欲）
- 崩坏弧线是核心资产：信任→怀疑→失控→施害/自毁，崩坏过程要有可追溯的导火索
- 真相承载者：知情的老人/教师/亡魂，半遮半掩地递出线索，本身也可能是加害者
- 受害者/亡灵：以怨念驱动世界规则，其生前故事是底层真相的钥匙
`.trim();

const CHARACTER_STYLE = `
恐怖VN角色塑造：先把"可爱/可靠/正常"立得越扎实，崩坏时的反差才越锋利。
崩坏要"有理由"——每一次黑化都能在前文找到伏笔；让玩家既恐惧又心疼。
`.trim();

const CHARACTER_CONSTRAINTS = `
- 崩坏必须有铺垫与导火索，杜绝毫无前兆的"突然发疯"
- 每名关键角色至少预留一道隐藏裂痕，供不同分支引爆
- 亡灵/受害者的怨念要能解释世界规则，不能只是吓人道具
- 角色在不同周目可呈现立场反差，但同一周目内行为须自洽
`.trim();

const ITEM_DATABASE_STYLE = `
# 恐怖VN物品守则（线索即真相碎片）
- 文档类道具是主力：日记残页、病历、旧报纸、录音带，逐条拼出底层真相
- 禁忌器物驱动规则：护符、祭具、被诅咒的物件，触碰即改变轮回走向
- 日常物的恐怖化：校服、课桌、玩偶——熟悉之物因语境而变得不祥
- 道具描述用"侧写+留白"：交代来历的一角，留下令人脊背发凉的空缺
- 关键解谜/解咒物作为周目推进的临界点，获取常伴代价
`.trim();

const ITEM_DATABASE_CONSTRAINTS = `
- 文档碎片须可分散获取、拼合见真相，单件留悬念
- 禁忌器物的效果要与轮回规则挂钩，不能是无关增益
- 道具文案保持冷峻克制，杜绝说明书式直白图解
- 关键物的获取代价须与剧情代价呼应（受伤、失忆、招致怨念）
`.trim();

const BRANCH_TREE_STYLE = `
# 恐怖VN分支树设计守则（多周目 × 多结局）
- 总体结构：共通线（建立日常与裂缝）→ 分歧章（信任/选择触发）→ 多结局收束
- 结局矩阵显式声明：BAD END（多且各异，是揭真相主力）/ NORMAL END / TRUE END（解开底层诅咒）
- 轮回机制入树：某些 BAD END 反而解锁下一周目的关键 flag（"死亡换情报"）
- 分支触发三类：显式选项 / 信任值与怀疑值积累 / 隐藏触发（持有特定碎片、特定周目）
- TRUE END 必须满足"集齐真相碎片 + 关键信任阈值"的复合条件，避免一键好结局
`.trim();

const BRANCH_TREE_CONSTRAINTS = `
- 必须给出每个结局的明确判定条件（flag/数值/前置周目）
- BAD END 要"有意义"：每个坏结局补完一块真相或人物侧写，杜绝纯惩罚式死亡
- 周目间的 flag 继承规则要写清，保证轮回逻辑可被玩家逆推
- TRUE END 不可被单一选项直达，须复合条件收束
`.trim();

const DIALOGUE_SCRIPT_STYLE = `
# 恐怖VN对白脚本风格
- 大量内心独白与潜台词：表面寒暄之下藏着猜忌、隐瞒与不安
- 用"沉默拍/留白（……）"制造窒息感，关键恐怖时刻让文字也喘不过气
- 崩坏角色的语言要可见变化：用词破碎、重复、人称错乱，标记精神滑坡
- 拟声与环境音入文（滴水、脚步、童谣），让听觉恐怖落到字面
`.trim();

const DIALOGUE_PACING = `
- 节奏曲线：日常闲聊（松）→ 异常征兆（紧）→ 短暂安心（伪松）→ 崩坏爆发（极紧）
- 恐怖高潮处用短句、断句、单字成行，加速心跳；安全屋场景放缓回血
- 关键选项前给一个"沉默拍"，让玩家在静默中感到压力
- 多人在场时用插话/抢白制造混乱，独处时用大段独白放大孤立
`.trim();

const DIALOGUE_SCRIPT_CONSTRAINTS = `
- 关键选项需注明语气与可能后果，便于 UI 给压力提示
- 崩坏角色的语言变化要渐进可追溯，杜绝从正常到疯癫的硬切
- 恐怖渲染靠潜台词与留白，禁止靠脏话/血腥词堆砌廉价惊吓
- 同一角色的语癖跨周目保持一致，便于玩家识别"是否同一个他"
`.trim();

const CINEMATIC_STORYBOARD_STYLE = `
# 恐怖VN电影化分镜风格
- 静默压迫优先：用长时间定格、缓慢推镜累积不安，而非快切惊吓
- 立绘/CG 的"差分"是利器：同一画面的细微变化（表情、背景多出的影子）制造毛骨悚然
- 善用画外与遮挡：恐怖之物留在画框外或暗处，靠声音与角色反应侧写
- 关键揭真相场用一张冲击 CG 锚定记忆点，平时克制以蓄力
`.trim();

const SHOT_LANGUAGE = `
- 景别：日常用中景维持安全距离；窥视/逼近时切第一人称近景制造代入恐惧
- 运镜：以静制动，缓推/缓摇为主；崩坏爆发瞬间才允许急切与抖动
- 光影：低照度、单一光源、长影；用明暗交界藏住"不该在那里的东西"
- 留白构图：大面积负空间 + 角落异常，引导玩家自己"发现"恐怖
`.trim();

const QTE_RULES = `
- 本品类弱即时操作：QTE 仅在逃脱/挣扎等少数高压时刻点缀，且失败常导向有意义的 BAD END
- QTE 失败不应是纯惩罚：让它成为某条真相线的入口（死法即线索）
- 限时选择可制造心跳压力，但核心仍是叙事抉择而非反应速度
- 慎用，密度极低；过多动作打断会破坏文本恐怖的沉浸节奏
`.trim();

const CINEMATIC_STORYBOARD_CONSTRAINTS = `
- 恐怖呈现以氛围与留白为主，jump scare 极度克制且不滥用
- 差分/CG 的恐怖点要与剧情真相挂钩，杜绝为吓而吓
- QTE 必须低密度且失败有叙事价值，禁止用动作难度替代恐怖
- 关键 CG 数量受控，留给真相揭示与结局的高光时刻
`.trim();

const FEW_SHOT_EXAMPLES = `
# 输入 → 输出 风味示例
## 输入主题："暴雨夜被困的废弃校舍 / 恐怖VN / 轮回真相"
- 日常表象：六名学生为校园祭通宵布置，雨夜停电，玩起一个"招魂"小游戏
- 异常裂缝：游戏后大门怎么也打不开，墙上的旧合影里多出一个没人认识的女孩
- 轮回提示：主角"梦见"自己已死过一次，醒来发现日记里有自己没写过的字迹
- 崩坏：最可靠的班长在第三轮回里率先怀疑同伴，信任值跌破阈值后亲手锁死出口
- BAD END（其一）：主角独自逃向天台 → 死法揭示"那个多出的女孩"正是上一轮回的自己
- TRUE END：集齐三页病历 + 维持与亡灵的信任，归还祭具解开"鬼隐"诅咒，众人天明脱困
`.trim();

export const ADV_HORROR_VN_SKILL: NarrativeSkill = {
  genreCode: "adv-horror-vn",
  tier: "tier1",
  matchKeywords: ["恐怖视觉小说", "寒蝉鸣泣", "尸体派对", "saya之歌", "when they cry", "corpse party"],
  narrativeSteps: [
    "worldview",
    "character_enrichment",
    "item_database",
    "story_framework",
    "outline_batch",
    "plot_generation",
    "script_generation",
  ],
  stepSkills: {
    worldview: {
      slots: {
        worldview_archetype: WORLDVIEW_ARCHETYPE,
        style_guide: WORLDVIEW_STYLE,
        examples: FEW_SHOT_EXAMPLES,
        constraints: WORLDVIEW_CONSTRAINTS,
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
    outline_batch: {
      slots: {
        style_guide: BRANCH_TREE_STYLE,
        constraints: BRANCH_TREE_CONSTRAINTS,
      },
    },
    plot_generation: {
      slots: {
        style_guide: `${DIALOGUE_SCRIPT_STYLE}\n\n${DIALOGUE_PACING}`,
        constraints: DIALOGUE_SCRIPT_CONSTRAINTS,
      },
    },
    script_generation: {
      slots: {
        style_guide: `${CINEMATIC_STORYBOARD_STYLE}\n\n${SHOT_LANGUAGE}\n\n${QTE_RULES}`,
        constraints: CINEMATIC_STORYBOARD_CONSTRAINTS,
      },
    },
  },
};

registerSkill(ADV_HORROR_VN_SKILL);
