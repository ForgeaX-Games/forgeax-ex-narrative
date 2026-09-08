/**
 * 异步任务 / 进度 / 质量 / 降级契约（Job Contracts）—— 蓝图 §11「工程化与既有机制统一」。
 *
 * 不另起炉灶：复用现有 `PipelineProgress`(SSE 进度) + `Checkpoint`(断点续传) + strict_mode(质量校验)，
 * 在其上补齐 IP DNA 输入理解侧（Phase0-2）缺失的"任务态/失败隔离/服务降级"统一契约。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PipelineProgress } from "../types/index.js";

/** 任务状态机（与 PipelineProgress.status 兼容，补充 IP DNA 输入理解侧语义）。 */
export type JobStatus =
  | "pending"
  | "running"
  | "awaiting_confirmation"  // 阶段门：跑到确认点（如标准化后等裁剪范围），等用户/agent 确认后续跑（半自动）
  | "completed"
  | "failed"
  | "cancelled"   // 用户/agent 主动取消生产（§5.1）；轮询方据此终止
  | "degraded";   // 部分失败但已降级保留拓扑/占位（非致命）

/**
 * 统一任务句柄。input 理解侧与生成侧共用，jobId 与 story_timestamp 关联同一完整故事。
 */
export interface IpDnaJob {
  jobId: string;
  /** 关联的完整故事时间戳（input/output 主键，§6.0）。 */
  story_timestamp: string;
  stage: string;
  status: JobStatus;
  /** 0-100。 */
  progress: number;
  message?: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
  /** 完成后的结果摘要（轮询拿最终产物，避免重复跑管线）。 */
  result?: unknown;
}

// ─────────────────────────────────────────────────────────────────
// 任务注册表（进程内）——IP DNA 接口异步化的最小事实源（§11）。
// server 起任务后立即返回 jobId，后台跑管线并经 updateJob 回写 status/progress/current_stage，
// 前端轮询 getJob 获取进度与最终结果。进程内存储，重启即清（与现有 runs 一致）。
// ─────────────────────────────────────────────────────────────────

const jobStore = new Map<string, IpDnaJob>();

// ── 落盘持久化（进程重启可续，半自动多步工作流必需）──
// 任务句柄是轻量 JSON，写到 <cwd>/.ipdna-jobs/<jobId>.json。getJob 命中内存优先，
// 未命中回落磁盘（重启后续跑场景）。落盘失败不阻断（内存仍可用）。

function jobsDir(): string {
  return path.join(process.cwd(), ".ipdna-jobs");
}

