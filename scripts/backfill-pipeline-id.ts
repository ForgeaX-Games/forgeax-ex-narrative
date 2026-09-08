/**
 * backfill-pipeline-id.ts — 把历史运行目录的 pipelineId 收敛回同一个源
 *
 * 主管线启动时曾刻意不传 pipelineId（为了「不下沉子目录」），于是运行时的
 * `manifestFromStepIds` 只能现铸一个新的。结果 `_entry.json.pipelines[].pipelineId`
 * （计划期，前端拿它当泳道键）与 `_run_manifest.json.pipelineId`（运行期，SSE 帧带它）
 * 从此不等，主管线的泳道永远对不上。
 *
 * 代码侧已修（身份与落盘位置解耦，见 server.ts 的 LaunchRunParams.primary），
 * 本脚本处理**已经落盘的**那批：以 `_entry.json` 的计划期 id 为准回填 manifest，
 * 因为计划期 id 才是前端与条目配置共同持有的那一个。
 *
 * 同时重写 `agents[].outputRef`（形如 `<pipelineId>:<agentId>`），否则 manifest 内部
 * 会自我矛盾：头部一个 id，槽位引用另一个。
 *
 * 用法：
 *   npx tsx scripts/backfill-pipeline-id.ts           # 只报告，不写
 *   npx tsx scripts/backfill-pipeline-id.ts --write    # 真回填
 */
import fs from "node:fs";
import path from "node:path";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
const WRITE = process.argv.includes("--write");

interface EntryPipelineLike {
  pipelineId?: string;
}
interface EntryLike {
  pipelines?: EntryPipelineLike[];
}
interface ManifestLike {
  pipelineId?: string;
  agents?: Array<{ agentId?: string; outputRef?: string }>;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** 一个运行目录的回填结果。 */
type Outcome = "aligned" | "backfilled" | "no-plan-id" | "unreadable";

function reconcile(runDir: string, planId: string): Outcome {
  const manifestPath = path.join(runDir, "_run_manifest.json");
  const manifest = readJson<ManifestLike>(manifestPath);
  if (!manifest) return "unreadable";
  const runtimeId = manifest.pipelineId;
  if (runtimeId === planId) return "aligned";

  manifest.pipelineId = planId;
  for (const slot of manifest.agents ?? []) {
    // outputRef 前缀是 pipelineId；只换前缀，agentId 原样保留。
    if (slot.agentId) slot.outputRef = `${planId}:${slot.agentId}`;
  }
  if (WRITE) {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  }
  return "backfilled";
}

function main(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    console.log(`No output dir at ${OUTPUT_DIR}; nothing to do.`);
    return;
  }

  const tally: Record<Outcome, number> = {
    aligned: 0,
    backfilled: 0,
    "no-plan-id": 0,
    unreadable: 0,
  };

  for (const key of fs.readdirSync(OUTPUT_DIR)) {
    const entryDir = path.join(OUTPUT_DIR, key);
    if (!fs.statSync(entryDir).isDirectory()) continue;
    const entry = readJson<EntryLike>(path.join(entryDir, "_entry.json"));
    const planned = entry?.pipelines ?? [];

    // 主管线：计划期第一条对应条目根的 manifest。
    const primaryId = planned[0]?.pipelineId;
    if (!primaryId) {
      if (fs.existsSync(path.join(entryDir, "_run_manifest.json"))) {
        // 多管线之前的老条目：没有计划期 id 可对，运行期那个就是唯一事实，留着。
        tally["no-plan-id"] += 1;
      }
    } else {
      const outcome = reconcile(entryDir, primaryId);
      tally[outcome] += 1;
      if (outcome === "backfilled") console.log(`  ${key} → ${primaryId}`);
    }

    // 次管线：目录名本身就是 pipelineId，天然同源，但仍核一遍头部与 outputRef。
    const pipelinesDir = path.join(entryDir, "pipelines");
    if (!fs.existsSync(pipelinesDir)) continue;
    for (const pid of fs.readdirSync(pipelinesDir)) {
      const dir = path.join(pipelinesDir, pid);
      if (!fs.statSync(dir).isDirectory()) continue;
      const outcome = reconcile(dir, pid);
      tally[outcome] += 1;
      if (outcome === "backfilled") console.log(`  ${key}/pipelines/${pid} → ${pid}`);
    }
  }

  console.log(
    `\n${WRITE ? "Backfilled" : "Would backfill"}: ${tally.backfilled}` +
      `  already aligned: ${tally.aligned}` +
      `  legacy (no plan id): ${tally["no-plan-id"]}` +
      `  unreadable: ${tally.unreadable}`,
  );
  if (!WRITE && tally.backfilled > 0) console.log("Re-run with --write to apply.");
}

main();
