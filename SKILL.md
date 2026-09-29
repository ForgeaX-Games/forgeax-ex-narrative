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

## 工具集（共 40 个，按用途分组）

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
| `narrative:create-entry` | 建/改条目 —— 与界面入口节点同一份 `_entry.json`；**先建条目再带 `entryKey` 开跑** | `key`(必填), 其余路由参数可选 |
| `narrative:run-seat` | 只跑二十席里的**一席**，不走整条管线；给 `entryKey` 才落盘 | `seatId`(必填), `userInput?`, `inputs?`, `entryKey?` |

### 填参前先查（避免瞎猜 code 与席位 id）

| tool id | 用途 |
|---|---|
| `narrative:list-genres` | 全部品类：`code` / 名称 / tier / 叙事比重 / 模板 —— 填 `genreCode` 前必查 |
| `narrative:list-modes` | 各 tier 可用的运行模式 / 模板及步骤数 |
| `narrative:list-axes` | 三轴词表（叙事类型 / 题材 / 结构）—— 填 `storyType`、`storyTheme` 前必查 |
| `narrative:list-seats` | 二十席清单：`id` / kind / `canRunStandalone` / 单跑还缺什么输入 —— 调 `run-seat` 前必查 |

### 定稿与专属团队

| tool id | 用途 |
|---|---|
| `narrative:list-assets` | 列某条目里作者**已确认定稿**的产物 —— 下游生成只该引用这张表里的文件 |
| `narrative:confirm-asset` | 确认 / 撤销确认一份产物，可钉版本号（缺省跟随最新） |
| `narrative:list-teams` | 列自定义专属创作团队；只有 `ready` 的能带进生成 |
| `narrative:get-team` | 看某团队的蒸馏状态 / 风格签名 / 禁区 / 各席技能 |

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

### 读产物 / 改稿 / 评审

| tool id | 用途 |
|---|---|
| `narrative:list-files` / `read-file` | 列某次运行的产出文件 / 读其中一份（自动截断防爆上下文） |
| `narrative:get-story-tree` | 读叙事树结构（分层节点），把握整体骨架 |
| `narrative:get-pipeline-nodes` | 读**活动中** run 的各步节点与状态（内存态，重启即失效） |
| `narrative:get-ip-dna` | 按 runId 读 IP DNA 层级树摘要 |
| `narrative:save-step-edit` | 改稿落盘（与界面文本视图同一端点）；原稿自动存 `_original/`；**省略 `editedContent` 就只回读不写盘** |
| `narrative:restore-original` | 把某步/某节点还原为模型原稿，并撤掉编辑账本那一条 |
| `narrative:get-stale-steps` | 给定起始步，列出会因其变更而过期、需重生成的下游 |
| `narrative:analyze-impact` | 重生成**前**预判：对若干拟改动做差异 + 影响面分析 |
| `narrative:get-review` / `set-review` | 读 / 写各步的人工评审结论（`approved` / `rejected` / `pending`）与反馈 |

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

## 对话里的 `@` 引用（narrative-ref）

用户可以从叙事界面把一样东西 `@` 进对话栏。插进来的文本形如：

```
@叙事生成配置助手（入口） [narrative-ref kind=entry entry=new · settle the requirement with …]
```

方括号里是**给你看的**机器载荷（键名固定 ASCII，不随界面语言变），三类：

| `kind` | 用户指的是 | 你该做什么 |
|---|---|---|
| `entry` | 一个任务的初始需求 | `entry=new` → 问清需求后 `create-entry`（不传 `key`）；`entry=<key>` → 带该 `key` 改这条。**先把需求与路由定下来并让用户确认，再谈开跑** |
| `role` | 一位席位 / 品类专家 / 自定义团队成员 | 按 `catalog` / `step` / `strategy` / `team` 调对应的 `narrative:*`（`start-pipeline` / `regenerate-step` / `ip-dna-*`） |
| `artifact` | 一份落盘产物 | `narrative:read-file({ runId: <sourceDir>, filePath: <path> })` |

`kind=entry` 与用户直接打一段需求进对话栏，在「新任务」这一情形下是同一件事。它多说
的是另外两件裸文本说不清的：这一轮要**另起一个任务**（`entry=new`），还是要**回去改
某个已有任务**的初始需求（`entry=<key>`）。这也是 `create-entry` 的必填项只有 `key`
的原因。

引用与节点画布上的入口是**同一把键权**，落的是同一份 `_entry.json`：画布经
`/entry/start` 写，你经 `create-entry` 写。所以不要在 `create-entry` 之外另造一份配置。

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

作为平台扩展运行时（你看到这份 skill 就是这种情形），所有导出资产落到 host project root 下的
`.forgeax/games/<slug>/narrative/`；同一份代码独立运行时落 `process.cwd()/output`，
两者是**两份独立磁盘目录**（判定在 `src/runtime/artifact-root.ts`，README 有专节）。包含：

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
