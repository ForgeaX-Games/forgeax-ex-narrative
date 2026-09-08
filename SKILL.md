---
name: narrative:author-guide
description: 叙事管线 AI 调用指南
trigger: /narrative
---

# Narrative Studio · AI Skill

`@forgeax-extension/narrative` 是一个 AI 驱动的游戏叙事生成管线。覆盖 117 种游戏品类，通过 Tier/Mode 双层路由 + Planner 动态选步，自动选择 9 种管线模板之一，生成从世界观到剧本的完整叙事资产。

## 管线概览

**双层路由 + Planner**：117 品类 → 4 个 Tier（叙事强度）→ 29 种 Mode（步骤序列）→ 9 种管线模板 / 6 种叙事原型

默认行为：所有 Tier 走 `design_auto`（先跑策划 D0-D4，再根据需求矩阵动态追加叙事步骤）。

## 工具集（共 30 个，按用途分组）

### 核心叙事管线（最常用）

| tool id | 用途 | 关键 args |
|---|---|---|
| `narrative:start-pipeline` | 启动叙事管线 | `userInput`(必填), `tier?`, `mode?`, `genreCode?`, `complexity?` |
| `narrative:resume-pipeline` | 断点续传 | `entryKey` |
| `narrative:get-run-status` | 查询运行状态与结果 | `runId`, `includeResult?` |
| `narrative:list-runs` | 列出历史运行记录 | 无必填 |
| `narrative:cancel-run` | 取消正在运行的管线 | `runId` |
| `narrative:regenerate-step` | 重生成指定步骤 | `sourceDir`, `fromStepId`, `userInstructions?` |
| `narrative:export-result` | 导出结果到项目目录 | `runId`, `slug?`, `targetDir?` |
| `narrative:load-history` | 加载某次运行完整结果 | `key` |

### IP DNA 改编生成（从已有 IP 作品生成，见 README 同名章节）

| tool id | 用途 | 关键 args |
|---|---|---|
| `narrative:ip-dna-start` | **全自动**改编：上传→标准化→提取→生成一路直跑 | `files`(必填), `mode?`, `genreCode?`, `generationMode?` |
| `narrative:ip-dna-ingest` | **半自动**：仅摄入 + 标准化建树 | `files`(必填), `async?`, `decompose?` |
| `narrative:ip-dna-get-hierarchy` | 取层级树 + 体量 + 默认改编范围 | `runId` |
| `narrative:ip-dna-decompose` | 超体量再标准化 | `runId` |
| `narrative:ip-dna-confirm-scope` | 确认改编范围 | `runId`, `scopeFull?` / `scopeSelections?` |
| `narrative:ip-dna-confirm-units` | 确认游戏单元划分 | `runId`, `gameUnitPlan` |
| `narrative:ip-dna-extract` | 生成 scoped IP DNA（三件套） | `runId` |
| `narrative:ip-dna-generate` | 用 scoped IP DNA 驱动下游生成 | `runId` |
| `narrative:ip-dna-get-job` / `ip-dna-cancel` | 异步任务状态查询 / 取消 | `jobId` |
| `narrative:ip-dna-analyze-impact` | IP DNA 编辑影响面分析 | `runId` |

### 查询 / 文件 / 编辑辅助

`narrative:list-modes`、`list-genres`、`get-pipeline-nodes`、`get-story-tree`、`get-ip-dna`、`list-files`、`read-file`、`analyze-impact`、`get-stale-steps`、`get-review`、`set-review`。

## 意图→路由决策表

| 用户意图 | routeGroup | mode | 说明 |
|---|---|---|---|
| "帮我做个游戏策划" | planning | `design_auto` | 策划全量入口，先跑 D0-D4 再自动追加叙事 |
| "帮我写个故事/叙事" | narrative | `narrative_auto` | 叙事单品入口，自动识别品类 |
| "帮我写个大纲" | narrative | `initial_outline` | 仅大纲 |
| "帮我设计世界观" | narrative | `worldview` | 仅世界观 |
| "帮我写角色/人物" | narrative | `character` | 仅角色档案 |
| "帮我写道具" | narrative | `item_lore` | 仅道具 |
| "帮我写剧本/叙事" | narrative | `script` | RPG 叙事链 L0-L4 |
| "帮我设计任务" | narrative | `quest` | RPG L5 任务图 |
| "帮我设计场景" | narrative | `scene` | 场景节点 |
| "帮我写互动影游剧本" | narrative | `vn_script` | 影游剧本（止于 G-02 剧本创作） |
| "帮我做互动影游分镜" | narrative | `vn_storyboard_mode` | 影游分镜（含 G-03 分镜设计） |
| "帮我做一个赛博朋克 RPG" | planning | `design_auto` + genreCode | 指定品类走策划全量 |

## 调用前须知

