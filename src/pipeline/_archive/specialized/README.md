# 封存：四个品类特化能力（C3 已完成，2026-08）

本目录是 `region_design` / `emergent_event` / `card_lore` / `event_pool` 四个
universal-agent 驱动、曾以"某模板下的特化"身份存在的品类能力的完整封存件。
约定同 [`../README.md`](../README.md) 第 1-3 条：物理搬迁、写明吸收去处、此后
勿改（没有任何活跃代码再 import 这里的任何文件；改了不会生效）。

## 目录内容

- `region-design.ts`——开放世界 RPG 区域设计（地理/文化/势力/危险等级四要素 +
  区域邻接图去重/对称化/孤岛告警算法）。
- `emergent-event.ts`——4X / 沙盒 / 开放世界共用的涌现性叙事事件模板。
- `card-lore.ts`——CCG 卡牌游戏卡牌叙事 Lore（每张卡片的 flavor/lore + 故事线）。
- `event-pool.ts`——卡牌 / 运营叙事的事件池（daily/weekly/seasonal/story 四池）。
- `__tests__/universal-narrative-specialized.test.ts`——原实现的薄包装单测（从
  `agents/__tests__/universal-narrative.test.ts` 拆出），随实现一并封存，但仍
  随主测试套件跑——纯函数、无外部依赖，继续通过只是证明封存件本身没有腐坏。
- `templates.ts`——**D1（2026-08）新增**：原 `pipeline/templates.ts` 里
  `tpl-open-world` / `tpl-card-game` / `tpl-fragmented` / `tpl-emergent` 四个
  模板定义本体，随「tpl-* 降级封存」搬入。

## 吸收台账（业务功能 vs 运行方式，只吸前者）

这四项本就不该以"某模板下的特化"身份存在（依据叙事结构的定义：作为独立可加载的
prompt，可复用、与游戏品类无关）。

| 业务功能 | 吸收去处 | 说明 |
| --- | --- | --- |
| 区域地理/文化/势力/危险等级四要素、narrative_hooks（`region_design`） | 通用 `lore_generation`（`codex` 席） | 折入 `style_guide`（区域设计风格 + 势力体系守则）与 `constraints`（内容密度守则）；区域邻接图去重/对称化算法属运行方式，不迁 |
| 势力体系、稀有度文本规则、flavor 风格（`card_lore`） | `card-game.skill.ts` 的 `lore_generation` slots（由 `genreCode` 门控） | 折入 `style_guide` 与 `constraints`；`cards`/`lore_arcs` 的独立 JSON 结构不迁，改用 `lore_generation` 固定输出 schema（`lore_fragments`/`item_lore`）承载同等叙事内容。**修正记录**：C3 当时把稀有度档位表与"6-10 个物品叙事、涵盖不同稀有度"留在了 `lore-generation.ts` 的通用基线里，而该席是 `pl-codex` 全 tier3 共用，等于让 RTS / 大逃杀 / 纯益智也吃卡牌 schema；已按吸收滤芯的内容分层轴（[`docs/absorption-filter.md`](../../../../docs/absorption-filter.md)）收进品类 skill，基线只留品类中性的字段要求，`rarity` 在 schema 里降为可选 |
| 事件分类策略、触发/平衡守则（`emergent_event`） | 通用 `plot_generation`（`plot` 席） | 折入 `style_guide`/`constraints`；`events[]` 独立结构不迁，改用 `plot_generation` 的 `plot_nodes` 承载 |
| 运营节奏、奖励曲线、剧情节点规则（`event_pool`） | 通用 `plot_generation`（`plot` 席） | 折入 `style_guide`；`pools.{daily,weekly,seasonal,story}` 四池结构不迁 |
| 形态差异（开放世界 vs CCG vs 涌现叙事 vs 碎片化） | `network.md` / `emergent.md` / `fragmented.md` 结构卡 | 与四个模板一一对应的写作范式差异，不需要独立 step 承载 |
| needs 门控条件（原 `needsKeys`/`minNeed`，如 `region_design` 的 `E>=2 或 Q>=2`） | 品类 skill 选择 + `narrativeSteps` 链构造 | 不引入实例级动态运行时门控；genre 选择即隐含 needs 判断，`lore_generation`/`plot_generation` 对声明了这些 step 的品类始终执行；细粒度 needs 条件作为提示性说明折入 `style_guide`（本轮不追求完全对等） |

