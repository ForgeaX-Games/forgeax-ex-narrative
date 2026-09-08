# 封存：RPG 精调管线（A3 查证 + D1 实体搬迁，2026-08）

A3 查证结果是 RPG 侧根本没有可搬的品类特化实现（见下方「查证结论」）——A3 阶段
本目录**不搬运任何 `.ts` 实体文件**，只承载查证本身：把 `JRPG_PIPELINE_STEPS`
冻结为文字基线，附一份与 `pl-narrative` 的逐项差异清单，供后续判断"新链是否
真的覆盖了老链"。

**D1（2026-08）已完成实体搬迁**：`templates.ts` 里的 `JRPG_PIPELINE_STEPS` 常量与
三个模板定义（`tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`）已从活跃 `pipeline/templates.ts`
搬入本目录的 [`templates.ts`](./templates.ts)，`expert-agents.test.ts` 里唯一依赖
`JRPG_PIPELINE_STEPS` 的用例也一并迁入 [`__tests__/expert-agents-jrpg-legacy.test.ts`](./__tests__/expert-agents-jrpg-legacy.test.ts)。
活跃代码只保留 `PipelineTemplateId` 类型与历史 checkpoint 读取键所需的最小面，
详见总台账 [`../README.md`](../README.md)。

## 一、L0-L5 参考基线（冻结快照，2026-08 查证时的 `JRPG_PIPELINE_STEPS`）

`JRPG_PIPELINE_STEPS`（`templates.ts:59`）展开后是 13 个不同 step id（方案原文称"十四步"，
是把"L0-L4"与"L5 任务∥场景"的口语计数方式相加时的表述差异，实际枚举见下表，不影响
差异判断本身）：

| # | step id | 别名 | 说明 |
| --- | --- | --- | --- |
| 1 | `preference_summary` | 偏好①  | 用户偏好总结 |
| 2 | `preference_analysis` | 偏好② | 偏好结构化分析 |
| 3 | `initial_plan` | 初步方案 | 策划文档 |
| 4 | `worldview` | 世界观 | 世界观设定 |
| 5 | `character_enrichment` | 角色 | 角色档案（并行体，见 `seat-agents.ts` 的 parallel 下沉说明） |
| 6 | `item_database` | 道具 | 道具清单 |
| 7 | `story_framework` | L0 | 故事大纲 |
| 8 | `outline_batch` | L1 | 故事结构（批量） |
| 9 | `detailed_outline` | L2 | 故事结构（详细展开） |
| 10 | `plot_generation` | L3 | 故事情节 |
| 11 | `script_generation` | L4 | 剧本 |
| 12 | `quest_generation` | L5a | 任务（与 L5b 并行） |
| 13 | `scene_generation` | L5b | 场景（与 L5a 并行，收尾档） |

三个模板（`tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`）的 `steps` 字段都是
`[...JRPG_PIPELINE_STEPS]`，逐字相同（`templates.ts:81,90,99`）。

## 二、与 `pl-narrative` 的差异清单

用 `expandPipelineSteps(NARRATIVE_PIPELINES["pl-narrative"])` 实测展开（`narrative-pipelines.ts`
+ `assistant-seats.ts` 的席位实现解析，2026-08 查证时点）得到：

```
preference_summary, preference_analysis, initial_plan, worldview,
character_enrichment, item_database, scene_generation, story_framework,
outline_batch, detailed_outline, plot_generation, quest_generation,
structure_check, content_check
```

14 步，与 L0-L5 基线逐项对比：

| 差异点 | L0-L5 基线（旧） | `pl-narrative`（新） | 判断 |
| --- | --- | --- | --- |
| 质检 | 无 | 新增 `structure_check` + `content_check` 两席，跑在交付席之后 | 新增能力，非落差 |
| `scene_generation` 位置 | 排在 L5，与 `quest_generation` 并行，是全管线倒数第二步 | 紧跟 `item_database`，排在 `story_framework`（L0）之前，属于设定层 | 品类无关的通用判断——场景列表本就该与世界观/角色/道具同层先行给出，供叙事层引用，而非等叙事写完再补 |
| `script_generation`（L4） | 有，紧跟 `plot_generation`（L3）之后 | **B1 已补齐**——`pl-narrative` 新增 `storyboard` 作为默认不展开的可选终点席，实现即 `script_generation` | 缺口已收口，见下条 |
| 交付席 | 全量跑完落在 L5（`quest_generation` ∥ `scene_generation`），但存在只跑到 L4 的"剧本"截断形态（`mode-routing.ts` 的 `LEGACY_STEP_ORDER_MODES.script`） | 默认交付席仍是 `quest_generation`（任务）；`script` mode 的 `target_endpoint` 命中 `storyboard` 时由 `mode-routing.ts` 临时激活，止于剧本 | **B1 已收口**：`script` 已从 `LEGACY_STEP_ORDER_MODES` 摘除，不再需要 `tpl-jrpg-v2` 旧步序兜底 |
| 并行体下沉 | `character_enrichment` 是单条目 | 同一 id，`seat-agents.ts` 用 `AGENT_TYPE_DOWNSHIFT` 把它下沉为 `parallel` 原语 | 实现细节升级，产物形状不变，非落差 |
| `outline_batch` → `detailed_outline` | 两条独立 step | 同两个 id，由 `structure` 席位收敛成一个 `serial` 复合体对外暴露 | 同上，非落差 |

