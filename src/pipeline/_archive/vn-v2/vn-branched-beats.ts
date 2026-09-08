/**
 * G-01：剧情树改造（情节点级分支 + 多结局）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/07_剧情树改造.md 对齐。
 *
 * 输入：ctx.vn_outline_acts + ctx.vn_beats（拓扑序黄金线，每 beat 带三维 staging）
 * 输出：ctx.vn_branched_beats = {
 *   acts, scenes（确定性导出）, beats（含 prev/next，最终 `场.序` id）, endings, branch_summary
 * }
 *
 * 场/情节点解耦（§4.6c）：本步产出**纯情节点 DAG**、beat_id 用**拓扑序稳定 id**（b1/b7…）；
 * 全部分支/结局定稿并过质量门后，末尾跑**确定性场号导出**——按 DFS 序 + 三维相邻变化编场号，
 * 重写全部 id 与边引用为 `场.序`、并派生 ctx.vn_branched_beats.scenes（供下游 G-02/G-03 与前端）。
 *
 * 核心约束：
 *   - 决策点密度建议：每 3-5 个情节点出现 1 个 pivot（决策 QTE 或选项），全剧不少于 3 个 pivot
 *   - 决策点密度仅计 pivot_kind ∈ {choice, branch_qte}；演出型 QTE 已全局停用（剧情完全靠决策推进）
 *   - 选项数：每个 pivot 2-4 选项，UI 标签 A/B/C/D
 *   - 结局：H/B/O 三大类，至少 3 个，至少覆盖 2 类
 *   - 每 beat 携带三维 staging（location_name/time_of_day/indoor_outdoor）——场号由系统确定性导出，LLM 不编场号
 */
import type {
  NarrativeContext,
  VnBranchedBeats,
  VnBranchedBeat,
  VnScene,
} from "../../../types/index.js";
import type { LLMClient } from "../../runtime/llm-client.js";
import { extractJSON } from "../../runtime/llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "../../steps/design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../../runtime/prompt-composer.js";
import {
  FIVE_ELEMENT_NOTE,
  ORIGINALITY_NOTE,
  STAGING_NOTE,
  TOPO_BEAT_ID_NOTE,
  getStreamEmit,
  getVnBudget,
  deriveBeatTitleFromContent,
} from "./_shared.js";
import { runGraphQA, type GraphAdapter, type QaGraph } from "../../../utils/graph-qa.js";

