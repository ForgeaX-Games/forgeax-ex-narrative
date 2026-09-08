# 归档：管线层封存总台账

本目录是 `src/pipeline/` 里"两条精心设计过的老管线 + 品类特化能力 + 模板定义"的
统一封存区。约定完全沿用 [`src/prompts/_archive/README.md`](../../prompts/_archive/README.md)
那次封存立下的三条规矩，本轮把它推广到管线层：

1. **物理搬进独立子目录**——不是加注释说"已废弃"，是真的从活跃代码里移走。
2. **写明哪一段被吸收进了哪里**——本 README 的台账表就是这件事的记录处。
3. **声明此后勿改**——子目录里的文件只为保留吸收前的原貌以便复核，改了不会生效
   （没有任何活跃代码再 import 它们）。

## 目录结构

```
src/pipeline/_archive/
├── README.md          总台账（本文件，唯一入口，指回各子目录与 src/prompts/_archive/）
├── jrpg/               RPG 精调管线：L0-L5 参考步序基线 + 三个模板定义 + v1/v2 提示词库轴
├── vn-v2/              影游精调管线：steps/vn-v2/ 十一文件 + vn-v2-e2.ts
├── vn-v1/               过时 VN 管线：branch-tree.ts / dialogue-script.ts / cinematic-storyboard.ts
├── specialized/         品类特化能力：card-lore.ts / event-pool.ts / region-design / emergent-event
├── templates/           其余模板定义本体：templates.ts 的 PIPELINE_TEMPLATES
├── planner/             已确认孤儿：planner/ 五个文件
├── universal-agent/     通用三件套框架 + universal-narrative 薄包装（needs 词表已拆去 core/needs.ts）
└── scene/               环节方向错位：scene-generation.ts（前向席装了后向实现）
```

两条精心设计过的管线各占一格：`jrpg/` 与 `vn-v2/`。`jrpg/` 里的东西比 `vn-v2/` 薄得多，
但薄本身是需要登档的结论而不是漏搬——查证结果见 [`jrpg/README.md`](./jrpg/README.md)。

**A1 只立骨架，不搬文件**；**A3 已完成 jrpg 侧的登记与唯一一处真实代码退役**
（v1/v2 提示词库轴，详见 `jrpg/README.md` 第四节）。**C1 已完成 vn-v2 侧的物理
搬迁、四项业务功能吸收与全部引用切断**（详见 [`vn-v2/README.md`](./vn-v2/README.md)）。
**C2 已完成 vn-v1 三 step 的物理搬迁、三项业务功能吸收与全部引用切断**
（详见 [`vn-v1/README.md`](./vn-v1/README.md)）。**C3 已完成四个品类特化能力的
物理搬迁、业务功能吸收（含 needs 门控条件的处理方式）与全部引用切断**
（详见 [`specialized/README.md`](./specialized/README.md)）。**D1 已完成
`templates.ts` 的 `PIPELINE_TEMPLATES` 分流搬迁（三个 RPG 模板→`jrpg/`、两个
VN 模板分别→`vn-v2/`/`vn-v1/`、四个品类特化模板→`specialized/`、其余两个→
`templates/`）与 `planner/` 五个孤儿文件的整体封存**（详见 [`templates/README.md`](./templates/README.md)
与 [`planner/README.md`](./planner/README.md)）。

## 与 docs/legacy-salvage.md 的分工

[`docs/legacy-salvage.md`](../../../docs/legacy-salvage.md) 记录的是**设计判断**——
某项归档形制是否值得吸收、吸收的理由是什么，按"已迁移 / 判断为可用尚未迁移 / 判断为
不迁"三段式组织，早于本台账存在，继续作为 VN 侧设计判断的事实源，不重复搬过来。

本台账记录的是**封存与吸收的操作台账**——东西实际搬到了哪、具体落在新架构哪个槽位、
还有什么留给下一轮判断。两处不重叠：设计判断留在 `legacy-salvage.md`，操作台账留在这里；
`legacy-salvage.md` 已加指针回指本文件，避免后来者只看一处。

**判定规则**（一段旧内容进来按什么顺序问什么问题、四根轴各自决定什么、旧 L0-L5 与新
2.3.x 席位的对应关系）记在 [`docs/absorption-filter.md`](../../../docs/absorption-filter.md)。
本台账只记结果，不复述规则；下一轮吸收前先读那份。

## 台账三列（除已迁移条目沿用 legacy-salvage.md 的判断结论外，本表补三列）

- **封存位置**：搬到了哪个子目录，怎么单跑起来做对照。
- **吸收去处**：具体到新架构里的文件与槽位，例如"机制与流程段 → `plot-generation.ts`
  的 `PromptComposer.cot` 槽"。这是二层吸收时最需要的一列，写不出具体槽位说明
  还没想清楚它到底是业务功能还是运行方式（判定方法见方案第四节）。
- **待二层校对项**：本轮判断"暂时不确定要不要"的细节，留给下一轮筛。