## 判断为不迁

`region_design` 的区域邻接图清理算法（去重/删悬空连接/对称化/孤岛告警，纯算法
无 LLM 参与）、`card_lore`/`event_pool`/`emergent_event` 各自的独立 JSON 输出
schema（`cards`/`lore_arcs`/`events`/`pools.*`）——这些是四个特化 step 的运行方式
或数据形状约定，不构成通用叙事原语，不吸收，仅随本目录存档供查证。

## 已切断的引用（C3 逐条清单）

- `assistant-seats.ts`：`scene_list` 席的 `tpl-open-world` `region_design` 绑定、
  `plot` 席的 `tpl-emergent` `emergent_event` 绑定与 `tpl-card-game` `event_pool`
  绑定、`codex` 席的 `tpl-card-game` `card_lore` 绑定全部移除。
- `seat-spec.ts` / `seat-spec.test.ts`：`plot` 席已无落差，对应
  `SHAPE_DIVERGENCES` 登记与 `STILL_DIVERGING` 列表条目移除。
- `modes.ts`：`fragmented` / `card_narrative` / `open_world_narrative` /
  `design_fragmented` 四条 mode 从 `MODE_CONFIGS` 整体摘下；`emergent` /
  `design_emergent` 静态 `steps` 里的 `emergent_event` 换成 `plot_generation`；
  `STEP_OUTPUT_FIELDS` 对应条目保留供历史存档读取。
- `mode-routing.ts`：`LEGACY_STEP_ORDER_MODES` 清空为空对象——四条 mode 的
  "要同时要两个特化实现"病根已随本轮吸收消除。
- `tier-router.ts` / `design-doc.ts`：`getDefaultNarrativeMode`
  的 `fragmented` 分支改回 `narrative_auto`；`getAvailableNarrativeModes`
  摘除已下线的 `fragmented` mode id。
- `step-registrations.ts` / `pipeline.ts`：四步的注册与 `STEP_FNS` 条目移除；
  `pipeline.ts` 的 `extractStepOutput` 仍保留四步的只读分支供旧存档回放。
- `design-steps/auto-narrative-builder.ts`：`buildOpenWorldAutoSteps` /
  `buildCardGameAutoSteps` / `buildEmergentAutoSteps`（`use_legacy_pipeline=true`
  冷路径）改用 `lore_generation`/`plot_generation`，不再产出已下线 step id。
- `knowledge/game-narrative/skills/narrative-steps-defaults.ts`：
  `emergentChain`、`tpl-card-game`/`tpl-open-world` 的 `deriveNarrativeSteps`
  分支改用通用 step id。
- 品类 skill 文件（18 个）：`stepSkills.card_lore`/`region_design` 改挂
  `stepSkills.lore_generation`，`stepSkills.event_pool`/`emergent_event` 改挂
  `stepSkills.plot_generation`；原有独立槽位（`faction_rules`/`density_rules`/
  `rarity_rules`/`category_rules`/`balance_rules`/`pacing_rules`/`reward_rules`
  等）折入 `style_guide` 或 `constraints`。
- 测试侧：`agents/__tests__/universal-narrative.test.ts`
  整个文件（C2 后仅剩本四个 step 的用例）搬进本目录 `__tests__/`；
  `integration-stage-b.test.ts` 移除对四步的直接单测覆盖（改为指向本目录测试）
  并更新 `tpl-card-game`/`tpl-open-world` 路由断言；`pipeline-templates.test.ts` /
  `assistant-seats.test.ts` / `ip-dna/injection/__tests__/seat-ipdna-propagation.test.ts`
  的相关断言改为对齐现状。

## 待二层校对项

- needs 门控从"实例级动态判断"降级为"品类 skill 选择"，未来若某品类需要同一
  step 在不同 needs 组合下产出不同详略程度的内容，需要重新设计（本轮明确判定
  为超出范围的权衡，见方案正文）。

参见总台账：[`../README.md`](../README.md)。