1. **先检查并发**：调 `narrative:list-runs` 确认没有 `status: "running"` 的管线 —— 同一时刻只能跑 1 个。
2. **推荐全自动**：不指定 `tier` / `mode` / `genreCode` 时走全自动路由（LLM 自动识别品类），这是推荐做法。
3. **异步运行**：`start-pipeline` 返回 `runId` 后管线异步执行，需轮询 `get-run-status` 直到 `status` 变为 `completed` 或 `failed`。
4. **结果获取**：`get-run-status(runId, includeResult=true)` 在完成时一次性返回完整 `NarrativeContext`。
5. **重生成需源目录**：`regenerate-step` 需要 `sourceDir`（从 `list-runs` 的 `key` 字段获取）和 `fromStepId`。

## 常见调用组合

### 全自动生成（推荐）

```
narrative:start-pipeline({ userInput: "一个赛博朋克背景的 JRPG" })
  → { id: "run_...", status: "running" }
narrative:get-run-status({ runId: "run_...", includeResult: true })
  → 轮询直到 status === "completed"
narrative:export-result({ runId: "run_...", slug: "cyber-jrpg" })
  → 导出到 .forgeax/games/cyber-jrpg/narrative/
```

### 指定品类

```
narrative:start-pipeline({ userInput: "...", genreCode: "rpg-jrpg" })
```

跳过 LLM 品类识别，直接用 JRPG 模板和 skill。

### 重生成某步骤

```
narrative:regenerate-step({
  sourceDir: "2026-05-25_143200_abc",
  fromStepId: "story_framework",
  userInstructions: "增加更多分支选择"
})
```

从 `story_framework` 步骤开始重新生成，保留之前步骤的结果。

## Tier 路由简表

| Tier | 叙事占比 | 默认模板 | 品类示例 |
|---|---|---|---|
| tier1 | 70-95% | tpl-rpg | JRPG, CRPG, VN, 互动影游 |
| tier2 | 40-70% | tpl-rpg | ARPG, MMORPG, 策略, 卡牌 |
| tier3 | 15-40% | tpl-light | 塔防, BR, 休闲, RTS |
| tier4 | 0-15% | tpl-narrative-card | 三消, 纯音游, 超休闲 |

### 9 种管线模板

| 模板 ID | 适用场景 | 步骤数 |
|---|---|---|
| `tpl-rpg` | RPG 标准全链（L0-L5） | 15+ |
| `tpl-vn-v2` | 互动影游（分幕/场/拍/分支/剧本/分镜） | 9 |
| `tpl-vn` | 视觉小说 v1（分支+对话） | 5 |
| `tpl-open-world` | 开放世界（区域+涌现） | 5 |
| `tpl-card-game` | 卡牌（卡面叙事+事件池） | 4 |
| `tpl-fragmented` | 碎片化叙事（魂系/银河城） | 4 |
| `tpl-emergent` | 涌现叙事（4X/沙盒） | 3 |
| `tpl-light` | Tier3 轻量（基础+角色+文案） | 4 |
| `tpl-narrative-card` | Tier4 叙事卡（单步） | 1 |

## 失败兜底

- **409 conflict** → 已有管线在运行，先 `cancel-run` 或等待完成。
- **400 bad request** → 检查 `userInput` 是否为空。
- **管线 failed** → `get-run-status` 的 `error` 字段有失败原因。可尝试 `regenerate-step` 从失败步骤前的最后成功步骤重新开始。
- **API 不可达** → 叙事服务未启动，提醒用户运行 `npm run start`（端口 8900）。

## 写入约定

所有导出资产落到 host project root 下的 `.forgeax/games/<slug>/narrative/`。包含：

- 按步骤编号的 markdown / json 文件（如 `01_worldview.md`、`03_story_framework.json`）
- `full_result.json`（完整 NarrativeContext 快照）
- `manifest.json`（运行元数据）

读现状用 `narrative:list-runs` + `narrative:get-run-status`，别直接 fs.read —— 走 tool RPC 保证 host 和 AI 看到同一份。

## Surface 视角（DUAL-MODALITY）

本插件注册了两个 surface 让 AI 感知玩家当前在 UI 里的状态：

### `narrative.control`（左侧配置面板）

快照字段：`tier`（当前 Tier 选择）、`mode`（当前 Mode）、`autoDetect`（是否自动识别）、`userInput`（输入框内容）、`runningRunId`（正在跑的 run ID）、`runningEntryKey`（正在跑的目录 key）。

AI 听到"帮我生成一个故事"时，先查 `narrative.control` snapshot —— 如果 `runningRunId` 非空说明已有管线在跑，不要重复启动。

### `narrative.pipeline`（中央步骤面板）

快照字段：`steps[]`（各步骤 id/label/status/data）、`activeEntryKey`（当前查看的历史 entry）、`activeEntryStatus`（状态）、`pipelineOrder`（步骤执行顺序）、`editDrafts`（用户编辑的草稿）。

AI 听到"把这个世界观改一下"时，查 `editDrafts` 是否已有用户草稿 —— 有则走 `regenerate-step` 并注入用户修改。

两个 surface 的 action（start/cancel/load-history 和 regenerate/export/focus-step）与同名 tool 语义对应；走 surface dispatch 会同步更新 UI 状态。
