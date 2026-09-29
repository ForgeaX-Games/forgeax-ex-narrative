---
name: narrative-workshop
description: Generate game narrative — world, factions, characters, plot, quest text and IP adaptation — through the Narrative Workshop. Use when the user wants story, setting or character content for a game.
---

# Narrative workshop

The workshop is a local service with a browser authoring UI. Run these commands
from the game directory; the command is pinned to this installation.

## Getting it running

1. Check setup first: `{{CLI}} doctor --json`. Read `ok`, `service` and `credentialSource`.
2. If `service` is null, start it: `{{CLI}} start --json`. First start may take a
   minute while the service package is fetched.
3. Give the user the address: `{{CLI}} open --json` returns `url`.
   **Offer the address and let the user decide** — do not announce that you are
   navigating for them, and do not treat opening the UI as a completed task.
4. When the user is done, `{{CLI}} stop --json`. The service also ends itself
   after an idle period, so a forgotten workshop does not run forever.

## Where the model credential comes from

`doctor` reports `credentialSource`, resolved in this order:

| `credentialSource` | Meaning |
|---|---|
| `narrative` | A key configured for this extension. Full quality. |
| `engine` | Borrowed from the ForgeaX Engine gateway already in the environment. Full quality. |
| `platform` | No key found; the workshop borrows the host agent's model. `degraded` is true. |

When `degraded` is true, say so before generating: output quality differs from a
configured key. To configure one, the user pipes it in:
`printenv MY_KEY | {{CLI}} enable --with-key-stdin`.
Never read, echo or log the key itself.

## Authoring

The browser UI is the primary surface for authoring: tag selection, file upload,
IP scope confirmation and review are interactive steps a person does there. Prefer
sending the user to the UI for those. Use the operations below when the user asks
you to drive the workshop directly.

<!-- TOOLS:BEGIN -->
- `analyze-impact` — 重生成前预判:对若干节点的拟改动做差异+影响分析,返回受影响范围
  必填 sourceDir, modifications
- `cancel-run` — 取消/暂停正在运行的管线 · 已跑完的步保留断点，随后可用 resume-pipeline 续跑
  必填 runId
- `confirm-asset` — 确认或撤销确认一份产物 · 可钉住版本号（缺省跟随最新）
  必填 entryKey, path；可选 pipelineId, version, confirmed
- `create-entry` — 建/改条目 · 与节点入口同一份 _entry.json · 先建条目再带 entryKey 开跑
  必填 key；可选 inputType, userInput, tags, routeGroup, tier, mode, genreCode, storyType, storyTheme, complexity, locale
- `export-result` — 导出叙事结果到项目目录
  必填 runId；可选 slug, targetDir
- `get-ip-dna` — 只读:按 runId 读取 IP DNA 层级树摘要(节点/层级/标题),用于审阅与可视化
  必填 runId
- `get-pipeline-nodes` — 读取正在运行的管线各步骤节点及状态(仅对内存中活动 run 有效)
  必填 runId
- `get-review` — 读取某次运行的评审状态(各步骤 approved/rejected/反馈)
  必填 dir
- `get-run-status` — 查询管线运行状态 · 步骤进度 · 结果获取
  必填 runId；可选 includeResult
- `get-stale-steps` — 给定起始步骤,返回会因其变更而过期、需重生成的下游步骤与字段
  必填 sourceDir, fromStepId
- `get-story-tree` — 读取某次运行的叙事树结构(分层节点),用于把握整体故事骨架
  必填 dir
- `get-team` — 查看某个专属团队 · 蒸馏状态与风格签名 / 禁区 / 各席位技能
  必填 teamId
- `ip-dna-analyze-impact` — IP DNA 改写影响面分析(蓝图§10/§15):给定改动字段,沿 data-atlas 推导受影响下游与输入层级节点
  必填 runId, changedKeys
- `ip-dna-cancel` — 取消生产(§5.1):取消正在运行的 IP DNA 异步任务(与前端「取消生成」按钮能力对等)
  必填 jobId
- `ip-dna-confirm-scope` — 确认裁剪范围(§4.4 第①步):回填嵌套层级选择;缺省=全量。确认门终点
  必填 runId；可选 scopeSelections, scopeFull, adaptationNotes
- `ip-dna-confirm-units` — 确认游戏单元 + 改编维度(§4.4 第②③步):回填 game_unit_plan/adaptation_dimensions/mode
  必填 runId；可选 gameUnitPlan, adaptationDimensions, mode, targetUnits
- `ip-dna-decompose` — IP 半自动(§5 步骤6-10):体量超线时按标记/单元闭环拆解→再标准化→重写骨架层级树
  必填 runId
- `ip-dna-extract` — 生成 scoped IP DNA(§5 步骤4):仅提取不跑下游生成,消费已确认裁剪范围/单元/维度
  必填 runId；可选 pipelineFamily, tier, generationMode, complexity, maxGameUnits, equipOperators, model, async