export const VN_BRANCHED_BEATS_COMPOSER: PromptComposer = {
  stepId: "vn_branched_beats",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "strategy", "ip_dna", "output_format"],
  userBlockOrder: [],
  blocks: {
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    role: `你是互动影游剧情树架构师。传入的线性 beats 是一条「黄金线（理想线）」——角色对世界每一次考验都做出"理想作答"时走过的那唯一一条路，它只是整棵树里 N 条路径中的 1 条、是脊不是全部故事。你的产出是整部影游的"分支骨架"——**薄结构、不写满正文**（详细剧本由下游 G-02 打磨）。你要**以黄金线为脊、一次性**长出一棵**全局自洽**的剧情树：大量戏剧张力存在于黄金线**之外**（答错/答偏的下坠、挣扎、中段结局），分支轨迹是树的**主体**，黄金线反而是少数。`,

    task: (ctx) => `## 设计哲学（务必内化）
影游 = 一台"世界状态模拟器"：世界向角色（角色＝玩家的化身）抛出考验（pivot 的选择 / QTE），玩家凭角色的认知与过往经历"作答"。**答案没有简单对错，只有代价量级**——凡有选择，必有代价。每次作答都推进玩家对"体验命题"的体验，难度随剧情层层递进。你是编剧，要在落子时心里有杆秤，掂量每个分支是否合理。

## 体验命题锚定（一切的北极星）
- 把传入的 logline 当"体验命题"内化：玩家将被反复追问的核心问题 + 想给玩家的情感目标。
- 每个 pivot = 体验命题在当下情境的一次**具体提问**；每个选项 = 对该问题的不同回答，**考验角色不同的性格面 / 价值取向**（不靠"好/坏"二分，靠"取向不同"）。
- 弧光递进：结局是体验命题的不同回答。每个 beat / pivot 落笔前自问"它推进了玩家对命题的体验吗"，不推进的就是废戏。

## 角色状态一致性铁律（"不吃书"）
- **角色状态 = 外貌 + 修为/实力 + 心理 + 人际关系**。一旦某个 beat 的 content 描写了状态变化（如"返老还童""修为突破""关系决裂"），**后续所有 beat 必须尊重这个新状态**——绝不能后面又出现旧状态的描写（如已返老还童后仍被称"老伯"、已决裂后仍像知己般交心）。
- **状态变化需铺垫**：任何重大状态变化（突破、外貌剧变、关系质变）都必须在变化 beat 之前至少有 1 个 beat 埋下伏笔/征兆/条件。不允许"凭空变化"。
- **实力成长严格递进**：角色的实力变化必须符合**小步递进**（如 凡人→筑基→金丹 不跳级；获得的能力必须是当前阶段合理的下一步）。user_input 里指定的"主角获得的实力水平"是**上限**，不是起步——故事中间不要超出。

## 冲突合理性铁律（"凡事有代价 + 读者预期管理"）
- **敌人匹配**：每个阶段遇到的对手/危机的威胁等级**必须与主角当前实力相匹配或略高 1 级**。绝不要在新手期就遇到终极BOSS 级别的对手——那只会让玩家觉得"强行卖惨"或"情节失控"。
- **冲突制造不走"装死/离线/突然消失"捷径**：当你需要制造冲突时，**用主角的行为自然导出后果**——而不是让系统/道具/NPC "突然故障/离线/失踪"来强行卸力。好的冲突来自"角色做了某事 → 自然有某后果"的因果链。
- **读者预期管理**：作者视角（我想写什么？）之外必须切换到读者视角（读者看到这里会有什么期待？我接下来是满足、悬置还是颠覆这个期待？）。突如其来的事件 = 颠覆预期 → 必须有**前置暗示**让读者事后能"啊原来之前那个细节就是伏笔"。如果连前置暗示都没有，那就是情节事故。

## 黄金线定位（破除"主线+贴片"的关键认知——务必先建立这个心智）
- 传入的线性 beats = **黄金线**：角色"全答对/答得最理想"时的那条轨迹。它是 **N 条路径里的 1 条**，是脊不是全部。
- 这些黄金 beat 的 beat_id 与 content **原样保留、前向次序不变**（这是编号稳定的保证），但它在最终树里应是**少数派骨架**——答错/答偏的后果链、挣扎回归链、通向中段结局的下坠链，这些**分支轨迹才是树的主体**（数量应明显多于黄金线）。
- ❌ 错误心智："黄金线是完整故事，我只要在上面挂几个会汇回来的装饰分支 + 结尾摆几个结局" —— 这正是产出"简单多结局改造 + 强行聚合分支"的根因。
- ✅ 正确心智："黄金线是满分答卷，我要补齐的是——答错会发生什么？答偏要付什么代价？半路放弃 / 走岔了会落到哪个**中段结局**？哪些错能挣扎着爬回正轨、哪些一去不回？"

## 结构范式（递归）
普通节点 →…→ pivot（抛问题 + 选项）→…各选项的后果链…→【汇流 / 继续分支 / 走向结局】→…→ 结局。只要有分支即可递归嵌套。

## 分支分级（每个 pivot 必须定 branch_type；分级 = "后果链长度 × 是否汇聚"，**由节点的 next/prev 边直接体现**）
一部影游里**低 / 中 / 高三种分支程度都要出现**，靠节点特性（树中位置 + 上下游边的有无与多少）天然区分——边数与链长就是分级本身：
- **低程度 · converge（短链汇聚）**：pivot 各选项各走 **0–1 个代价 beat** 即汇回同一汇流点。
  · 节点特征：后果 beat 出度恰 1，直指同一汇流点；**汇流点 prev_nodes ≥2**（各短链末端都指向它）。
  · 汇流边一律用 **kind="linear"**（汇回不是环，别管汇流点场号大小，见拓扑硬约束 5）；merge_back 只留给真正的剧情闪回回环。
  · 语义：一般失误可改正；汇流点正文写"殊途同归 + 代价余味"，严禁"若之前选了 A…"式条件叙述。
- **中程度 · converge（长链汇聚）**：pivot 各选项各走 **2–3 个 beat**（把代价 / 绕路 / 挫折演足）再汇回。
  · 节点特征：各后果链是 2–3 个"出度=1"的 beat 串联，末端汇入同一 **prev_nodes ≥2** 的汇流点；**各链长度差 ≤1**（选项对等）。
  · 汇流边同样用 kind="linear"（汇回非环）。
- **高程度（不汇聚，两种形态）**：
  · **diverge（长链分岔）**：各选项各自走 ≥2 个 beat 的**专属长链、永不汇流**，分别通向**不同结局**（各链末端 next.to = 不同 ending_id）。节点特征：这些 beat 没有任何 prev_nodes ≥2 的共同汇流点。
  · **terminal（即死 / 直达结局）**：某选项直接 next.to = ending_id（致命错 → local bad；决定性对 → 提前圆满）。**该选项的前置 beat 必须给足预警**（玩家能预见风险），杜绝无预兆即死。

## 那根秤（定 branch_type 与赌注时逐条自评）
1. 错误性质——无知可原谅（给 converge 改正机会）、鲁莽要付代价（converge / diverge）、不可避免或幼稚致命才 terminal；
2. 玩家是否被给了足够预警——无预警即死 = 禁止；
3. 代价是否让玩家更深体会体验命题——代价要"有意义"，不是单纯惩罚；
4. 这个分支推进了玩家对体验命题的体验吗——没推进就是废分支。

## 分支类型的强制配比（合法树必须同时具备下列各类，缺类即不合格——这是破除"全是聚合分支 + 结尾强行多结局"的硬指标）
落子前先盘点：这棵树是不是又退化成"主线 + 几条都会汇回来的短分支"了？必须刻意制造下列**异质**结构：
- **下坠不归（diverge / terminal）≥2 处**：答错/答偏后走一条**专属链、永不汇回黄金线**，通向它**自己的结局**（中段 local 或剧终 global）。
  · 其中**至少 1 处出现在幕一或幕二**：角色早期阅历浅、易误判，一个幼稚的错就该有不归后果（terminal 即死 / diverge 岔上不归路）——**务必在前置 beat 给足强预警**，杜绝无预兆即死。
  · 节点特征：这条链上的 beat 没有任何"prev_nodes≥2 的共同汇流点"，末端 next.to = ending_id。
- **挣扎回归（recovery converge，跨多格）≥1 处**：答错后**不是立刻并回下一格**，而是走 2-3 个**代价 / 绕路 / 挫折 beat**（把"差点回不来"演足），再汇回黄金线——付出的代价就是它的意义。
  · ⚠ 这些代价 beat 多半在新场（场号更大），汇回的主线 beat 场号更小——**这完全正常、直接连 kind="linear" 即可**（见拓扑硬约束 5：只要不成环就是合法前向边，后端会保留）。**绝不要因为"汇回点场号更小"就把末端 next 留空 → 那会变成死胡同。**
- **短链汇聚（low converge）**：一般小失误，各选项 0-1 个代价 beat 即汇回（汇流点 prev_nodes≥2）。可多处，但**绝不能是唯一形态**。

## 分支程度沿剧情的分布（难度曲线不是简单"早轻后重"）
- 三类要**散布全剧**，不要挤在某一幕。**高程度 diverge/terminal 应该靠前**（早期幼稚致命，强预警）。
- 越往后角色成长越大、误入歧途概率下降：中后段以"代价沉重但仍可挽回"的挣扎回归 + 末幕命题总回答（diverge → 多 global 结局）为主。

## 多结局（每个结局都要有"铺垫 + 因果逻辑"，反对结尾强行 fan-out）
- 全剧 ≥3 个结局、≥2 类（H/B/O）；其中 **global 结局 ≥2 个**。
- **结局跨幕分布铁律（破除"全堆在最后"）**：结局**必须散布到不同幕**。
  · **至少 1 个 local 结局在幕一或幕二就终结**——由该幕里一条下坠链（diverge/terminal）导向，有完整铺垫；它是中段结局，玩家在故事中途就可能"提前 game over / 提前圆满"。
  · 剧终幕的多个 global 结局，**各自的前驱链必须不同**（从中前期**不同的** diverge 抉择各自长出来），**严禁所有结局从最后一个 beat 一次性 fan-out**（按一个键看到 N 选 1 的结局菜单＝设计事故）。
  · 自检：把每个 ending 的触发抉择标在剧情树上，它们的「场.序」不应全部挤在末段——应有明显早/中/晚的分布。
## 铺垫铁律（凡事有代价——这是一切戏剧说服力的根基）
- **铺垫铁律**：每个结局都不能"凭空降临"。它必须满足下面两条，缺一即非法：
  1) **有铺垫（伏笔）**——通向它的那个抉择，其分量/方向在更早的 beat 里已埋过线索（一句台词、一次小失误、一个未还的人情）。玩家回看应能找到"原来从那里就开始了"的因果起点。
  2) **有因果逻辑**——从分岔抉择到结局的每一步都由"上一步的代价/收获"推动，环环相扣；不允许"突然死亡 / 突然圆满"这类逻辑跳跃。
- **关系铺垫铁律（重中之重）**：两个角色之间的任何深层情感表达（告白、生死相随、决裂），必须**有 ≥2 个前置 beat 做渐进铺垫**（暗生情愫→小事件加深→明确表态）。一步到位 = 体验事故。情感如此、师徒关系如此、仇恨积累也如此。"进展太快"比"进展太慢"严重一万倍——慢可以事后加速，快无法事后找补。
- **每个结局必须由一条前驱链导向**：链上的 pivot 制造冲突、向玩家"出题"，玩家的连续作答**累积**导向这个结局——而不是在最后一个节点一次性 fan-out 出 N 个结局。
- **前驱厚度下限**：
  · 局部结局（scope="local"，中段 game over / 提前圆满，可出现在任意幕）：前驱至少 = 触发它的 terminal pivot + 1 个预警 beat（共 ≥2 个铺垫 beat）。
  · 全局结局（scope="global"，剧终大结局）：前驱链应能回溯到**中前期某个 diverge 抉择**（早分岔、晚收束到不同 global 结局），途中至少 ≥2 个 beat 把这条路"走实"，让结局差异早有伏笔、而非临门一脚。
- **结局自检**（输出前对每个 ending 逐一回答）：①它由哪个抉择决定？②那个抉择在更早哪个 beat 埋过线索？③从抉择到结局每一步是否都被上一步推动？三问任一答不上来，就补铺垫 beat 或删掉这个结局。

## 时空坐标与状态变更声明（每个 beat 必须回答"何时何地，我改变了什么"）
每个 beat 必须输出 spacetime 和 state_deltas：
- spacetime.time：使用故事世界纪年（如"天元历1042年·秋·申时"），默认一天24小时、一年365天
- spacetime.location：精确到场景级（如"青云宗·外门杂役房"）
- 每条 state_delta 的结构：{ "dimension": "...", "subject": "...", "attribute": "...", "from": "(变更前，首次出现可省)", "to": "(变更后，必填)" }
- **subject 必须使用人物小传 / 关键道具中的原名**（逐字一致），不要用代称/别名，否则状态会记到错误对象上
- **attribute 只能取下列白名单值**（自创字段会被丢弃）：
  · dimension="character"（subject=角色原名）→ attribute ∈ { physical.body（外貌/体态/年龄）, physical.attire（着装）, psychology.personality（性格）, psychology.persona_base（核心人设）, psychology.current_mood（当前情绪）, power_level（实力/修为）, relationships（人物关系） }
    其中 relationships 的 to 必须写成 JSON 字符串：to="{\\"target\\":\\"对方原名\\",\\"nature\\":\\"关系性质\\"}"（如 to="{\\"target\\":\\"林婉\\",\\"nature\\":\\"由师徒转为敌对\\"}"）
  · dimension="item"（subject=道具原名）→ attribute ∈ { location（位置/持有者）, acquired（是否已获取，to 取 "是"/"否"）, condition（状况描述）, durability（耐久，to ∈ {permanent, multi_use, single_use, consumed}） }
  · dimension="time" — 时间跳跃（如"三天后""半年后"），to 写新的时间点
  · dimension="location" — 场景转移（已由 spacetime 隐含，通常不需要额外声明）
  · dimension="world"（subject=势力/地域名）— 世界格局变化（势力消长/事件发生），to 写新格局描述
  · dimension="plot"（subject="主线"或支线名）— 剧情认知推进（玩家获知新真相/解锁新信息），to 写新进度描述
- 无变化的纯过渡 beat → state_deltas 给空数组 []（不要省略该字段）
- 状态变更必须与 content 描写一致：content 写了"返老还童"就必须有对应的 character/physical.body 变更；反之 state_deltas 声明了变化，content 中也必须提及

## 节点预算（软目标：结构服从复杂度档位「${getVnBudget(ctx).label}」，不是越多越好）
- 全树 beat 总数**软上限** **${getVnBudget(ctx).treeBeats}**（黄金线 + 分支后果 + 挣扎回归 + 下坠链 + 局部结局都算）。**黄金线只是脊、应是少数派；分支轨迹 + 结局才是主体（占名额一半以上）**。逼近上限时，优先**压缩装饰性 low converge 短分支**，保黄金线弧光完整 + 关键 diverge/terminal 抉择 + 跨幕结局分布。
- ⚠ **这是软目标，不是硬截断**：当为了"剧情树完整且合法"（补足支撑某结局的前驱链、给孤儿/死胡同补边、让分支真正闭合到汇流点或结局）确有必要时，**允许适当超出软上限**——完整、自洽、符合本提示词的拓扑与铺垫要求**优先于**卡死数字。但严禁为凑数无意义膨胀（重复戏、空过场、假分支）。
- 决策点密度：每 3-5 个主线 beat 一个 pivot，全剧 ≥3 个 pivot（仅计 pivot_kind ∈ {choice, branch_qte}）。
- 全程**只有"决策型 QTE"（branch_qte / choice）**：每个 pivot 都影响剧情走向。**演出型 QTE 已停用**，不要规划任何"不影响剧情的演出/蓄力/触点"互动——剧情完全靠决策推进。

## 内容复用（黄金线薄骨架，省篇幅）
- 黄金线（输入 vn_beats）的每个 beat：**beat_id、title 与 content 原样保留**，只允许改它的 next_nodes（在其上原地插 pivot）——这是编号稳定的保证。
- 新增 beat（分支后果 / 挣扎回归 / 下坠链 / 局部结局型推进）：content 写 50-100 字简述即可（详细正文是 G-02 的事）；同样必须给一个 **title**（4-14 字短标题，凝练戏核、区别于正文、各具辨识度）。**这些新增 beat 是树的主体，数量应明显多于黄金线 beat**——若产出里新增 beat 远少于黄金线，说明又退化成"主线+贴片"了，重做。

## pivot 内容三段式（content 字段写法）
pivot beat 的 content 按三段写：① **现状**（把当下处境 / 困境讲清，玩家凭这段就该明白此刻处境）；② **抛问题**（独立一句，世界 / 处境向角色的考验，推荐第二人称"你会…？"）；③ 选项本身走 next_nodes[].label + condition，**content 里绝不剧透选择后果**。

## 节点角色 × 前驱/后继基数（落子前按角色自检：来路有无、去向有无与数量）
| 角色 | prev_nodes（来路） | next_nodes（去向） | 说明 |
|---|---|---|---|
| 开场 beat（全树唯一） | 0 | ≥1 | 叙事序最小的那一个，是唯一入口 |
| 普通推进 beat | ≥1 | 恰 1（linear） | 单进单出 |
| pivot·choice | ≥1 | 2–4（label A/B/C/D） | 抛问题，分叉 |
| pivot·branch_qte | ≥1 | 恰 2（成功/失败） | 二选一 |
| 汇流 beat | ≥2 | ≥1 | 多条后果链殊途同归 |
| 结局 ending | ≥1 | 0 | 终止 |
- **来路铁律**：除唯一开场 beat 外，每个 beat 必须至少被一个 beat 的 next_nodes 指向（必有 prev）。新增的"选项后果 beat"，其来路就是那个 pivot；汇流 beat 的来路是各后果链末端。绝不允许凭空冒出一个没人指向的 beat（这正是"一堆节点挤在最前列"的根因）。
- **去向铁律**：除结局外每个 beat 必须有 ≥1 个 next；通向结局就把 next.to 填 ending_id，不要留空 next。
- **可达铁律**：从开场 beat 沿 next 出发，必须能走到每一个 beat 与每一个结局；走不到的就是非法孤岛。

## 互斥规则
- 同一情节点要么 pivot_kind="choice"（next_nodes 2-4 项 + label A/B/C/D），要么 pivot_kind="branch_qte"（next_nodes 恰好 2 项 + kind="branch_qte"），二者互斥
- 普通推进 beat 的 next_nodes 仅 1 项，kind="linear"
- 汇流点 beat 的 prev_nodes 多于 1 项

## 情节点编号与三维 staging（务必内化：故事结构只由情节点 DAG 承载，"场"是拍摄分组、由系统导出）
${TOPO_BEAT_ID_NOTE}

${STAGING_NOTE}
- ⚠ 你**只标每个 beat 的三维状态**，绝不编场号；两段同地点但"离开后回归"照实标同名 location_name 即可，系统会自动切成不同场（同名地点的资产复用由 location_name 承担）。

## 剧情树拓扑硬约束（合法性铁律——违反任意一条即整次输出作废，输出 JSON 前逐条自检）
1) **beat_id 唯一且为拓扑序 id**：每个 beat_id 形如 "b" + 数字（如 "b7"），**全篇有且仅出现一次**。
   · ❌ 严禁把选项字母 / QTE 结果 / 场号拼进 beat_id —— 不得出现 "b7_A"、"5.2"、"7.1_S"、"b3a" 这类。
     分支信息只走 next_nodes[].label（A/B/C/D）与 next_nodes[].condition，**绝不进 beat_id**。
   · ❌ 严禁同一个 beat_id 出现两份（哪怕 content 完全相同）。
2) **原地改造，禁止复制**：输入 vn_beats 的每个线性 beat 在输出里必须保留**同一个 beat_id 与 content**，
   只允许改它的 next_nodes（在其上原地插入 pivot）。**绝不允许把一个原 beat 复制成两份**
   （一份保留线性、一份再加分支）——这是"开头冒出两个重复 beat、多出一个无后继死胡同"的根因。
   新增 beat 仅限"选项后果 beat"与"局部结局型推进 beat"，其 beat_id 取新的 "b<更大数字>"，且全篇唯一。
3) **无死胡同**：除指向结局外，每个非结局 beat 必须有 ≥1 条 next_nodes。
   · 通向结局：直接把 next_nodes.to 填 ending_id（如 "END_B1"），**不要造一个 next_nodes 为空的"半截 beat"**。
4) **真分叉 + 选项对等（假分支审查）**：
   · ❌ 同一 pivot 的两个不同选项**不得立即指向同一个 beat**（玩家按不同键看到同一段剧情＝体验事故）。
     每个选项必须先各自走一个**专属后果 beat**（演绎"选了之后立刻发生什么"），之后才允许 merge_back 汇流。
   · 同一 pivot 各选项的后果链长度应**大致对等**（相差 ≤1 个 beat）；不要一条线 2 个中段、另一条线 0 个中段直奔汇合 / 结局。
   · 汇流点（prev_nodes ≥2）正文写"殊途同归"，严禁"如果之前选了 A…若选了 B…"这类条件式叙述。
5) **叙事前向由拓扑判定（不成环即合法）**：判断"前向"看的是**剧情推进/拓扑**——只要不与已有链路成环，就是合法前向边。
   · 挣扎回归链、拒绝/失误分支末端本该汇回主线时，**照实连即可，用 kind="linear"**（普通续接），绝不能因怕"被当回跳"而把 next 留空 → 死胡同。
   · kind="merge_back" 只留给**真正的剧情闪回 / 回环**（A→…→B 且从 B 能沿 next 走回 A、形成环）。普通的支线汇回不是环，**不要**标 merge_back。
   · 合法性由后端按"**是否成环**"判定：不成环的边一律保留；只有真正成环且未标 merge_back 的乱连边才会被清除。所以你放心连汇回边。
6) **无孤儿 + 全可达**：除唯一开场 beat 外，每个 beat 必须有 ≥1 来路（被某 beat 的 next 指向）；
   从开场 beat 沿 next 必须可达每一个 beat 与每一个结局。**输出前在脑中跑一遍 BFS**：从开场出发，
   把能走到的 id 标记一遍——若有 beat / 结局没被标记到，就是漏接了来路，必须补上指向它的边
   （新增 beat 的来路通常是派生它的 pivot；中段结局的来路是触发它的那个 beat 的某个选项）。

${ORIGINALITY_NOTE}

${FIVE_ELEMENT_NOTE}`,

    output_format: `## 输出格式（严格 JSON · 一次性输出整棵树 · beat_id 用拓扑序 b<n>，不产 scenes / scene_id）
{
  "acts": [ ... 三幕（沿用 E1-02） ],
  "beats": [
    {
      "beat_id": "b1", "act_id": "一", "title": "杂役房觉醒", "content": "...",
      "location_name": "青云宗·外门杂役房", "time_of_day": "日", "indoor_outdoor": "内",
      "prev_nodes": [], "next_nodes": [ { "to": "b2", "kind": "linear" } ],
      "is_main_line": true, "is_ending": false,
      "spacetime": { "time": "天元历1042年·秋·卯时", "location": "青云宗·外门杂役房" },
      "state_deltas": [
        { "dimension": "plot", "subject": "主线", "attribute": "phase", "to": "系统觉醒·新手引导期" }
      ]
    },
    {
      "beat_id": "b8", "act_id": "一", "title": "演武场抉择",
      "content": "① 现状：…… ② 抛问题：你会留下还是离开？",
      "location_name": "青云宗·演武场", "time_of_day": "日", "indoor_outdoor": "外",
      "prev_nodes": ["b7"],
      "next_nodes": [
        { "to": "b9",  "kind": "choice", "label": "A", "condition": "选择和解（考验共情面）" },
        { "to": "b20", "kind": "choice", "label": "B", "condition": "选择对抗（考验意志面）" }
      ],
      "is_main_line": true, "is_ending": false,
      "pivot_kind": "choice", "branch_type": "converge",
      "spacetime": { "time": "天元历1042年·秋·午时", "location": "青云宗·演武场" },
      "state_deltas": []
    },
    {
      "beat_id": "b12", "act_id": "二", "title": "返老还童",
      "content": "服下灵果后浑身剧痛，骨骼重塑，白发变黑，皱纹消退...",
      "location_name": "青云宗·灵药谷", "time_of_day": "日", "indoor_outdoor": "外",
      "prev_nodes": ["b11"],
      "next_nodes": [ { "to": "b13", "kind": "linear" } ],
      "is_main_line": true, "is_ending": false,
      "spacetime": { "time": "天元历1042年·秋·辰时", "location": "青云宗·灵药谷" },
      "state_deltas": [
        { "dimension": "character", "subject": "顾长生", "attribute": "physical.body", "from": "60岁白发老者", "to": "18岁黑发青年" },
        { "dimension": "character", "subject": "顾长生", "attribute": "power_level", "from": "无修为", "to": "筑基初期" },
        { "dimension": "character", "subject": "顾长生", "attribute": "relationships", "to": "{\"target\":\"林婉\",\"nature\":\"恩人转为同盟\"}" },
        { "dimension": "item", "subject": "至尊骨残迹", "attribute": "condition", "from": "休眠", "to": "隐隐发热·苏醒迹象" }
      ]
    },
    {
      "beat_id": "b13", "act_id": "二", "title": "灵谷夜险", "content": "...",
      "location_name": "青云宗·灵药谷", "time_of_day": "夜", "indoor_outdoor": "外",
      "prev_nodes": ["b12"],
      "next_nodes": [
        { "to": "b14",     "kind": "branch_qte", "label": "通过", "condition": "QTE 成功" },
        { "to": "END_B1",  "kind": "branch_qte", "label": "失败", "condition": "QTE 失败（已充分预警）" }
      ],
      "is_main_line": true, "is_ending": false,
      "pivot_kind": "branch_qte", "branch_type": "terminal",
      "spacetime": { "time": "天元历1042年·秋·辰时", "location": "青云宗·灵药谷" },
      "state_deltas": []
    }
  ],
  "endings": [
    { "ending_id": "END_B1", "label": "B", "scope": "local", "title": "……", "content": "...", "trigger": "在灵药谷 QTE 失败" },
    { "ending_id": "END_H1", "label": "H", "scope": "global", "title": "黎明之约", "content": "...", "trigger": "在终极抉择中选择 A" }
  ],
  "branch_summary": {
    "pivot_choice_count": 2,
    "pivot_branch_qte_count": 1,
    "ending_h_count": 1,
    "ending_b_count": 1,
    "ending_o_count": 1
  }
}`,
  },
};