function jobFilePath(jobId: string): string {
  const safe = jobId.replace(/[/\\?%*:|"<>]/g, "_");
  return path.join(jobsDir(), `${safe}.json`);
}

function persistJob(job: IpDnaJob): void {
  try {
    fs.mkdirSync(jobsDir(), { recursive: true });
    fs.writeFileSync(jobFilePath(job.jobId), JSON.stringify(job, null, 2), "utf-8");
  } catch {
    /* 落盘失败不阻断主链 */
  }
}

function loadJobFromDisk(jobId: string): IpDnaJob | undefined {
  try {
    const file = jobFilePath(jobId);
    if (!fs.existsSync(file)) return undefined;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as IpDnaJob;
  } catch {
    return undefined;
  }
}

/** 新建任务（pending）。jobId 关联 story_timestamp，便于与 input/output 落盘对齐。 */
export function createJob(params: { story_timestamp: string; stage?: string }): IpDnaJob {
  const rand = Math.random().toString(36).slice(2, 8);
  const jobId = `ipdna_${params.story_timestamp}_${rand}`;
  const now = new Date().toISOString();
  const job: IpDnaJob = {
    jobId,
    story_timestamp: params.story_timestamp,
    stage: params.stage ?? "pending",
    status: "pending",
    progress: 0,
    startedAt: now,
    updatedAt: now,
  };
  jobStore.set(jobId, job);
  persistJob(job);
  return job;
}

/** 局部更新任务态（stage/status/progress/message/error/result），自动刷新 updatedAt。 */
export function updateJob(
  jobId: string,
  patch: Partial<Omit<IpDnaJob, "jobId" | "story_timestamp" | "startedAt">>,
): IpDnaJob | undefined {
  const job = jobStore.get(jobId) ?? loadJobFromDisk(jobId);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobStore.set(jobId, job);
  persistJob(job);
  return job;
}

/**
 * 取消任务（§5.1 取消生产）：标记 status=cancelled（已完成的不改）。协作式取消——
 * 后台 promise 可能继续跑完当前步，但其 run 清单 running 残留会被 cleanupStaleRunningManifests
 * 翻为 interrupted（可断点续传）；前端轮询见 cancelled 即终止释放按钮。
 */
export function cancelJob(jobId: string): IpDnaJob | undefined {
  const job = getJob(jobId);
  if (!job) return undefined;
  if (job.status === "completed") return job;
  return updateJob(jobId, { status: "cancelled", stage: "cancelled", message: "已取消生产" });
}

/** 只读单个任务（内存优先，未命中回落磁盘，支持重启续跑）。 */
export function getJob(jobId: string): IpDnaJob | undefined {
  const mem = jobStore.get(jobId);
  if (mem) return mem;
  const disk = loadJobFromDisk(jobId);
  if (disk) jobStore.set(jobId, disk);
  return disk;
}

/** 只读全部任务（调试/列表）。 */
export function listJobs(): IpDnaJob[] {
  return [...jobStore.values()];
}

/**
 * 失败隔离 + 重试策略（§11）。对齐现有 vn-screenplay/storyboard 的"子批失败降级占位"做法：
 * 单节点/子批失败不拖垮整体，记 warning、保拓扑、可续跑。
 */
export interface RetryPolicy {
  maxRetries: number;
  /** 退避基数(ms)。 */
  backoffMs: number;
  /** 失败是否降级保留（true=降级占位，false=整体失败）。 */
  degradeOnFailure: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  backoffMs: 1000,
  degradeOnFailure: true,
};

/**
 * 质量校验结果（§11）。复用 strict_mode 重试思想：解析/结构校验失败触发重试，
 * 重试耗尽则按 RetryPolicy 决定 fail / degrade。
 */
export interface QualityCheck {
  passed: boolean;
  /** 校验项（如 "层级树连通" / "剧情树≥25节点" / "三件套齐全"）。 */
  checks: Array<{ name: string; passed: boolean; detail?: string }>;
  warnings: string[];
}

/** 服务降级开关（§7.6 / §11）：依赖缺失时的兜底路径。 */
export interface DegradationFlags {
  /** 无本地向量模型时 RAG 降级为关键词检索。 */
  ragFallbackToKeyword: boolean;
  /** 无图数据库时 KAG 降级为文件算法（默认即此，图数据库仅加速器）。 */
  kagFileOnly: boolean;
  /** 子仓库无平台对话功能时改编默认全量。 */
  adaptDefaultFull: boolean;
}

export const DEFAULT_DEGRADATION: DegradationFlags = {
  ragFallbackToKeyword: true,
  kagFileOnly: true,
  adaptDefaultFull: true,
};

/** 由 IpDnaJob 派生一帧 PipelineProgress（桥接现有 SSE 进度契约，不重复造轮子）。 */
export function jobToProgress(job: IpDnaJob, step: number, totalSteps: number): PipelineProgress {
  const status: PipelineProgress["status"] =
    job.status === "degraded" ? "completed" : (job.status as PipelineProgress["status"]);
  return {
    stage: job.stage,
    step,
    totalSteps,
    status,
    message: job.message ?? (job.status === "degraded" ? "降级完成（含告警）" : undefined),
  };
}

/**
 * 带重试 + 失败隔离的执行器。校验不过/抛错时按 RetryPolicy 重试，耗尽后降级或抛出。
 * 返回 [结果, 质量校验]；degrade 时结果为兜底值 fallback()。
 */
export async function runWithRetry<T>(
  fn: () => Promise<T>,
  validate: (result: T) => QualityCheck,
  opts: {
    policy?: RetryPolicy;
    fallback?: () => T;
  } = {},
): Promise<{ result: T; quality: QualityCheck; degraded: boolean }> {
  const policy = opts.policy ?? DEFAULT_RETRY_POLICY;
  let lastErr: unknown;
  let lastQuality: QualityCheck | undefined;

  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const result = await fn();
      const quality = validate(result);
      if (quality.passed) {
        return { result, quality, degraded: false };
      }
      lastQuality = quality;
    } catch (e) {
      lastErr = e;
    }
    if (attempt < policy.maxRetries) {
      await new Promise((r) => setTimeout(r, policy.backoffMs * (attempt + 1)));
    }
  }

  if (policy.degradeOnFailure && opts.fallback) {
    return {
      result: opts.fallback(),
      quality: lastQuality ?? {
        passed: false,
        checks: [],
        warnings: [`降级兜底：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`],
      },
      degraded: true,
    };
  }
  throw lastErr ?? new Error(`质量校验未通过且无降级兜底: ${JSON.stringify(lastQuality?.warnings)}`);
}
