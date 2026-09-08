/**
 * IP DNA 子系统 —— 输入理解 / 标准化 / 改编 / scoped 提取 / 算子装备的统一入口。
 * 见《叙事工坊产品形态蓝图》第三~八章。
 */

// 类型与 Spec 契约
export * from "../types/narrative-ip-dna.js";
export * from "./data-atlas.js";
export * from "./io-flow.js";
export * from "./filesystem.js";
export * from "./job.js";

// 各 Phase 实现
export * from "./phase0-foundation.js";
export * from "./phase0-compress.js";
export * from "./phase1-understanding.js";
export * from "./noise-filter.js";
export * from "./phase1-multimodal.js";
export * from "./phase2b-adapt.js";
export * from "./phase2-extract.js";
export * from "./phase2c-gen-adapt.js";
export * from "./corpus-loader.js";
export * from "./phase3-rag.js";
export * from "./phase3-vector.js";
export * from "./phase3b-kag.js";
export * from "./phase4-rewrite.js";
export * from "./phase5-polish.js";

// A→B 交接契约 + 注入桥
export * from "./generation-seed.js";
export * from "./injection/operator-injection.js";
export * from "./injection/slot-registry.js";

// 本地运行时适配器（向量 / 视频抽帧）
export * from "./embedder.js";
export * from "./video-ffmpeg.js";
export * from "./pdf-split.js";
export * from "./runtime-adapters.js";

// 端到端编排
export * from "./orchestrator.js";
