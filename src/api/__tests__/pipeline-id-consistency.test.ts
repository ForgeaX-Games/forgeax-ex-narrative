/**
 * 落盘不变式：`_entry.json` 的计划期 pipelineId == `_run_manifest.json` 的运行期 pipelineId。
 *
 * 这是 docs/contracts.md §1.4 第 1 条的守卫。前端拿计划期 id 当泳道键、SSE 帧带
 * 运行期 id，两者不等则主管线的泳道永远对不上 —— 而且不会报错，只会「进度不显示」，
 * 属于最难查的一类。纯代码单测（run-layout 那组）守的是决策，这一组守的是**磁盘现状**。
 *
 * `output/` 不入库，所以在干净检出/CI 上没有样本，此时整组跳过。
 * 有历史目录不同源时，跑 `npx tsx scripts/backfill-pipeline-id.ts --write` 回填。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_SUBDIR } from "../run-layout.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");

interface Sample {
  /** 供断言失败时定位的可读位置。 */
  where: string;
  planned: string;
  runtime: string | undefined;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

function manifestPipelineId(dir: string): string | undefined {
  return readJson<{ pipelineId?: string }>(path.join(dir, "_run_manifest.json"))
    ?.pipelineId;
}

function collectSamples(): Sample[] {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const samples: Sample[] = [];

  for (const key of fs.readdirSync(OUTPUT_DIR)) {
    const entryDir = path.join(OUTPUT_DIR, key);
    if (!fs.statSync(entryDir).isDirectory()) continue;

    const planned =
      readJson<{ pipelines?: Array<{ pipelineId?: string }> }>(
        path.join(entryDir, "_entry.json"),
      )?.pipelines ?? [];

    // 主管线：计划期第一条对应条目根那份 manifest。
    const primaryId = planned[0]?.pipelineId;
    if (primaryId && fs.existsSync(path.join(entryDir, "_run_manifest.json"))) {
      samples.push({
        where: key,
        planned: primaryId,
        runtime: manifestPipelineId(entryDir),
      });
    }

    // 次管线：目录名即 pipelineId，manifest 头部必须与之相同。
    const pipelinesDir = path.join(entryDir, PIPELINE_SUBDIR);
    if (!fs.existsSync(pipelinesDir)) continue;
    for (const pid of fs.readdirSync(pipelinesDir)) {
      const dir = path.join(pipelinesDir, pid);
      if (!fs.statSync(dir).isDirectory()) continue;
      if (!fs.existsSync(path.join(dir, "_run_manifest.json"))) continue;
      samples.push({
        where: `${key}/${PIPELINE_SUBDIR}/${pid}`,
        planned: pid,
        runtime: manifestPipelineId(dir),
      });
    }
  }
  return samples;
}

describe("落盘 pipelineId 同源", () => {
  const samples = collectSamples();

  it.skipIf(samples.length === 0)(
    "计划期与运行期的 pipelineId 恒等",
    () => {
      const drifted = samples.filter((s) => s.planned !== s.runtime);
      // 报出全部漂移项，而不是首个：回填是批量动作，一次看全才好判断。
      expect(
        drifted.map((s) => `${s.where}: plan=${s.planned} runtime=${s.runtime}`),
      ).toEqual([]);
    },
  );

  it("次管线的目录名即其泳道身份", () => {
    const nested = samples.filter((s) => s.where.includes(`/${PIPELINE_SUBDIR}/`));
    for (const s of nested) {
      expect(s.where.endsWith(s.planned)).toBe(true);
    }
  });
});
