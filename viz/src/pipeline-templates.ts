/**
 * 旧 pipeline template 的 id 联合（纯反序列化用）。
 *
 * Phase-2 M9：这里曾经镜像后端 templates.ts 的每模板 step 列表，供 UI 在 SSE
 * announce 帧到达前先画一条"将要跑的链"。代价是同一套步序存在两份实现，模板改动
 * 必须同步改前端，漂移时用户看到的预览是假的。步序真值现在只有后端一处。
 *
 * 四期起连标签表也去掉了：专家跑的是席位管线（pl-*），卡上要报的是管线名，
 * 由后端 /genres 的 narrative_pipeline_name 给。留着一张写有 "tpl-vn-v2" 的
 * 标签表，只会让新架构的画布继续显示旧模板 id——那正是「影游为什么是 v2」的来源。
 * 本类型仅为旧画布节点里存过的字段保留可解析性。
 */
export type PipelineTemplateId =
  | "tpl-jrpg"
  | "tpl-jrpg-v2"
  | "tpl-rpg"
  | "tpl-vn"
  | "tpl-vn-v2"
  | "tpl-open-world"
  | "tpl-card-game"
  | "tpl-fragmented"
  | "tpl-emergent"
  | "tpl-narrative-card"
  | "tpl-light";