/**
 * 构造**整棵树**的 user prompt——一次性喂入全部 acts / scenes / 线性 beats。
 *
 * 之所以单次整树（而非按幕分块）：G-01 的职责是决定**跨幕的全局分支拓扑**，
 * 必须有单一编号权威（这里是全篇唯一的拓扑序 id），才能根治分块导致的撞号、`__CROSS_ACT__` 拼接、
 * "非末幕禁结局"等副作用。Gemini 2.5 Flash 1M 上下文，整树输入 ~17-29K token、
 * 输出 ~24-50K token，余量充足（详见对话评估）。
 */
function buildFullUserPrompt(ctx: NarrativeContext): string {
  const logline = ctx.vn_logline
    ? `「${ctx.vn_logline.title}」${ctx.vn_logline.content}`
    : "（无）";
  const acts = ctx.vn_outline_acts?.acts ?? [];
  const allBeats = ctx.vn_beats!.beats;

  // 节点预算：线性拍是"底座"，分支后果拍 + 结局拍是在其上"新增"的；headroom = 还能新增多少。
  const budget = getVnBudget(ctx);
  const linearCount = allBeats.length;
  const headroom = Math.max(0, budget.treeBeats - linearCount);

  return `## 必需：体验命题（一句话梗概——所有 pivot 都是它的具体化提问，结局是它的不同回答）
${logline}

## 必需：人物小传（角色弧光与价值取向的依据；pivot 的选项要考验这些性格面）
${JSON.stringify(ctx.vn_character_bios ?? { characters: [] }, null, 2)}

## 参考：关键道具（叙事硬抓手——优先让 pivot 抉择、代价、结局围绕这些道具展开）
${JSON.stringify(ctx.vn_key_items ?? { items: [] }, null, 2)}

## 必需：三幕骨架（难度沿三幕递进：一幕轻、二幕真实代价+可有局部结局、三幕高赌注+全局多结局）
${JSON.stringify(acts, null, 2)}

## 必需：黄金线（理想线·主输入——角色"全答对"的那唯一一条单路；它是脊不是全部故事，是少数派骨架）
（其 beat_id〔拓扑序 b<n>〕与 content 必须原样保留，只在其上原地插 pivot；每个 beat 已带三维 staging，新增 beat 同样必须带三维 staging；分支轨迹才是树的主体，须明显多于这些黄金 beat）
${JSON.stringify(allBeats, null, 2)}

## 参考：用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 🎯 节点预算（软目标·复杂度档位「${budget.label}」——黄金线是少数派脊，分支轨迹+结局才是主体）
- 当前黄金线拍数：**${linearCount}**（上面这些 beat 必须原样保留，不删不改 beat_id）
- 全树总拍**软上限**：**${budget.treeBeats}**（黄金线 + 分支后果 + 挣扎回归 + 下坠链 + 局部/全局结局，全算在内）
- 建议新增名额约 **${headroom}** 个分支/结局拍——${headroom <= linearCount
    ? "新增名额与黄金线相当：至少要让分支拍数 ≈ 黄金线拍数，别退化成主线+贴片。"
    : `新增名额比黄金线还多：**这是有意为之**——分支轨迹应是树的主体。`}优先投给"≥2 处 diverge/terminal 下坠不归（含 ≥1 处在幕一/二）+ ≥1 处跨多格挣扎回归 + 跨幕分布的多结局前驱链"，装饰性 low converge 短分支酌情少做。
- ⚠ **软上限不是硬截断**：若为了"剧情树完整且合法 + 分支类型配比齐全 + 结局跨幕铺垫充分"确有必要，**允许适当超出**——结构异质、自洽、满足拓扑与铺垫要求**优先**于卡死数字。但不要为凑数无意义膨胀。

## 任务
一次性把上面这条黄金线改造成**一棵完整剧情树**：原地插 pivot、长出分支轨迹（**强制配比**：≥2 处 diverge/terminal 下坠不归含 ≥1 处靠前、≥1 处跨多格挣扎回归、若干 low converge）、按"那根秤"掂量代价、按三幕递进难度、产出**跨幕分布**的局部结局 + 全局多结局（严禁结尾一次性 fan-out）。全树 beat 总数以 **${budget.treeBeats}** 为软目标（黄金线 ${linearCount} + 建议新增 ≈ ${headroom}，分支应为主体），**为完整合法且结构异质的剧情树可适当超出**。输出前逐条自检"分支类型配比""结局跨幕分布""拓扑硬约束"。`;
}

