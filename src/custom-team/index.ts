/**
 * custom-team — 自定义专属创作团队
 *
 * 分工：
 *   types.ts          数据契约（TeamRecord / DistilledProfile / BookGroup）
 *   store.ts          落盘事实源（input/custom_teams/<id>.json）
 *   distill-seats.ts  2.4.1 / 2.4.2 两席的产品契约
 *   distill-prompts.ts 两个蒸馏专家的提示词
 *   distill.ts        执行链与状态机（draft → distilling → ready/failed）
 *   ip-dna-bridge.ts  对 IP 提炼管线与百科娘的默认接线
 *   injection.ts      把 profile 按席位注入提示词
 */
export * from "./types.js";
export * from "./store.js";
export * from "./distill-seats.js";
export * from "./distill-prompts.js";
export * from "./distill.js";
export * from "./injection.js";
export * from "./ip-dna-bridge.js";
