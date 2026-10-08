# 归档：`scene_generation`（场景席按环节方向拆分前的原貌）

封存日期：2026-08。封存物只有一个文件 [`scene-generation.ts`](./scene-generation.ts)，
但它是本仓第一例**因环节方向判断失误而整体作废**的实现，登档价值不在代码本身，
在于那条判断规则——见 [`docs/absorption-filter.md`](../../../../docs/absorption-filter.md)
的"环节方向轴"。

## 为什么整体作废

这个 step 名义上绑在**前向**席位 `scene_list`（2.5.7），实现体却是**后向**的：

- 读 `story_framework` / `outlines_generated` / `detailed_outlines_generated` /
  `plots_generated` / `jrpg_script` / `quest_graph`——全是自己下游的产物。
- `dependsOn` 直接声明了 `plot_generation`，等于承认"我要等剧情写完"。
- 但默认步序把 `scene_plan`（当时叫 `scene_generation`）排在 `story_framework`
  **之前**，于是每次真跑都在入口处发现剧情为空，落到第 435 行那段 worldview
  fallback，一次 LLM 出树就结束。

结果是：三阶段提炼、增量去重、层级 UID 分配、MD 树形目录这一整套逻辑，在生产路径
上从未执行过一次。它不是"写得不好"，是**装在方向相反的席位里**——一席不可能同时
是"从设定推演清单"和"从成文回收实况"。调步序也救不了：往后调，前面的大纲/结构/
情节全都没有场景清单可用；往前调，它自己要的剧情又不存在。

## 吸收台账

| 归档形制 | 吸收去处（新架构具体槽位） | 说明 |
| --- | --- | --- |
| 第 435-445 行的 worldview fallback 提示词 | `steps/scene-plan.ts` 的 `SCENE_PLAN_COMPOSER` | 唯一真正跑过的那条路径，升格为前向席的正式实现；补齐了规模自洽约束与 F3 四段（优先级链 / 概念-字段映射 / 输出前自检） |
| Phase1 分层增量提炼（`extractScenesFromBatch` + `SCENE_SKELETON_INCREMENTAL_COMPOSER`） | `steps/scene-evidence.ts`（内容检查席 2.5.16 的场景取证子步） | 同一段逻辑，换到方向正确的环节就活了——在检查席里它的输入（剧情全文）天然齐备 |
| Phase2 按节点展开 L3-L5（`processSceneUnit` + `SCENE_EXPAND_COMPOSER`） | 一半进 `steps/script-scene-generation.ts` 的 `SCRIPT_SCENE_EXPAND_COMPOSER`；另一半判定不吸收 | 剧本+场景耦合变体是它唯一的活跃调用方，随封存一并内联过去。取证席**不**吸收展开：那是造内容，违背"只审不修"，场景该有多深由前向的 `scene_plan` 决定 |
| Phase3 确定性聚合（`aggregateScenes` / `skeletonToRaw` / `expandedToRaw` / `buildPerNodeMd`） | 未封存——本就住在 `graph/scene-aggregator.ts` | 去重、父引用修复、层级推断、深度裁剪、UID 分配都是纯算法，与"场景从哪来"无关，前向后向共用同一份 |
| quest-aware 分支（`questInfo` 入参） | 判定不吸收 | 它服务的是"场景展开时参考任务目标"，而任务与场景在新拓扑里同属交付终点之后/之前的不同环节，前向规划期没有任务可读 |

## 与新两步的对应关系

```
旧 scene_generation（一席两向，后向那半是死代码）
├── 前向：worldview fallback ────────→ scene_plan        （席位 2.5.7，runPolicy: independent）
└── 后向：Phase1 分层提炼 ───────────→ scene_evidence    （内容检查席 2.5.16 的子步）
     Phase2 按节点展开 ─┬──────────→ script_scene_generation（耦合变体内联）
                        └──────────→ 不吸收（造内容，不属于检查席）
     Phase3 确定性聚合 ────────────→ 原地不动（scene-aggregator，两侧共用）
```

## 此后勿改

本目录下的文件没有任何活跃代码 import（`tsc` 可证：改动它不会影响任何生产路径），
保留原貌只为复核吸收是否有遗漏。相对导入路径在搬迁时按新层级修正过，因此它仍能通过
类型检查，但**不要**再往里加功能——要改就改 `scene-plan.ts` 或 `scene-evidence.ts`。