function validate(parsed: VnBranchedBeats): void {
  if (!Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    throw new Error("beats 不能为空");
  }
  if (!Array.isArray(parsed.endings) || parsed.endings.length < 3) {
    throw new Error("endings 至少 3 项");
  }
  const labels = new Set(parsed.endings.map((e) => e.label));
  if (labels.size < 2) throw new Error("endings 至少覆盖 H/B/O 中的两类");
  parsed.endings.forEach((e) => {
    if (!["H", "B", "O"].includes(e.label)) {
      throw new Error(`ending ${e.ending_id} 的 label 必须为 H/B/O：${e.label}`);
    }
  });

  const beatIds = new Set(parsed.beats.map((b) => b.beat_id));
  const endingIds = new Set(parsed.endings.map((e) => e.ending_id));

  let pivotCount = 0;
  parsed.beats.forEach((b: VnBranchedBeat) => {
    if (!Array.isArray(b.prev_nodes) || !Array.isArray(b.next_nodes)) {
      throw new Error(`beat ${b.beat_id}.prev_nodes/next_nodes 必须为数组`);
    }
    if (b.pivot_kind && !["choice", "branch_qte"].includes(b.pivot_kind)) {
      throw new Error(`beat ${b.beat_id}.pivot_kind 非法：${b.pivot_kind}`);
    }
    if (b.pivot_kind) pivotCount += 1;
    if (b.pivot_kind === "branch_qte" && b.next_nodes.length !== 2) {
      throw new Error(`beat ${b.beat_id} pivot=branch_qte 时 next_nodes 必须恰好 2 项`);
    }
    if (b.pivot_kind === "choice" && (b.next_nodes.length < 2 || b.next_nodes.length > 4)) {
      throw new Error(`beat ${b.beat_id} pivot=choice 时 next_nodes 必须 2-4 项`);
    }
    b.next_nodes.forEach((edge) => {
      if (!beatIds.has(edge.to) && !endingIds.has(edge.to)) {
        throw new Error(`beat ${b.beat_id} -> ${edge.to} 指向未知 beat/ending`);
      }
    });
    if (b.is_ending && !["H", "B", "O"].includes(b.ending_label ?? "")) {
      throw new Error(`beat ${b.beat_id} is_ending=true 必须给 ending_label H/B/O`);
    }
  });

  if (pivotCount < 3) throw new Error(`pivot 数量过少（${pivotCount}），至少 3 个`);
}

/**
 * 节点性质校验（"三校验"之**形状校验**）——善用 beat 自带的属性字段。
 *
 * 每个 beat 用它的属性「声明」了自己的角色形状：
 *   pivot_kind（是不是分支点 / 哪种）、branch_type（分支档位）、is_ending（是不是结局）、
 *   branch_origin_beat（血统）、next_nodes[].{label,kind}（分支选项）。
 * 本函数交叉核对"声明的形状 ⇄ 实际的边/选项"是否自洽——把光看边数查不出的
 * **"节点性质与连线不符"**类错误（未声明的假分叉、结局却有去向、选项缺标签、
 * 假分支同指一处、血统悬空）在生成期就逼 LLM 改对。
 *
 * ⚠ 仅在 **LLM 重试期**（callWithRetry 的校验回调）调用，不进 Phase 4：
 *   reconcile 的 prev 反转可能给线性 beat 临时补一条边，属良性，不应触发整步失败。
 */
function validateNodeShapes(parsed: VnBranchedBeats): void {
  const beatIds = new Set(parsed.beats.map((b) => b.beat_id));
  for (const b of parsed.beats) {
    const nexts = b.next_nodes ?? [];
    // ① 结局形状：终止节点不能再有去向
    if (b.is_ending && nexts.length > 0) {
      throw new Error(`beat ${b.beat_id} 标了 is_ending 却仍有 ${nexts.length} 条 next_nodes（结局是终止节点，去向必须为空）`);
    }
    // ② branch_type 是 pivot 专属属性
    if (b.branch_type && !b.pivot_kind) {
      throw new Error(`beat ${b.beat_id} 给了 branch_type="${b.branch_type}" 却没有 pivot_kind（分支档位只能标在 pivot 上）`);
    }
    // ③ 血统不悬空：branch_origin_beat 必须指向存在的 beat
    if (b.branch_origin_beat && !beatIds.has(b.branch_origin_beat)) {
      throw new Error(`beat ${b.beat_id}.branch_origin_beat 指向不存在的 beat：${b.branch_origin_beat}`);
    }
    if (b.pivot_kind === "choice") {
      // ④ choice 各选项必须各带 label（A/B/C/D）——选项是分支的"语义把手"
      const missing = nexts.filter((e) => !e.label || !e.label.trim()).length;
      if (missing > 0) {
        throw new Error(`pivot ${b.beat_id}(choice) 有 ${missing} 个选项缺 label（每个选项必须带 A/B/C/D 标签）`);
      }
      // ⑤ 假分支审查：同一 pivot 的不同选项不得立即指向同一目标
      const targets = nexts.map((e) => e.to);
      if (new Set(targets).size !== targets.length) {
        throw new Error(`pivot ${b.beat_id}(choice) 有两个选项立即指向同一目标（假分支：玩家按不同键看到同一段剧情）`);
      }
    } else if (b.pivot_kind === "branch_qte") {
      // ⑥ branch_qte 两路是"成功/失败"，边性质不应为 linear
      if (nexts.some((e) => e.kind === "linear")) {
        throw new Error(`pivot ${b.beat_id}(branch_qte) 的边 kind 不应为 linear（应为 branch_qte 的成功 / 失败两路）`);
      }
    } else if (!b.is_ending) {
      // ⑦ 非 pivot 非结局 = 普通推进 / 汇流 beat：单出（next 恰 1）。
      //    next≥2 却没声明 pivot_kind ⟹ 节点实际分叉了却没说自己是分支点（形状 ⇄ 边不符）。
      if (nexts.length >= 2) {
        throw new Error(
          `beat ${b.beat_id} 有 ${nexts.length} 条去向却未标 pivot_kind——节点实际分叉就必须声明为 pivot(choice/branch_qte)，否则是"未声明的假分叉"`,
        );
      }
    }
  }
}

