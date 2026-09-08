# 归档：已确认孤儿 planner/（D1，2026-08）

## 本目录内容

原活跃 `src/pipeline/planner/` 的五个文件，原样搬入：

| 文件 | 原职责 |
| --- | --- |
| `index.ts` | `planPipeline()` 主入口：pipelineTemplate 预置优先 → needs 通用规则兜底 |
| `types.ts` | `PlannerInput` / `PlannerOutput` / `PresetConfig` 类型 |
| `presets.ts` | `PIPELINE_PRESETS`：9 个 buildXxxAutoSteps 逻辑的声明式数据版本 |
| `needs-rules.ts` | Step 2 兜底：纯 needs 矩阵阈值选择步骤 |
| `dependency-graph.ts` | 从 `STEP_REGISTRY.dependsOn` 建图做拓扑排序 |

以及原本依赖 `planPipeline()` 的两个测试文件（搬进 `__tests__/`）：
`planner-genre-coverage.test.ts`（整体搬入）、
`genre-package-jrpg-planner.test.ts`（从 `genre-package-jrpg.test.ts` 里只
提取了依赖 `planPipeline` 的那一个用例，其余三个与 planner 无关的用例仍留在
原文件继续跑）。

## 为什么是"已确认孤儿"而不是"待吸收"

这是本轮唯一一处**不需要业务功能吸收**的封存——查证结论是 `planPipeline()`
全仓零生产调用点：

- `pipeline.ts` 与 `api/server.ts` 各曾留一条
  `import { planPipeline } from "./planner/index.js"`，但函数体从未在这两个
  文件里被真正调用过（`grep planPipeline\(` 全仓命中只有 `planner/index.ts`
  自身的函数定义与已随本次一并封存的两个测试文件）。两处 dead import 已随
  本次封存删除。
- 生产路由早已由四条席位管线接管：`resolveSeatStepGroups`（`narrative_auto`
  入口）与 `resolveModeStepGroups`（静态 mode 入口，见 `mode-routing.ts` 的
  `isSeatRoutedMode`）。`planPipeline` 是四期换架构前"按品类家族现算步序"的
  实现，被取代后没人摘掉引用，属于纯粹的技术债，不是"业务功能未吸收"。
- `design-steps/auto-narrative-builder.ts` 里两处过时注释（"@deprecated 使用
  planPipeline() 替代"、"生产路径全部走 planPipeline() 的通用席位路由"）已随
  本次封存订正为指向实际生效的四条席位管线。

## 吸收去处

**无需吸收。** `planPipeline` 的两条决策逻辑在新架构里已有对应但不同源的
实现，不是同一份领域知识换个位置：

- "pipelineTemplate 预置优先"→ 新架构里对应的是四条席位管线的静态步序
  （`narrative-pipelines.ts`），事实源是叙事策划专家组 CSV，不是
  `PIPELINE_PRESETS` 那张表。
- "needs 通用规则兜底"（`needs-rules.ts` 的十条阈值规则）在新架构里对应
  `design_auto` 的 D0-D4 动态展开与品类 skill 的 `narrativeSteps` 声明，两者
  独立发展，没有从 `NEEDS_RULES` 迁移过任何一条阈值。

## 待二层校对项

无。

参见总台账：[`../README.md`](../README.md)。