**结论**：新旧两条链在"设定层 + 叙事层 + 任务"这条主干上等价（`scene_generation`
提前不是回归，是通用层的更优判断），唯一真实缺口曾是 **L4（剧本）没有对应的新架构
终点**，使 `script` mode 一度要靠 `LEGACY_STEP_ORDER_MODES` 里的旧步序兜底。

**B1（2026-08）已收口**：给 `pl-narrative` 加了一个默认不启用的 `storyboard`
（分镜助手，其通用实现就是 `script_generation`，与影游线共用同一席位定义）作为
`optionalSeats` 可选终点，`mode-routing.ts` 的 `resolveModeStepGroups` 依据
`target_endpoint` 反查所属席位后临时激活；`script` mode 已从
`LEGACY_STEP_ORDER_MODES` 摘除，改走四条 `pl-*` 管线之一。

同批顺带处理了同样卡在 `LEGACY_STEP_ORDER_MODES` 里的 `scene`（表中原第一条，
理由是"任务 + 场景节点"语义要跑完叙事层再出场景，但 `scene_generation` 在新
架构里已提前到设定层，若仍按它自己的下标切片会把叙事层与任务整段切掉）。
处置：`mode-routing.ts` 新增 `CUTOFF_SEAT_OVERRIDE` 白名单，`scene_generation`
→ `quest` 席，把"下标切片"换成"截断到指定席位的最后一步"，不再依赖
`scene_generation` 自己在展开步序里的位置；`scene` 已从 `LEGACY_STEP_ORDER_MODES`
摘除。`scene_generation` 本身仍在产出集合里（设定层强制成员），只是不再是末位。

## 三、三个 RPG 模板的封存归属登记

| 模板 id | 归属判断 | 依据 |
| --- | --- | --- |
| `tpl-jrpg` | 新架构朴素代号，历史 checkpoint 读取键 | `PipelineTemplateId` 注释：「新架构 JRPG 预制管线」 |
| `tpl-jrpg-v2` | 封存快照，历史 checkpoint 读取键 | 与 `tpl-jrpg` 步序逐字相同，唯一差异是下面第四节的 manifest 字段 |
| `tpl-rpg` | `tpl-jrpg-v2` 的废弃别名，历史 checkpoint / genre 映射兼容 | 源码注释已标 `[DEPRECATED alias] = tpl-jrpg-v2` |

三者都**没有**对应的 `SeatBinding.scope` 特化实现——搜索 `assistant-seats.ts` 全部
`SeatBinding` 与 `KNOWN_SEAT_GRAPH_DIVERGENCES`，两张表里出现的作用域全部是
`tpl-vn-v2` / `tpl-vn` / `tpl-emergent` / `tpl-card-game` / `design_auto`，
零条目挂 `tpl-jrpg` / `tpl-jrpg-v2` / `tpl-rpg`。RPG 全部十三步在生产环境跑的都是
通用（无 scope）实现，三个模板名义上的差异只剩下第四节这一个从未被读取的 manifest 字段。

**结论：RPG 侧封存物很薄，且薄得可疑，但这是两轮独立查证（A1 初查 + A3 复核）后的
确定结论，不是漏搬。** 三个模板的实体定义已随 **D1** 从 `templates.ts` 搬入本目录的
[`templates.ts`](./templates.ts)。

## 四、v1/v2 提示词库轴处置：退役并封存（A3 已执行）

**判定：退役**。理由：

1. `promptLibraryForTemplate`（原 `src/types/run-manifest.ts`）纯按字符串后缀分支
   （`-v2` 或 `tpl-rpg` → `"v2"`，其余 → `"v1"`），而三个 RPG 模板的 `steps` 与
   `PromptComposer` 是同一份——**没有第二套提示词内容与它对应**。
2. 全仓搜索 `.promptLibrary` 的读取点：只有构建 manifest 的两处写入
   （`run-manifest-builder.ts` / `run-manifest-runtime.ts`）与测试断言，
   **没有任何生产逻辑按这个字段分支**——它是写入即忘的死数据。
3. 与之相关的、真正存在内容差异的提示词原貌是
   [`src/prompts/_archive/agents-promptresolver/`](../../../prompts/_archive/agents-promptresolver/)
   里那十五份 md，四期已封存并吸收过其中的机制与流程段；`promptLibraryForTemplate`
   这条版本轴与那次封存无关，是后来 M2 阶段为 manifest 契约新增、但从未真正接线的字段。

**已执行的处置**（字段保留读历史，函数与类型封存）：

- `PromptLibraryVersion` 类型与 `promptLibraryForTemplate` 函数从
  `src/types/run-manifest.ts` 移入本目录 [`prompt-library-version.ts`](./prompt-library-version.ts)，
  仅供复核，不再被任何活跃代码 import。
- `RunManifest.promptLibrary` 字段**保留**，类型改写为字面量 `"v1" | "v2"`
  （不再依赖被封存的具名类型），使已落盘的历史 manifest（可能带 `"v2"`）仍能被
  正常读取与类型检查通过。
- 两处写入点（`run-manifest-builder.ts` / `run-manifest-runtime.ts`）改为固定写
  `"v1"`——新建 manifest 不再产出 `"v2"`，因为已确认没有与之对应的第二套提示词。
- `agent-contract.ts` 的 `REQUIREMENT_FIELD_MATRIX` 摘掉"双版本提示词库…由管线代号
  路由"这一条需求登记（它描述的能力已确认不存在），`agent-contract.test.ts` 里
  直接测试 `promptLibraryForTemplate` 的用例随函数一并移除。

参见总台账：[`../README.md`](../README.md)，双命名空间定案见
[`docs/contracts.md` §4.2a](../../../docs/contracts.md)。