/**
 * 拓扑序 id 归一化：把 LLM 漏出的非 "b<数字>" 形态 beat_id（如 "b7_A"/"5.2"/"7.1_S"/"b3a"）
 * 重映射成一个全新的 "b<全局最大+1>"，并同步改写所有 prev_nodes / next_nodes / branch_origin 引用。
 * endings（END_*）不受影响。**场号不在此阶段存在**——由拓扑定稿后的确定性场号导出统一分配。
 * 逻辑确定、可单测；对全清洁产出为恒等变换（no-op）。
 */
function normalizeTopoIds(beats: VnBranchedBeat[], endingIds: Set<string>): void {
  const isClean = (id: string): boolean => /^b\d+$/.test(id);
  let maxN = 0;
  for (const b of beats) {
    const m = /^b(\d+)$/.exec(b.beat_id);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }

  const idMap = new Map<string, string>();
  for (const b of beats) {
    if (isClean(b.beat_id)) continue;
    const newId = `b${++maxN}`;
    idMap.set(b.beat_id, newId);
    b.beat_id = newId;
  }
  if (idMap.size === 0) return; // no-op：本就全清洁

  const remap = (id: string): string => idMap.get(id) ?? id;
  for (const b of beats) {
    b.prev_nodes = (b.prev_nodes ?? []).map(remap);
    for (const e of b.next_nodes) {
      if (!endingIds.has(e.to)) e.to = remap(e.to);
    }
    if (b.branch_origin_beat) b.branch_origin_beat = remap(b.branch_origin_beat);
  }
}

/**
 * 确定性场号导出（§4.6c / 影游生成方案 §7.3）——剧情树拓扑定稿后运行。
 *
 * 「场」是拍摄分组、非故事结构层：按 **DFS 序**遍历纯情节点 DAG，相邻（DFS 父子）三维状态
 * （location_name/time_of_day/indoor_outdoor）全同 ⟹ 沿用父场号；任一维变化（含离开后回到
 * 同名地点）⟹ 全局最大场号 +1。据此把拓扑序 id 重写为最终 `场.序`、改写所有边引用，
 * 并派生 result.scenes（scene_id/act_id/三维/is_main_line/branch_origin_beat/location_id）。
 *
 * 纯确定性、可单测；下游 G-02/G-03 与前端只见导出后的 `场.序` 与派生 scenes。
 */
export function exportScenesAndRenumber(result: VnBranchedBeats): void {
  const beats = result.beats;
  if (beats.length === 0) { result.scenes = []; return; }
  const beatById = new Map(beats.map((b) => [b.beat_id, b] as const));

  // 1) 选根：入度为 0 的 beat（拓扑序最小者优先；兜底取全局最小序）
  const indeg = new Map<string, number>();
  for (const b of beats) indeg.set(b.beat_id, 0);
  for (const b of beats) for (const e of b.next_nodes ?? []) {
    if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const byOrder = (a: string, b: string) => beatOrderOf(a) - beatOrderOf(b);
  const roots = beats.filter((b) => (indeg.get(b.beat_id) ?? 0) === 0).map((b) => b.beat_id).sort(byOrder);
  const startId = roots[0] ?? [...beatById.keys()].sort(byOrder)[0];

  // 2) DFS 前序 + 记录 DFS 父（邻居按拓扑序定序，保证确定性）
  const parent = new Map<string, string | null>();
  const dfsOrder: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, par: string | null): void => {
    if (visited.has(id)) return;
    visited.add(id);
    parent.set(id, par);
    dfsOrder.push(id);
    const nb = beatById.get(id);
    const nexts = (nb?.next_nodes ?? []).map((e) => e.to).filter((t) => beatById.has(t)).sort(byOrder);
    for (const t of nexts) visit(t, id);
  };
  visit(startId, null);
  for (const b of [...beats].sort((x, y) => byOrder(x.beat_id, y.beat_id))) {
    if (!visited.has(b.beat_id)) visit(b.beat_id, null);
  }

  // 3) 按 DFS 序编场号：DFS 父子三维全同 ⟹ 同场；否则新场（全局最大 +1）
  const threeDim = (b?: VnBranchedBeat) => `${b?.location_name ?? ""}|${b?.time_of_day ?? ""}|${b?.indoor_outdoor ?? ""}`;
  const sceneOfBeat = new Map<string, number>();
  let maxScene = 0;
  for (const id of dfsOrder) {
    const b = beatById.get(id)!;
    const par = parent.get(id) ?? null;
    const parBeat = par ? beatById.get(par) : undefined;
    // 缺三维时从 DFS 父继承（保持同场，避免误切）
    if (!b.location_name && parBeat?.location_name) {
      b.location_name = parBeat.location_name;
      b.time_of_day = parBeat.time_of_day;
      b.indoor_outdoor = parBeat.indoor_outdoor;
    }
    if (parBeat && threeDim(b) === threeDim(parBeat)) {
      sceneOfBeat.set(id, sceneOfBeat.get(par!)!);
    } else {
      sceneOfBeat.set(id, ++maxScene);
    }
  }

  // 4) 场内序号（按 DFS 序 1..k），构造 拓扑id → 场.序 映射
  const sceneSeq = new Map<number, number>();
  const idMap = new Map<string, string>();
  for (const id of dfsOrder) {
    const scene = sceneOfBeat.get(id)!;
    const seq = (sceneSeq.get(scene) ?? 0) + 1;
    sceneSeq.set(scene, seq);
    idMap.set(id, `${scene}.${seq}`);
  }

  // 5) location_name → 稳定 location_id（首见顺序）
  const locId = new Map<string, string>();
  for (const id of dfsOrder) {
    const ln = beatById.get(id)!.location_name ?? "未标注地点";
    if (!locId.has(ln)) locId.set(ln, `loc-${locId.size + 1}`);
  }

  // 6) 重写 beat 自身 id + 所有边引用（endings 不在 idMap → 保持不变）
  const remap = (id: string): string => idMap.get(id) ?? id;
  for (const b of beats) {
    const origId = b.beat_id;
    b.scene_id = String(sceneOfBeat.get(origId) ?? "");
    b.location_id = locId.get(b.location_name ?? "未标注地点");
    b.prev_nodes = (b.prev_nodes ?? []).map(remap);
    for (const e of b.next_nodes ?? []) e.to = remap(e.to);
    if (b.branch_origin_beat) b.branch_origin_beat = remap(b.branch_origin_beat);
    b.beat_id = remap(origId);
  }

  // 7) 派生 scenes（beatById/dfsOrder/sceneOfBeat 仍以**原始拓扑 id** 索引，未受第 6 步影响）
  const scenes: VnScene[] = [];
  for (let s = 1; s <= maxScene; s++) {
    const memberIds = dfsOrder.filter((id) => sceneOfBeat.get(id) === s);
    if (memberIds.length === 0) continue;
    const first = beatById.get(memberIds[0])!;
    const act = memberIds.map((id) => beatById.get(id)!.act_id).find((a) => a && a.trim())
      ?? scenes[scenes.length - 1]?.act_id ?? "一";
    const isMain = memberIds.some((id) => beatById.get(id)!.is_main_line);
    const branchOrigin = memberIds.map((id) => beatById.get(id)!.branch_origin_beat).find(Boolean);
    scenes.push({
      scene_id: String(s),
      act_id: act,
      location_name: first.location_name ?? "未标注地点",
      time_of_day: (first.time_of_day ?? "日") as "日" | "夜",
      indoor_outdoor: (first.indoor_outdoor ?? "内") as "内" | "外",
      content: memberIds.map((id) => beatById.get(id)!.content).filter(Boolean).slice(0, 3).join(" / ").slice(0, 200),
      is_main_line: isMain,
      location_id: locId.get(first.location_name ?? "未标注地点"),
      ...(branchOrigin ? { branch_origin_beat: branchOrigin } : {}),
    });
  }
  result.scenes = scenes;

  // 导出后契约：所有 beat_id 必须为最终 `场.序`（拓扑序临时 id 已全部重写）。
  const bad = result.beats.find((b) => !/^\d+\.\d+$/.test(b.beat_id));
  if (bad) throw new Error(`场号导出后仍存在非「场.序」beat_id：${bad.beat_id}`);
}