- `ip-dna-generate` — 开始生成(§5 步骤4→5):提取(=生成 scoped IP DNA)+下游叙事生成自动串跑。改编范围确认后触发,中途不暂停
  必填 runId；可选 pipelineFamily, tier, generationMode, complexity, maxGameUnits, equipOperators, model, async
- `ip-dna-get-hierarchy` — 只读:摄入后的层级树 + 默认裁剪/单元/维度 + 体量,供确认裁剪范围引导(半自动/agent 共用)
  必填 runId
- `ip-dna-get-job` — 轮询异步任务(ingest/extract/generate)的状态/进度/结果
  必填 jobId
- `ip-dna-ingest` — IP 半自动阶段门①(§5.1):摄入+标准化+建树(含干扰项过滤),停在确认裁剪范围前。返回层级树骨架+体量/拆解建议+默认裁剪/单元/维度
  必填 files；可选 title, decompose, model, async, storyTimestamp
- `ip-dna-start` — IP DNA 端到端入口(蓝图§5):上传/指定全模态 IP 文件 → 理解 → 改编 → (可选)全品类游戏叙事生成。可能较久,默认仅产出 IP DNA+改编指令+生成输入
  必填 files；可选 title, mode, scopeSelections, gameUnitPlan, adaptationDimensions, adaptationNotes, targetUnits, complexity, runGeneration, maxGameUnits, pipelineFamily, tier, generationMode, routeGroup, genreCode, model
- `list-assets` — 列出某条目里作者已确认为定稿的产物 · 下游生成只引用这张表里的文件
  必填 entryKey；可选 pipelineId
- `list-axes` — 三轴词表 · 叙事类型 / 题材 / 结构 · 填 storyType 与 storyTheme 前先查
  无必填参数
- `list-files` — 列出某次运行(runId 或输出目录名)的全部产出文件
  必填 runId
- `list-genres` — 列出全部游戏品类(按大类分组,含 code/名称/tier/叙事比重/模板),选 genreCode 前先查
  无必填参数
- `list-modes` — 列出各 tier 可用的运行模式/模板及步骤数
  无必填参数
- `list-runs` — 列出历史运行记录 · 支持断点续跑与分叉重生成
  无必填参数；可选 limit
- `list-seats` — 列出全部二十席叙事单品助手 · id/名称/kind/是否能被单独调用(canRunStandalone)/单跑前还缺什么输入
  无必填参数
- `list-teams` — 列出自定义专属创作团队 · 单本模板助手与作家创作顾问 · 只有 ready 的能带进生成
  无必填参数
- `load-history` — 加载某条历史运行记录的详情(拿到 tier/mode/result 及目录名,供后续续跑/编辑)
  必填 key
- `read-file` — 读取某次运行下指定相对路径的产出文件内容(json/文本,自动截断防爆上下文)
  必填 runId, filePath
- `regenerate-step` — 重生成指定步骤 · 支持用户指令注入与节点级过滤
  必填 sourceDir, fromStepId；可选 userInstructions, stopAfterStep, model, skipSteps, nodeFilter, editDrafts
- `restore-original` — 把某一步(或某个节点)的内容还原为模型原稿，撤掉编辑账本里那一条 · 没存过原稿则报错
  必填 sourceDir, stepId；可选 nodeId
- `resume-pipeline` — 从 checkpoint 断点续跑某次未完成的运行(写入同一目录)
  必填 dir；可选 model
- `run-seat` — 按席位 id 单独跑一个叙事单品助手(二十席之一) · 不遍历全管线 · 给 entryKey 可并入该条目落盘供后续管线消费
  必填 seatId；可选 userInput, ctx, inputs, model, entryKey
- `save-step-edit` — 改稿落盘 · 与界面文本视图保存同一端点 · 原稿自动存 _original/ 供还原 · 省略 editedContent 只回读不写盘
  必填 sourceDir, stepId；可选 nodeId, editedContent, userInput
- `set-review` — 标记某步骤的评审结论(approved/rejected/pending)并附反馈
  必填 dir, stepId, status；可选 feedback, regenerateRunId
- `start-pipeline` — 启动叙事管线 · 支持 117 品类 × 9 模板 · 自动 Tier/Mode 路由
  必填 userInput；可选 tier, mode, genreCode, complexity, routeGroup, routingMode, model, teamId, storyType, storyTheme, entryKey, activateSeats
<!-- TOOLS:END -->

## Rules

The CLI owns authentication, the service process and all pipeline calls. Do not
invent run IDs, handwrite HTTP requests against the service, or author narrative
content yourself when the user asked the workshop to produce it.

If a command fails, report the error and stop the dependent step. Starting the
service, producing a run, and a usable result are separate conclusions; report
only what a command actually returned.

Not being able to launch the CLI at all is the one exception, because it is a
setup problem rather than a workshop result: if another installation of this
skill is available, use its CLI instead of stopping. Retrying the same
unreachable command is not a recovery.
