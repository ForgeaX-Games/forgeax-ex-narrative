# 封存：通用三件套 agent 框架（universal-agent）

搬迁前位置：`src/pipeline/universal-agent/`（五文件 + `__tests__/`）与
`src/pipeline/agents/universal-narrative.ts`。搬迁后 `src/pipeline/agents/`
整个目录随之消失——那里只剩这一个薄包装。

## 为什么封存

这套框架的形制是 **plan → execute → eval** 三段：按 needs 矩阵裁剪要跑哪几个
capability、逐个调 LLM、再让评估器判分决定重试。它服务的对象是七个 stub step
（`branch_tree` / `dialogue_script` / `cinematic_storyboard` /
`emergent_event` / `region_design` / `card_lore` / `event_pool`）。

那七个 step 已在 C2 与 C3 分别封存进 [`../vn-v1/`](../vn-v1/README.md) 与
[`../specialized/`](../specialized/README.md)。框架本身随之失去全部活跃调用方：
`runUniversalAgent` / `planAgent` / `evaluateOutput` / `createAdaptiveCapability` /
`createComposerCapability` 五个入口，在活跃代码里的引用数都是 0。

三段职责本身没有消失，是换了承载：

| 三件套的一段 | 现在由谁承担 |
|:---|:---|
| plan（按 needs 裁剪子能力） | 席位×作用域矩阵（`assistant-seats.ts`）+ 品类 skill 选择 |
| execute（逐能力调 LLM） | blueprint 的 `AgentDef` + `SingleTurnRunner` / `ChunkedRunner` / `SequenceRunner` |
| eval（判分与重试） | `StepDescriptor.strictMode` + `parse` 校验触发的框架重试 |

所以这里没有"待吸收"的业务功能——被替换掉的是运行方式，不是能力。

## 唯一没跟着退役的东西

`types.ts` 里的九维 needs 词表（`NeedsKey` / `NeedsScore` / `NeedsMatrix`）仍是
活跃词表：品类分类表的 `GENRE_TAXONOMY.needs`、步骤注册表的
`StepDescriptor.needsKeys`、agent 契约的 `AgentDef` 都在读它。

它已拆出为 `src/pipeline/core/needs.ts`，本目录的 `types.ts` 改为从那里转出。
方向必须是这一边：归档区的规矩是"没有任何活跃代码再 import 它们"，留一根线过去
就等于那条规矩不成立，下一个人也就无从判断这里哪些还活着。

## 此后勿改

本目录只为保留封存前的原貌以便复核。改了不会生效——除 `_archive/` 内部的
`vn-v1/` 与 `specialized/` 之外，没有任何代码再 import 它们。
