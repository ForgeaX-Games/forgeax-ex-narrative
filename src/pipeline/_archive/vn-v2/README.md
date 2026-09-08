# 封存：影游精调管线 VN v2（C1 已完成，2026-08）

本目录是 `tpl-vn-v2` 那条"精心设计过"的影游互动管线的完整封存件。约定同
[`../README.md`](../README.md) 第 1-3 条：物理搬迁、写明吸收去处、此后勿改
（没有任何活跃代码再 import 这里的任何文件；改了不会生效）。

## 目录内容

- `vn-logline.ts` / `vn-outline-acts.ts` / `vn-beats.ts` / `vn-script-normalize.ts` /
  `vn-segment-confirm.ts` / `vn-branched-beats.ts` / `vn-state-ledger.ts` /
  `vn-screenplay.ts` / `vn-storyboard.ts`——原 `steps/vn-v2/` 九个 step 文件本体
  （含各自 composer），原样保留。
- `_shared.ts` / `index.ts`——原 `steps/vn-v2/` 的共享工具与桶文件导出，一并搬入
  以保持内部相对 import 全部有效（除 `design-context-helper.js` 的相对路径已
  改指回 `../../steps/design-context-helper.js`，`modes.js` 已改指回
  `../../modes.js`——这两个是本目录之外的活跃文件，其余 import 全部维持原样）。
- `vn-v2-e2.ts`——原 `pipeline/vn-v2-e2.ts`，上传剧本时的步序旁路（E2 入口）。
- `__tests__/scene-export-vn.test.ts`——原 `pipeline/__tests__/scene-export-vn.test.ts`，
  验证 `exportScenesAndRenumber`（分支 DAG 专属的确定性场号算法）。随实现一并
  封存，但仍随主测试套件跑——纯函数、无外部依赖，继续通过只是证明封存件本身
  没有腐坏，供二层校对时对照。
- `templates.ts`——**D1（2026-08）新增**：原 `pipeline/templates.ts` 里 `tpl-vn-v2`
  的模板定义本体，随「tpl-* 降级封存」搬入。

## 吸收台账（业务功能 vs 运行方式，只吸前者）

| 业务功能 | 吸收去处 | 说明 |
| --- | --- | --- |
| 防吃书与状态漂移（`vn_state_ledger` / `WorldStateLedger`） | `steps/content-check.ts` 的 `CONTENT_CHECK_CRITERIA` 新增「世界状态自洽」项 | 不复刻账本数据结构，只吸收检查意图 |
| 三维 staging + 确定性场号（`vn_branched_beats` 的 `exportScenesAndRenumber`） | `pipeline/scene-numbering.ts` 的 `deriveDeterministicSceneNumbers`，接入 `steps/script-generation.ts` | 换了数据形状：原算法吃分支 DAG，新函数吃线性有序章节列表；"三维任一维变化即换场"这条规则原样保留。分支专属部分（pivot/branch_origin_beat 的编号重写）不迁，只留在本目录供查证 |
| 对白类型区分（`vn_screenplay` 的 `VnDialogueLine.kind`） | `types/index.ts` 的 `PlotNode.jrpg_elements.dialogue_segments[].kind` + `plot-generation.ts` 的 `normalizeDialogueSegmentKind` | 取值集合未照搬，只吸收"对白与旁白按原始顺序交错"这一结构性收益，缺省 `"dialogue"` 兼容存量产物 |
| 上传剧本入口（`vn-v2-e2.ts` 的运行时步序替换） | `steps/user-preference-summary.ts` 的 `PREFERENCE_SUMMARY_COMPOSER`（`uploadedScriptContext` 帮助函数） | 不复刻"动态改图"这个运行方式，改为通用席位 composer 感知 `ctx.uploaded_script` 并把它当权威来源；对所有品类生效，不再按 template 分支 |
| 叙事策略四轴对影游品类的挂接（`vn_logline` / `vn_outline_acts` / `vn_beats` / `vn_branched_beats` 曾各自登记 `STEP_TO_STRATEGY_STAGE`） | 不需要单独吸收——影游品类现在直接走通用 step（`initial_plan` / `story_framework` / `outline_batch` / `detailed_outline`），四轴策略与其余品类同一套 | `pipeline/prompt/strategy-slots.ts` 已删登记，见其顶部注释 |

## 判断为不迁（详见 `docs/legacy-salvage.md`「判断为不迁」表）

`acts`/`act_id` 三幕骨架、`branch_qte`/`performance` QTE、VN 专属结局编号约定
（`END_H1` 等）——这些是 VN v2 的运行方式或产品噱头，不构成通用叙事原语，
不吸收，仅随本目录存档供查证。

## 已切断的引用（C1 逐条清单）

- `assistant-seats.ts`：11 条 `tpl-vn-v2` `SeatBinding` 全部移除。
- `modes.ts`：`vn_full` / `vn_script` / `vn_storyboard_mode` / `design_vn_full`
  四条 mode 整体退役；`STEP_IDS` 的 `VN_*` 常量移入向后兼容段落；
  `STEP_OUTPUT_FIELDS` 对应条目移除。
- `blueprint/assembler.ts` / `pipeline.ts` / `run-manifest-builder.ts`：
  `injectVnV2E2` / `injectVnV2E2Steps` / `injectVnV2E2StepsForCtx` 三处步序
  旁路函数与全部调用点移除。
- `step-registrations.ts`：9 个 vn-v2 step 与 `vn_structure_check` 的注册移除。
- `runner-migration.ts` / `blueprint/migrated-processors.ts`：`vn_structure_check`
  相关登记移除。
- `prompt/strategy-slots.ts` / `seat-spec.ts` / `ip-dna/injection/slot-registry.ts`：
  `STEP_TO_STRATEGY_STAGE`、`SHAPE_DIVERGENCES`（outline 席落差已清零）、
  `migrateFrom`、`OPERATOR_SLOT_REGISTRY` 里的 vn-v2 逐条登记全部移除或改写。
- 测试侧：`assistant-seats.test.ts` / `mode-routing.test.ts` /
  `run-manifest-builder.test.ts` / `kernel-dispatch.test.ts` /
  `seat-ipdna-propagation.test.ts` / `slot-resolution.test.ts` /
  `ip-dna-batch2.test.ts` 的相关断言改为对齐现状；`production-truth.test.ts` /
  `skeleton-contract.test.ts` / `ip-dna-e2e.test.ts` 里对 vn-v2 composer/工具
  函数的 import 与用例整块移除；`scene-export-vn.test.ts` 随实现一并搬进本目录。
- 前端：`viz/src/composer/seats.generated.ts` 已用 `gen-seats.ts` 重新生成，
  不再含 `tpl-vn-v2` 绑定。

## 待二层校对项

无——C1 范围内四项业务功能均已落地并有对应 `__tests__`。若后续要复核算法细节
（例如分支 DAG 场号算法是否有值得回吸的边界情况处理），从本目录的
`vn-branched-beats.ts` 与 `__tests__/scene-export-vn.test.ts` 入手。

参见总台账：[`../README.md`](../README.md)，设计判断详见
[`docs/legacy-salvage.md`](../../../../docs/legacy-salvage.md)。