/**
 * 边一致性修复：清除"造成环路的非法回跳边"（基于**拓扑成环**判定，非"场.序"数值）。
 *
 * ⚠ 为什么不用「场.序」判前向：支线场号取"全局最大 +1"，所以支线 beat 的场号往往大于
 *   它要汇回的主线 beat（如挣扎回归链 10.3 → 6.1）。这类边**叙事上前向、且不成环**，
 *   旧实现按 orderOf(to) ≥ orderOf(from) 判定会把它们误删 → 支线变死胡同、QA 再乱救
 *   （甚至接到死亡结局）。场号 ≠ 叙事序，唯一可靠的"非法回跳"信号是**它是否形成环**。
 *
 * 新规则：
 *   候选边 = next_nodes ∪ (prev_nodes 反转)；
 *   迭代 DFS（从场.序最小的 beat 优先起步，让主线骨架先成树干）检出**回边**（指向 DFS 栈
 *   上节点 = 成环）；保留所有"非回边"(DAG 前向，含支线汇回主线) + 显式 kind="merge_back"
 *   （合法剧情回环）；仅丢弃"非 merge_back 的成环回跳边"（LLM 乱连）。指向 ending 的边
 *   为末端，恒保留。
 *
 * ⚠ 对正常产出（DAG、无乱连环）此为恒等变换（no-op，保留全部边）；与前端
 *   useDetroitLayout 的 DFS 回边检测同源、判定一致。
 */
function reconcileBeatEdges(beats: VnBranchedBeat[]): void {
  type Edge = VnBranchedBeat["next_nodes"][number];
  const beatIds = new Set(beats.map((b) => b.beat_id));
  // 拓扑序/场.序统一排序基准（成环判定本身是拓扑 DFS，此处仅用于选起点/邻居定序）。
  const orderOf = beatOrderOf;

  // 候选边（去自环），保留原始 meta（kind/label/condition）
  const origEdge = new Map<string, Map<string, Edge>>();
  const adj = new Map<string, Set<string>>();
  for (const b of beats) { origEdge.set(b.beat_id, new Map()); adj.set(b.beat_id, new Set()); }
  const addCandidate = (from: string, to: string, meta?: Edge) => {
    if (!from || !to || from === to) return;
    adj.get(from)?.add(to);
    if (meta && !origEdge.get(from)!.has(to)) origEdge.get(from)!.set(to, meta);
  };
  for (const b of beats) {
    for (const e of b.next_nodes) addCandidate(b.beat_id, e.to, e);
    for (const p of b.prev_nodes ?? []) if (beatIds.has(p)) addCandidate(p, b.beat_id); // prev 反转：p → b
  }

  // 迭代 DFS 回边检测（仅 beat→beat 参与；ending 不在 beatIds，是末端）
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of beatIds) color.set(id, WHITE);
  const adjList = new Map<string, string[]>();
  for (const id of beatIds) {
    adjList.set(id, [...(adj.get(id) ?? [])].filter((t) => beatIds.has(t)).sort((a, b) => orderOf(a) - orderOf(b)));
  }
  const backEdges = new Set<string>();
  for (const s of [...beatIds].sort((a, b) => orderOf(a) - orderOf(b))) {
    if (color.get(s) !== WHITE) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: s, i: 0 }];
    color.set(s, GRAY);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const nbrs = adjList.get(top.id)!;
      if (top.i < nbrs.length) {
        const v = nbrs[top.i++];
        const c = color.get(v);
        if (c === GRAY) backEdges.add(`${top.id}->${v}`);            // 回边（成环）
        else if (c === WHITE) { color.set(v, GRAY); stack.push({ id: v, i: 0 }); }
      } else { color.set(top.id, BLACK); stack.pop(); }
    }
  }

  // 保留：DAG 前向边（含支线汇回主线）+ 显式 merge_back；丢弃：非 merge_back 的成环回跳边。
  const newNext = new Map<string, Edge[]>();
  for (const id of beatIds) newNext.set(id, []);
  for (const [from, tos] of adj) {
    for (const to of tos) {
      const meta = origEdge.get(from)?.get(to);
      const kind = meta?.kind ?? "linear";
      const isBack = beatIds.has(to) && backEdges.has(`${from}->${to}`);
      if (!isBack || kind === "merge_back") newNext.get(from)!.push(meta ?? ({ to, kind: "linear" } as Edge));
    }
  }

  for (const b of beats) {
    b.next_nodes = newNext.get(b.beat_id) ?? [];
  }

  // prev↔next 双向同步：从新的 next 重建 prev。
  // （runGraphQA 在"合法"时会提前 return、不调用 applyRepairs，故 prev 必须在这里就修好，
  //  否则落盘的 prev 可能残留被本函数删掉的回跳边，影响 resume/读原始 JSON 的自洽性。）
  const prevMap = new Map<string, Set<string>>();
  for (const b of beats) prevMap.set(b.beat_id, new Set());
  for (const b of beats) {
    for (const e of b.next_nodes) {
      const set = prevMap.get(e.to);
      if (set) set.add(b.beat_id);
    }
  }
  for (const b of beats) {
    b.prev_nodes = [...(prevMap.get(b.beat_id) ?? [])].sort((x, y) => orderOf(x) - orderOf(y));
  }
}

/**
 * 撞号合并兜底：同一 beat_id 出现多份时合并为一份（治"开头两个 5.1 / 死胡同 5.2"）。
 *
 * 根因：分幕 / 支线生成偶发把原线性 beat 复制成两份（一份保留线性、一份再加分支），
 * 或两幕各造同一场号。落盘后：① 前端被迫加 "#1" 消歧（用户看到莫名其妙的井号）；
 * ② 下游 G-02/G-03 按 beat_id 覆盖内容时只能命中第一份 → 内容错位。
 *
 * 合并策略（保连通、去冗余）：
 *   - 同 id 多份时，保留"信息最全"的一份（pivot 优先 > next 边最多 > 有 prev）；
 *   - 把其余份的 next/prev 边并入保留份（按 to/from 去重）；非 pivot 才并 next，
 *     pivot 的出边是刻意设计的（choice 2-4 / branch_qte 恰好 2），不并以免破坏约束；
 *   - 删除其余份。引用按 beat_id 字符串寻址，合并后所有引用仍落在存活的同名 beat 上，无需改边。
 *
 * ⚠ 无撞号的正常产出下为恒等变换（no-op）。
 */
function dedupeBeats(beats: VnBranchedBeat[]): VnBranchedBeat[] {
  const groups = new Map<string, VnBranchedBeat[]>();
  for (const b of beats) {
    const list = groups.get(b.beat_id) ?? [];
    list.push(b);
    groups.set(b.beat_id, list);
  }
  const firstSeen: string[] = [];
  const seen = new Set<string>();
  for (const b of beats) {
    if (!seen.has(b.beat_id)) { seen.add(b.beat_id); firstSeen.push(b.beat_id); }
  }

  const survivors: VnBranchedBeat[] = [];
  for (const id of firstSeen) {
    const group = groups.get(id)!;
    if (group.length === 1) { survivors.push(group[0]); continue; }
    // 排序选最优保留份：pivot 优先 → next 多 → 有 prev
    const sorted = [...group].sort((a, b) => {
      const pa = a.pivot_kind ? 1 : 0, pb = b.pivot_kind ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const na = a.next_nodes?.length ?? 0, nb = b.next_nodes?.length ?? 0;
      if (na !== nb) return nb - na;
      return (b.prev_nodes?.length ?? 0) - (a.prev_nodes?.length ?? 0);
    });
    const keep = sorted[0];
    const rest = sorted.slice(1);
    // 并 prev（恒安全）
    const prevSet = new Set(keep.prev_nodes ?? []);
    for (const o of rest) for (const p of o.prev_nodes ?? []) prevSet.add(p);
    keep.prev_nodes = [...prevSet];
    // 并 next：仅非 pivot 才并（pivot 出边受 choice/branch_qte 数量约束，不动）
    if (!keep.pivot_kind) {
      const seenTo = new Set(keep.next_nodes.map((e) => e.to));
      for (const o of rest) for (const e of o.next_nodes ?? []) {
        if (e.to && !seenTo.has(e.to)) { keep.next_nodes.push(e); seenTo.add(e.to); }
      }
      // 若保留份无出边但某副本是 pivot → 继承其 pivot 设计（避免丢分支）
      const pv = rest.find((o) => o.pivot_kind);
      if (keep.next_nodes.length === 0 && pv) {
        keep.pivot_kind = pv.pivot_kind;
        keep.next_nodes = pv.next_nodes;
      }
    }
    survivors.push(keep);
  }
  return survivors;
}

/**
 * 叙事/拓扑序：
 *   - 树阶段拓扑序 id "b<n>" → n（黄金线按叙事顺序 b1..bN，分支新增更大编号）
 *   - 导出后 "场.序" → 场*10000+序
 * 非 beat（ending）视为末端。两种形态不会在同一时刻混用（导出前全 b<n>、导出后全场.序）。
 */
function beatOrderOf(id: string): number {
  const t = /^b(\d+)$/.exec(id);
  if (t) return Number(t[1]);
  const m = /^(\d+)\.(\d+)/.exec(id);
  return m ? Number(m[1]) * 10000 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
}

/**
 * VnBranchedBeats ⇄ 规范图适配器。
 * - 节点：beats（is_ending 视为终止）+ endings（终止）
 * - 边：beat.next_nodes[].to（单向）
 * - applyRepairs 写回 next 之外，**从 next 重建 prev_nodes**（双向同步，根治
 *   reconcileBeatEdges 只改 next 导致 prev 残旧/为空的问题）。
 */
