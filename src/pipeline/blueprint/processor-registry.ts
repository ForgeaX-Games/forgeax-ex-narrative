/**
 * blueprint/processor-registry.ts
 *
 * 业务逻辑函数注册表。将 step 函数中硬编码的 validator / normalizer /
 * processor / splitter / merger 提取为命名函数，在 AgentDef 中通过名称引用。
 *
 * 设计原则：
 *   - Runner 运行时通过名称查找函数（解耦 AgentDef 的纯数据性）
 *   - 注册在启动时完成，运行时不修改
 *   - 函数签名与 types.ts 的 Fn 类型严格对齐
 */
import type {
  ValidatorFn,
  NormalizerFn,
  ProcessorFn,
  ChunkSplitterFn,
  ChunkMergerFn,
  ChunkSinkFn,
  WaveLayererFn,
  WaveSummarizerFn,
  WaveConstraintCheckFn,
  PreflightFn,
} from "./types.js";

const validators = new Map<string, ValidatorFn>();
const normalizers = new Map<string, NormalizerFn>();
const processors = new Map<string, ProcessorFn>();
const preflights = new Map<string, PreflightFn>();
const splitters = new Map<string, ChunkSplitterFn>();
const mergers = new Map<string, ChunkMergerFn>();
const chunkSinks = new Map<string, ChunkSinkFn>();
// WaveRunner 复用 mergers/chunkSinks/validators/normalizers（形状与 chunked 一致，
// 见 types.ts 的 WaveLayererFn 注释）；只新增分层与波次专属的两个可选处理器。
const waveLayerers = new Map<string, WaveLayererFn>();
const waveSummarizers = new Map<string, WaveSummarizerFn>();
const waveConstraintChecks = new Map<string, WaveConstraintCheckFn>();

// ── Registration helpers ──

export function registerValidator(name: string, fn: ValidatorFn): void {
  validators.set(name, fn);
}

export function registerNormalizer(name: string, fn: NormalizerFn): void {
  normalizers.set(name, fn);
}

export function registerProcessor(name: string, fn: ProcessorFn): void {
  processors.set(name, fn);
}

export function registerPreflight(name: string, fn: PreflightFn): void {
  preflights.set(name, fn);
}

export function registerSplitter(name: string, fn: ChunkSplitterFn): void {
  splitters.set(name, fn);
}

export function registerMerger(name: string, fn: ChunkMergerFn): void {
  mergers.set(name, fn);
}

export function registerChunkSink(name: string, fn: ChunkSinkFn): void {
  chunkSinks.set(name, fn);
}

export function registerWaveLayerer(name: string, fn: WaveLayererFn): void {
  waveLayerers.set(name, fn);
}

export function registerWaveSummarizer(name: string, fn: WaveSummarizerFn): void {
  waveSummarizers.set(name, fn);
}

export function registerWaveConstraintCheck(name: string, fn: WaveConstraintCheckFn): void {
  waveConstraintChecks.set(name, fn);
}

// ── Lookup helpers ──

export function getValidator(name: string): ValidatorFn {
  const fn = validators.get(name);
  if (!fn) throw new Error(`Validator not registered: ${name}`);
  return fn;
}

export function getNormalizer(name: string): NormalizerFn {
  const fn = normalizers.get(name);
  if (!fn) throw new Error(`Normalizer not registered: ${name}`);
  return fn;
}

export function getProcessor(name: string): ProcessorFn {
  const fn = processors.get(name);
  if (!fn) throw new Error(`Processor not registered: ${name}`);
  return fn;
}

export function getPreflight(name: string): PreflightFn {
  const fn = preflights.get(name);
  if (!fn) throw new Error(`Preflight not registered: ${name}`);
  return fn;
}

export function getSplitter(name: string): ChunkSplitterFn {
  const fn = splitters.get(name);
  if (!fn) throw new Error(`ChunkSplitter not registered: ${name}`);
  return fn;
}

export function getMerger(name: string): ChunkMergerFn {
  const fn = mergers.get(name);
  if (!fn) throw new Error(`ChunkMerger not registered: ${name}`);
  return fn;
}

export function getChunkSink(name: string): ChunkSinkFn {
  const fn = chunkSinks.get(name);
  if (!fn) throw new Error(`ChunkSink not registered: ${name}`);
  return fn;
}

export function getWaveLayerer(name: string): WaveLayererFn {
  const fn = waveLayerers.get(name);
  if (!fn) throw new Error(`WaveLayerer not registered: ${name}`);
  return fn;
}

export function getWaveSummarizer(name: string): WaveSummarizerFn {
  const fn = waveSummarizers.get(name);
  if (!fn) throw new Error(`WaveSummarizer not registered: ${name}`);
  return fn;
}

export function getWaveConstraintCheck(name: string): WaveConstraintCheckFn {
  const fn = waveConstraintChecks.get(name);
  if (!fn) throw new Error(`WaveConstraintCheck not registered: ${name}`);
  return fn;
}

export function hasChunkSink(name: string): boolean { return chunkSinks.has(name); }
export function hasValidator(name: string): boolean { return validators.has(name); }
export function hasNormalizer(name: string): boolean { return normalizers.has(name); }
export function hasProcessor(name: string): boolean { return processors.has(name); }
export function hasPreflight(name: string): boolean { return preflights.has(name); }
export function hasSplitter(name: string): boolean { return splitters.has(name); }
export function hasMerger(name: string): boolean { return mergers.has(name); }
export function hasWaveLayerer(name: string): boolean { return waveLayerers.has(name); }
export function hasWaveSummarizer(name: string): boolean { return waveSummarizers.has(name); }
export function hasWaveConstraintCheck(name: string): boolean { return waveConstraintChecks.has(name); }
