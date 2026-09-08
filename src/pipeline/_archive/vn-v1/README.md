# 封存：过时 VN 管线 VN v1（C2 已完成，2026-08）

本目录是 `tpl-vn`（旧版视觉小说 / 互动影游，早于 `tpl-vn-v2` 精调管线）三个
universal-agent 驱动 step 的完整封存件。约定同 [`../README.md`](../README.md)
第 1-3 条：物理搬迁、写明吸收去处、此后勿改（没有任何活跃代码再 import 这里的
任何文件；改了不会生效）。

## 目录内容

- `branch-tree.ts`——剧情分支树骨架（短剧单次 / 长剧分幕自动切换，含跨幕一致性
  校验与 graph-qa 结构质量门）。
- `dialogue-script.ts`——基于 `branch_tree` 节点写出具体台词与场景描写。
- `cinematic-storyboard.ts`——基于分支树 + 对话节奏，为关键节点输出可拍摄/可渲染
  的镜头要素（含 QTE 字段）。
- `video-prompt-assembly.ts`——把分镜拍平为可送 SD/Veo/Sora 的双语 prompt。
- `__tests__/`——原实现的单测（`cinematic-storyboard-normalize.test.ts` /
  `integration-stage-c.test.ts` / `universal-narrative-vn.test.ts` /
  `video-prompt-assembly.test.ts`），随实现一并封存，但仍随主测试套件跑——纯函数、
  无外部依赖，继续通过只是证明封存件本身没有腐坏。
- `templates.ts`——**D1（2026-08）新增**：原 `pipeline/templates.ts` 里 `tpl-vn`
  的模板定义本体，随「tpl-* 降级封存」搬入。

## 吸收台账（业务功能 vs 运行方式，只吸前者）

| 业务功能 | 吸收去处 | 说明 |
| --- | --- | --- |
| 剧情分支树构造（`branch_tree` 的节点/边/结局设计） | `structure` 席通用实现 + `tree.md` 结构卡 | 不复刻分支树专属数据结构，把"如何设计分支/汇流/结局"的写作要点折入结构卡 |
| 对话脚本形态（`dialogue_script` 的台词角色枚举、语调节奏） | `plot` 席（`plot_generation`） | 台词与场景描写归入通用情节内容，不再要求独立分支树输入 |
| 分镜设计（`cinematic_storyboard` 的镜头要素、QTE 字段） | `storyboard` 席（`script_generation`） | 分镜/QTE 表达折入通用分镜产出 |

## 判断为不迁

`node_kind`/`next[].kind` 的离散枚举（`qte_climax`/`qte_pass`/`qte_fail` 等）、
`branchTreeAdapter` 的图规范化算法——这些是 VN v1 分支树的运行方式，不构成通用
叙事原语，不吸收，仅随本目录存档供查证。

## 已切断的引用（C2 逐条清单）

- `assistant-seats.ts`：`structure` 席的 `tpl-vn` `branch_tree` 绑定、`plot` 席的
  `tpl-vn` `dialogue_script` 绑定、`storyboard` 席的 `tpl-vn` `cinematic_storyboard`
  绑定全部移除。
- `modes.ts`：`fragmented`/`card_narrative`/`open_world_narrative`/`design_fragmented`
  四条 mode（连带 VN v1 的历史遗留）随 C3 一并从 `MODE_CONFIGS` 摘下；VN v1 侧
  未单独占用 mode，随品类 skill 的 `narrativeSteps` 迁移即完成收口。
  `STEP_OUTPUT_FIELDS` 对应条目保留供历史存档读取。
- `step-registrations.ts` / `pipeline.ts`：`branch_tree` / `dialogue_script` /
  `cinematic_storyboard` 三步的注册与 `STEP_FNS` 条目移除；`pipeline.ts` 的
  `extractStepOutput` 仍保留三步的只读分支供旧存档回放。
- `seat-spec.ts` / `seat-spec.test.ts`：`structure`/`storyboard` 两席已无落差，
  对应 `SHAPE_DIVERGENCES` 登记与 `STILL_DIVERGING` 列表条目移除。
- 品类 skill 文件：VN 族 skill 的 `stepSkills.branch_tree` /
  `stepSkills.dialogue_script` 分别改挂到 `structure` 席通用实现与
  `stepSkills.plot_generation`。
- 测试侧：`agents/__tests__/universal-narrative.test.ts` 拆出
  `branchTree`/`dialogueScript`/`cinematicStoryboard` 三个薄包装用例，随实现一并
  搬进本目录 `__tests__/universal-narrative-vn.test.ts`；
  `pipeline/__tests__/integration-stage-b.test.ts` 与
  `pipeline-templates.test.ts` 的相关断言改为对齐"不再产出已下线 step id"的现状。

## 待二层校对项

无——C2 范围内三项业务功能均已落地并有对应 `__tests__`。

参见总台账：[`../README.md`](../README.md)。