function vnBeatsAdapter(): GraphAdapter<VnBranchedBeats> {
  return {
    toCanonical(out: VnBranchedBeats): QaGraph {
      const beatNodes = out.beats.map((b) => ({
        id: b.beat_id,
        next: b.next_nodes.map((e) => e.to).filter(Boolean),
        isEnding: !!b.is_ending,
        label: b.content?.slice(0, 50),
        tokens: b.ending_label ? [b.ending_label] : undefined,
      }));
      const endingNodes = out.endings.map((e) => ({
        id: e.ending_id,
        next: [] as string[],
        isEnding: true,
        label: e.title,
        tokens: [e.label],
      }));
      let root = out.beats[0]?.beat_id ?? "";
      let min = Number.MAX_SAFE_INTEGER;
      for (const b of out.beats) {
        const o = beatOrderOf(b.beat_id);
        if (o < min) {
          min = o;
          root = b.beat_id;
        }
      }
      return { rootId: root, nodes: [...beatNodes, ...endingNodes] };
    },
    applyRepairs(out: VnBranchedBeats, repaired: QaGraph): void {
      const beatById = new Map(out.beats.map((b) => [b.beat_id, b]));
      // 1) 写回 next：保留已有边的 kind/label/condition，新增边 kind="linear"
      for (const cn of repaired.nodes) {
        const beat = beatById.get(cn.id);
        if (!beat) continue; // ending 节点无 next_nodes
        if (cn.isEnding && !beat.is_ending) {
          beat.is_ending = true;
          if (!beat.ending_label) beat.ending_label = "O";
        }
        const existingByTo = new Map(beat.next_nodes.map((e) => [e.to, e]));
        beat.next_nodes = cn.next.map((to) => existingByTo.get(to) ?? { to, kind: "linear" as const });
      }
      // 2) 重建 prev_nodes（双向同步：prev = 指向该 beat 的 beat 前驱，不含 ending）
      const prevMap = new Map<string, Set<string>>();
      for (const b of out.beats) prevMap.set(b.beat_id, new Set());
      for (const b of out.beats) {
        for (const e of b.next_nodes) {
          if (prevMap.has(e.to)) prevMap.get(e.to)!.add(b.beat_id);
        }
      }
      for (const b of out.beats) {
        b.prev_nodes = [...(prevMap.get(b.beat_id) ?? [])].sort((x, y) => beatOrderOf(x) - beatOrderOf(y));
      }
    },
  };
}

/**
 * 节点类型 ⇄ 实际结构 的审计 + 确定性修复（善用 beat 的"角色字段"做校验）。
 *
 * 每个 beat 用 is_ending / pivot_kind / branch_type 等字段「声明」了自己的角色，
 * 本函数核对"声明的角色 ⇄ 它在图里的真实形状（出入边）"是否一致，并就地修复：
 *   ① 开始节点——入度 0 的非结局 beat 应**恰好 1 个**且为场.序最小者（多余的是孤儿）
 *   ② 终点是结局——is_ending 的 beat 必须无出边（结局是终点）→ 多余出边清空
 *   ③ 分支节点真分叉——pivot 必须有 ≥2 条去向（choice 2-4 / qte=2）；
 *      · 标了 pivot 却 <下限 → **降级**为普通推进 beat；
 *      · 没标 pivot 却 ≥2 去向 → **提升**为 pivot(choice) 并补选项标签（未声明的假分叉）
 *   ④ 聚合节点真汇聚——branch_type=converge 的 pivot，下游必须存在 prev≥2 的聚合点；找不到 → 标记
 *   ⑤ 选项 ⇄ 链路一致——choice/qte 的每条边补齐 label、纠正 kind；选项同指一处（假分支）→ 标记
 *
 * 修复就地改 result.beats（角色字段 + 边）；若改过边则末尾自行重建 prev（统一不变式：
 * "谁改 next 谁重建 prev"）。之后由 runGraphQA 收口因降级/提升产生的
 * 死胡同/孤儿。①④⑤ 中无法确定性修的只记录，交 LLM critic。
 */
function auditAndRepairVnRoles(
  result: VnBranchedBeats,
  log: (m: string) => void,
): { issues: string[]; repairs: string[] } {
  const issues: string[] = [];
  const repairs: string[] = [];
  const beats = result.beats;
  const beatById = new Map(beats.map((b) => [b.beat_id, b]));
  const endingIds = new Set(result.endings.map((e) => e.ending_id));
  const labels = ["A", "B", "C", "D"];

  const computeIndeg = (): Map<string, number> => {
    const indeg = new Map<string, number>();
    for (const b of beats) indeg.set(b.beat_id, 0);
    for (const b of beats) for (const e of b.next_nodes ?? []) {
      if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
    return indeg;
  };

  // ① 开始节点
  const indeg0 = computeIndeg();
  const entries = beats.filter((b) => !b.is_ending && (indeg0.get(b.beat_id) ?? 0) === 0);
  const minOrder = beats.reduce((m, b) => Math.min(m, beatOrderOf(b.beat_id)), Number.MAX_SAFE_INTEGER);
  if (entries.length === 0) {
    issues.push(`无开始节点：所有 beat 都有入边（疑似成环，待 graph-qa 处理）`);
  } else if (entries.length > 1) {
    issues.push(`开始节点不唯一：${entries.map((b) => b.beat_id).join(", ")} 均无入边（多余者是孤儿，交 graph-qa 重接）`);
  } else if (beatOrderOf(entries[0].beat_id) !== minOrder) {
    issues.push(`开始节点 ${entries[0].beat_id} 不是场.序最小的 beat（疑似漏接更早 beat 的来路）`);
  }

  // ②③⑤ 逐 beat：节点类型 = 由(入度, 出度)派生的结构身份，可叠加；声明字段须与结构一致。
  //   START=入度0   END=出度0   FORK(分支)=出度≥2   MERGE(聚合)=入度≥2
  //   身份可组合：开场+分支(START+FORK)、结局+聚合(MERGE+END)、中段既分支又聚合(MERGE+FORK)。
  //   MERGE/START 是纯结构身份、恒合法（多前驱/无前驱本身不需修），只校验 END⇄is_ending、FORK⇄pivot_kind。
  const indegB = computeIndeg();
  const outDegOf = (b: VnBranchedBeat) =>
    (b.next_nodes ?? []).filter((e) => beatById.has(e.to) || endingIds.has(e.to)).length;
  for (const b of beats) {
    const nexts = b.next_nodes ?? [];
    const inDeg = indegB.get(b.beat_id) ?? 0;
    const outDeg = outDegOf(b);

    // —— END 身份（出度0）⇄ is_ending 字段 ——（与 MERGE 可并存：结局也可是聚合节点）
    if (b.is_ending) {
      if (nexts.length > 0) {
        b.next_nodes = [];
        repairs.push(`结局 ${b.beat_id} 清空 ${nexts.length} 条多余出边（结局是终点；入度=${inDeg}）`);
      }
      continue;
    }
    if (outDeg === 0) {
      // 非结局却无去向 = 死胡同：交 graph-qa 接续/接结局，不在此臆造结局
      continue;
    }

    // —— FORK 身份（出度≥2）⇄ pivot_kind 字段 ——（与 START/MERGE 正交，互不影响）
    if (outDeg >= 2) {
      if (b.pivot_kind === "branch_qte" && outDeg !== 2) {
        // QTE 必须恰 2 路；出度≥2 但 ≠2 → 仍是分支，重分类为 choice
        b.pivot_kind = "choice";
        delete b.branch_type;
        repairs.push(`${b.beat_id} 标 branch_qte 却有 ${outDeg} 条去向 → 重分类为 choice`);
      } else if (!b.pivot_kind) {
        // 结构分叉却未声明 pivot → 提升为 choice（未声明的假分叉）
        b.pivot_kind = "choice";
        repairs.push(`${b.beat_id} 有 ${outDeg} 条去向却未声明 → 提升为 pivot(choice)`);
      }
      // 选项 ⇄ 链路一致：补 label、纠 kind 与 pivot 类型一致
      const edgeKind = b.pivot_kind === "branch_qte" ? "branch_qte" : "choice";
      nexts.forEach((e, i) => {
        if (b.pivot_kind === "choice" && (!e.label || !e.label.trim())) {
          e.label = labels[i] ?? `O${i + 1}`;
          repairs.push(`${b.beat_id} 选项补 label ${e.label}`);
        }
        if (e.kind === "linear") {
          e.kind = edgeKind;
          repairs.push(`${b.beat_id} 选项 kind linear→${edgeKind}`);
        }
      });
      const tos = nexts.map((e) => e.to);
      if (new Set(tos).size !== tos.length) {
        issues.push(`pivot ${b.beat_id} 有选项立即指向同一目标（假分支，交 LLM critic 复核）`);
      }
    } else if (b.pivot_kind) {
      // —— 非分支（出度≤1）却声明了 pivot → 降级为普通推进 beat ——
      const was = b.pivot_kind;
      delete b.pivot_kind;
      delete b.branch_type;
      repairs.push(`${b.beat_id} 标 ${was} 却只有 ${outDeg} 条去向 → 降级为普通推进 beat`);
    }
  }

  // ④ 聚合节点：converge pivot 下游须存在聚合点（prev≥2）
  const indeg1 = computeIndeg();
  for (const b of beats) {
    if (b.pivot_kind !== "choice" || b.branch_type !== "converge") continue;
    // 从该 pivot 沿 next BFS，看子树里是否有 indeg≥2 的聚合点
    const seen = new Set<string>([b.beat_id]);
    const queue = (b.next_nodes ?? []).map((e) => e.to).filter((t) => beatById.has(t));
    let hasMerge = false;
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      if ((indeg1.get(cur) ?? 0) >= 2) { hasMerge = true; break; }
      for (const e of beatById.get(cur)?.next_nodes ?? []) if (beatById.has(e.to)) queue.push(e.to);
    }
    if (!hasMerge) {
      issues.push(`pivot ${b.beat_id} 标 branch_type=converge 但下游无聚合点(prev≥2)——分支未真正汇回（交 LLM critic 复核或改 branch_type）`);
    }
  }

  // ⑤ 分支链长度对等性检查：各选项从 pivot 到汇合点/结局的链长不应相差 >1
  for (const b of beats) {
    if (!b.pivot_kind || b.pivot_kind !== "choice") continue;
    const nexts = b.next_nodes ?? [];
    if (nexts.length < 2) continue;
    const pathLens: number[] = [];
    for (const edge of nexts) {
      let len = 0;
      let cur = edge.to;
      const visited = new Set<string>([b.beat_id]);
      while (cur && beatById.has(cur) && !visited.has(cur)) {
        visited.add(cur);
        const node = beatById.get(cur)!;
        len++;
        const outs = (node.next_nodes ?? []).filter((e) => beatById.has(e.to) || endingIds.has(e.to));
        if (outs.length === 1) {
          cur = outs[0].to;
        } else {
          break;
        }
      }
      pathLens.push(len);
    }
    const maxL = Math.max(...pathLens);
    const minL = Math.min(...pathLens);
    if (maxL - minL > 1 && minL === 0) {
      issues.push(
        `pivot ${b.beat_id} 选项链长度不对等(${pathLens.join("/")})：有选项直达汇合/结局(长度0)而另一条走了${maxL}步——可能是"空链路"（交 LLM critic 补齐或改设计）`,
      );
    }
  }

  if (repairs.length || issues.length) {
    log(`[vn-roles] 角色审计：${repairs.length} 处修复、${issues.length} 处待复核`);
  }

  // 统一不变式："谁改 next 谁重建 prev"——audit 若修过边（清空结局出边/纠 kind），
  // 必须就地重建 prev。不能依赖 runGraphQA 的 applyRepairs，因为后者在"图已合法"
  // 时会提前 return（graph-qa.ts L648），届时残留旧 prev 不被清理。
  if (repairs.length > 0) {
    const prevMap = new Map<string, Set<string>>();
    for (const b of beats) prevMap.set(b.beat_id, new Set());
    for (const b of beats) {
      for (const e of b.next_nodes ?? []) {
        const set = prevMap.get(e.to);
        if (set) set.add(b.beat_id);
      }
    }
    for (const b of beats) {
      b.prev_nodes = [...(prevMap.get(b.beat_id) ?? [])].sort((x, y) => beatOrderOf(x) - beatOrderOf(y));
    }
  }

  return { issues, repairs };
}