| 归档形制 / 条目 | 封存位置 | 吸收去处（新架构具体槽位） | 待二层校对项 |
| --- | --- | --- | --- |
| `narrative_card`（叙事卡） | 不封存——它已经是唯一手写并跑在 `SingleTurnRunner` 上的 AgentDef，本轮不动 | 已是新架构本体，`steps/narrative-card.ts` | 无 |
| JRPG L0-L5 步序基线（`JRPG_PIPELINE_STEPS`） | **A3 已完成**：冻结为文档快照，`jrpg/README.md` 第一、二节 | 13 步全部已由 `pl-narrative` 覆盖：11 步为通用席位直接覆盖，`scene_generation` 提前到设定层（判为改进非落差），`script_generation`（L4）由 **B1** 补为默认不展开的 `storyboard` 可选终点席 | 无（差异清单已定案，B1 已收口） |
| RPG 三模板（`tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`） | **D1 已完成**：搬入 `jrpg/templates.ts`（`jrpg/README.md` 第三节登记归属） | 三者步序与提示词逐字相同，零条 `SeatBinding` 特化实现，无独立吸收去处 | 无 |
| v1/v2 提示词库轴（`promptLibraryForTemplate`） | **A3 已封存**：函数与类型移入 `jrpg/prompt-library-version.ts` | 已确认未接线，判定不吸收；`RunManifest.promptLibrary` 字段保留（类型改字面量）供读历史 manifest，新建 manifest 固定写 `"v1"` | 无 |
| VN v2 十一 step（`steps/vn-v2/` + `vn-v2-e2.ts`） | **C1 已完成**：搬入 `vn-v2/`（含共享工具 `_shared.ts`/`index.ts`） | **C1 已完成**：四项业务功能逐一落地，详见 [`vn-v2/README.md`](./vn-v2/README.md) 吸收台账（状态自洽→质检席；三维 staging 与确定性场号→`scene-numbering.ts`；对白类型区分→`PlotNode.dialogue_segments.kind`；上传剧本入口→`preference_summary` 席 composer） | 无（C1 已收口，见 `vn-v2/README.md`"待二层校对项"节） |
| VN v1 三 step（`branch_tree` / `dialogue_script` / `cinematic_storyboard`） | **C2 已完成**：搬入 `vn-v1/`（含 `__tests__/`） | **C2 已完成**：分支树 → structure 席 `tree.md` 结构卡；对话脚本 → plot 席；分镜 → storyboard 席，详见 [`vn-v1/README.md`](./vn-v1/README.md) | 无（C2 已收口） |
| 四个品类特化能力（`card_lore` / `event_pool` / `region_design` / `emergent_event`） | **C3 已完成**：搬入 `specialized/`（含 `__tests__/`） | **C3 已完成**：`region_design`/`card_lore` → `lore_generation`；`emergent_event`/`event_pool` → `plot_generation`；形态差异交给 `network.md`/`emergent.md`/`fragmented.md` 结构卡；needs 门控改由品类 skill 选择承担，详见 [`specialized/README.md`](./specialized/README.md) | 无（C3 已收口） |
| `templates.ts` 的 `PIPELINE_TEMPLATES`（两个"其余"模板：`tpl-narrative-card`/`tpl-light`） | **D1 已完成**：搬入 `templates/templates.ts` | 无吸收去处，两个模板都是通用步序，无专属领域知识需要吸收 | 无 |
| `planner/` 五个文件（`planPipeline` 引擎 + presets/needs-rules/dependency-graph/types） | **D1 已完成**：搬入 `planner/`（含 `__tests__/`） | 无吸收去处，全仓零生产调用点，四条席位管线早已接管路由，详见 [`planner/README.md`](./planner/README.md) | 无 |
| 通用三件套框架（`universal-agent/` 五文件 + `agents/universal-narrative.ts`） | 搬入 `universal-agent/`（含 `__tests__/`，本轮） | 无吸收去处：`plan / execute / eval` 三段已由 blueprint 的 `AgentDef` + runner 体系接管（`SingleTurnRunner` / `ChunkedRunner` / `SequenceRunner`），框架的七个 stub step 早已分别封存进 `vn-v1/` 与 `specialized/`，此后活跃路径零引用。唯一没跟着退役的是九维 needs 词表（`NeedsKey` / `NeedsScore` / `NeedsMatrix`）——品类分类表、步骤注册表、agent 契约都还在读它，已拆出为 `core/needs.ts`，本目录的 `types.ts` 改为从那里转出，不留反向依赖 | 无 |
| `scene_generation`（前向席装了后向实现，核心逻辑成死代码） | 搬入 `scene/`（本轮） | 前向那半（worldview fallback）→ `steps/scene-plan.ts`；后向那半（Phase1 分层提炼）→ `steps/scene-evidence.ts`（内容检查席子步）；Phase2 展开 → `script-scene-generation.ts` 内联，取证侧判定不吸收；Phase3 聚合器原地不动，两侧共用。详见 [`scene/README.md`](./scene/README.md) | 无 |

## jrpg 侧特别说明（A3 已定案，详见 `jrpg/README.md`）

`tpl-jrpg-v2` 与 `tpl-jrpg` 共用同一个 `JRPG_PIPELINE_STEPS` 常量，步序逐字相同，
提示词也走同一套 `PromptComposer`；两者唯一差异曾是 `promptLibraryForTemplate` 返回的
一个 manifest 字段（`"v1" | "v2"`），而全库没有任何一处按它分支执行——这条版本轴
已在 A3 判定退役并封存（[`jrpg/README.md`](./jrpg/README.md) 第四节）。已知与 RPG 侧
相关的提示词原貌是
[`src/prompts/_archive/agents-promptresolver/`](../../prompts/_archive/agents-promptresolver/)
里那十五份 md，四期已封存并吸收过其中的机制与流程段。

**结论：RPG 侧封存物很薄，且薄得可疑，这是 A1 初查 + A3 复核两轮独立查证后的确定
结论，不是漏搬。** 唯一的真实缺口曾是 L4（剧本）没有对应的新架构终点，**已由 B1
收口**（`pl-narrative` 新增 `storyboard` 可选终点席，`script` mode 摘出
`LEGACY_STEP_ORDER_MODES`）。