/**
 * G-01 结构质量门：环 / 孤儿 / 死胡同 / 孤儿结局 / 可达性 + prev↔next 双向同步。
 * 在 validate（pivot 约束）与 reconcileBeatEdges（去回跳边）之后执行；对正常产出
 * 仅做 prev 重建，不增删边（合法时 algo 是 no-op）。
 */
async function qaVnBranchedBeats(
  ctx: NarrativeContext,
  llm: LLMClient,
  result: VnBranchedBeats,
): Promise<void> {
  const summaries: Record<string, string> = {};
  for (const b of result.beats) if (b.content) summaries[b.beat_id] = b.content;

  // 先做"节点类型 ⇄ 实际结构"审计 + 确定性修复（修角色字段与选项边、自行重建 prev），
  // 再交 graph-qa 收口因降级/提升产生的死胡同/孤儿。
  const roleAudit = auditAndRepairVnRoles(result, (m) => console.warn(m));

  const report = await runGraphQA(result, vnBeatsAdapter(), {
    llm,
    label: "vn_branched_beats",
    contextHint: ctx.vn_logline?.content ?? ctx.user_preference_summary,
    summaries,
    // 叙事序：孤儿 beat 按「场.序」重接到紧邻前驱（修回"来路"），而非粗暴接根
    orderOf: beatOrderOf,
  });

  (result as unknown as Record<string, unknown>).__graph_qa = {
    valid: report.valid,
    repairs: report.repairsApplied,
    residual: report.residualIssues.map((i) => i.detail),
    llmTouched: report.llmTouched,
    llmVerdict: report.llmVerdict,
    role_repairs: roleAudit.repairs,
    role_issues: roleAudit.issues,
  };
}

/**
 * G-01 剧情树改造（单次整树生成，纯情节点 DAG）。
 *
 * 一次 LLM 调用产出整棵树（拓扑序 id + 三维 staging）→ 拓扑 id 归一化 → 结局标修复 →
 * 撞号合并 → 全局验证 → 边一致性修复 → 结构质量门 → **确定性场号导出**（DFS 序编 `场.序` + 派生 scenes）。
 * 单一编号权威 + 场/情节点解耦（§4.6c）：故事结构只由情节点 DAG 承载，场号是拓扑定稿后的确定性分组。
 */
export async function vnBranchedBeats(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  if (!ctx.vn_outline_acts || !ctx.vn_beats) {
    throw new Error("vn_branched_beats 需要 vn_outline_acts / vn_beats 全部已生成");
  }
  const streamEmit = getStreamEmit(ctx);
  const acts = ctx.vn_outline_acts.acts;

  if (streamEmit) {
    streamEmit(
      `\n[G-01] 单次整树改造：${ctx.vn_beats.beats.length} 个线性 beat → 剧情树（分支+多结局）…\n`,
      "",
    );
  }

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_BRANCHED_BEATS_COMPOSER, ctx),
    appendUserInstructions(buildFullUserPrompt(ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => {
      const p = extractJSON<VnBranchedBeats>(r);
      validate(p);            // 数量 / 边目标 / 结局类别等
      validateNodeShapes(p);  // 节点性质 ⇄ 边 / 选项 自洽（形状校验）
    },
    streamEmit,
  );
  const parsed = extractJSON<VnBranchedBeats>(raw);

  const beats = parsed.beats;
  const endings = parsed.endings ?? [];
  const endingIds = new Set(endings.map((e) => e.ending_id));

  // Phase 1: 拓扑序 id 归一化（b7_A / 5.2 等脏 id → 全新 b<max+1>，prev/next 引用同步改写）。
  normalizeTopoIds(beats, endingIds);

  // Phase 2: 结局标修复——is_ending=true 但缺 ending_label 时兜底借用 label，否则降级为非结局。
  const endingById = new Map(endings.map((e) => [e.ending_id, e] as const));
  for (const b of beats) {
    if (!b.is_ending) continue;
    const lbl = b.ending_label ?? "";
    if (["H", "B", "O"].includes(lbl)) continue;
    const targets = b.next_nodes.map((e) => e.to).filter((t) => endingById.has(t));
    const fromTarget = targets.length === 1 ? endingById.get(targets[0])!.label : undefined;
    const fromSelf = endingById.get(b.beat_id)?.label;
    const inferred = fromTarget ?? fromSelf;
    if (inferred && ["H", "B", "O"].includes(inferred)) {
      b.ending_label = inferred;
    } else {
      b.is_ending = false;
      delete b.ending_label;
    }
  }

  // Phase 3: 撞号合并兜底（单次生成已基本无撞号，仍保留作安全网，对清洁产出为 no-op）。
  const cleanBeats = dedupeBeats(beats);

  // 标题兜底：LLM 未给 title 时——黄金线 beat 沿用 vn_beats 阶段的原标题（此时仍是拓扑序 id，
  // 与 ctx.vn_beats.beats 的 beat_id 对齐），其余从正文派生。保证每个 beat 都有可展示标题，
  // 前端剧情树标题位不再回落成正文首句。（此处在场号导出前执行，id 尚为 b<n>。）
  const goldenTitle = new Map(
    (ctx.vn_beats?.beats ?? []).map((b) => [b.beat_id, b.title?.trim()] as const),
  );
  for (const b of cleanBeats) {
    if (b.title?.trim()) continue;
    b.title = goldenTitle.get(b.beat_id) || deriveBeatTitleFromContent(b.content, b.beat_id);
  }

  // 结局 scope 缺省补全：未标 scope 的视为 global（向后兼容旧数据）。
  for (const e of endings) if (!e.scope) e.scope = "global";

  const result: VnBranchedBeats = {
    acts: parsed.acts && parsed.acts.length > 0 ? parsed.acts : acts,
    // 场号改后处理导出：LLM 不产 scenes；由 Phase 7 exportScenesAndRenumber 派生。
    scenes: [],
    beats: cleanBeats,
    endings,
    branch_summary: {
      pivot_choice_count: cleanBeats.filter((b) => b.pivot_kind === "choice").length,
      pivot_branch_qte_count: cleanBeats.filter((b) => b.pivot_kind === "branch_qte").length,
      ending_h_count: endings.filter((e) => e.label === "H").length,
      ending_b_count: endings.filter((e) => e.label === "B").length,
      ending_o_count: endings.filter((e) => e.label === "O").length,
    },
  };

  // Phase 4: 全局验证（pivot 结构 / 边目标 / 结局数等质量约束）。
  validate(result);

  // Phase 5: 边一致性修复——清除"非 merge_back 的回跳边"（折回长边根因）。对正常产出为 no-op。
  reconcileBeatEdges(result.beats);

  // Phase 6: 结构质量门（算法校验→修复→LLM critic 兜底）+ prev↔next 双向同步。
  await qaVnBranchedBeats(ctx, llm, result);

  // Phase 7: 确定性场号导出（§4.6c）——拓扑定稿后按 DFS 序 + 三维相邻变化编场号，
  // 把拓扑序 id 重写为最终 `场.序`、改写全部边引用，并派生 result.scenes（供下游/前端）。
  exportScenesAndRenumber(result);

  ctx.vn_branched_beats = result;
}
