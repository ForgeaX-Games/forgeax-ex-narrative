/**
 * audit-seats.ts —— 一次性审计脚本：把席位契约、管线接线、step 注册三张表拉平打印。
 *
 * 用途是核对「席位表说 active」与「真的跑得到」是否一致。人读三张表容易漏，
 * 让程序对一遍更可靠。非运行时依赖，不被任何生产代码 import。
 */
import "../src/pipeline/core/step-registrations.js";
import { ASSISTANT_SEATS } from "../src/pipeline/routing/assistant-seats.js";
import { NARRATIVE_PIPELINES, expandPipelineSteps } from "../src/pipeline/routing/narrative-pipelines.js";
import { STEP_REGISTRY } from "../src/pipeline/core/step-registry.js";
import { compositeOutputStepIds, stepOutputCtxKey } from "../src/pipeline/core/step-output.js";
import { STEP_FILE_MAP } from "../src/pipeline/runtime/step-files.js";

const PIPELINES = Object.values(NARRATIVE_PIPELINES);

const seatPipelines = new Map<string, string[]>();
for (const p of PIPELINES) {
  for (const raw of p.seats as unknown[]) {
    const id = typeof raw === "string" ? raw : (raw as { seatId?: string }).seatId ?? String(raw);
    if (!seatPipelines.has(id)) seatPipelines.set(id, []);
    seatPipelines.get(id)!.push(p.id);
  }
}

console.log(`席位总数 ${ASSISTANT_SEATS.length}`);
console.log("seatId | status | runPolicy | 绑定step | 在哪些管线 | step注册");
for (const s of ASSISTANT_SEATS) {
  const binds = (s.bindings ?? []).flatMap((b) => b.agentIds ?? []);
  const registered = binds.map((b) => (STEP_REGISTRY.has(b) ? "y" : "N")).join(",");
  console.log(
    [
      s.id,
      s.status,
      s.runPolicy ?? "-",
      binds.join("+") || "(none)",
      (seatPipelines.get(s.id) ?? []).join("/") || "—",
      registered || "-",
    ].join(" | "),
  );
}

console.log("\n--- 四条管线展开后的默认步序 ---");
for (const p of PIPELINES) {
  console.log(`${p.id}: ${expandPipelineSteps(p).join(" > ")}`);
}

// 「这一步产出哪个 ctx 字段」原先分散在四处，其中 pipeline.ts 的
// extractStepOutput 与 server.ts 的 STEP_CTX_KEY 是手写字面量、各漏 7 步——
// 漏了的那步「跑完但拿不到产物」。两张表已收敛到 core/step-output.ts 从注册表
// 派生，SSE 帧与落盘走同一个解析入口，所以这里不再对差集，改查两件仍可能漂的事：
//   1. 注册表里的步能不能解析出 ctx 键（复合产出除外，它们本就没有单一字段）
//   2. 解析出来的步有没有对应的落盘文件名——没有就还是落不到盘
const composites = new Set(compositeOutputStepIds());

// 被复合步吸收掉的旧独立步：注册表还留着（旧存档的编辑记录按这些 id 索引），
// 但产物已归到吸收方的文件里，自己没有文件名是对的。
const ABSORBED_INTO_COMPOSITE = new Set(["initial_outline", "core_settings", "plot_synopsis"]);

console.log("\n--- 产出解析（只列异常：stepId | 注册表字段 | 解析结果 | 落盘文件）---");
let outputGaps = 0;
for (const [id, d] of STEP_REGISTRY.entries()) {
  if (composites.has(id) || ABSORBED_INTO_COMPOSITE.has(id)) continue;
  const declared = (d as { extractOutputKey?: string }).extractOutputKey ?? d.outputFields[0];
  const resolved = stepOutputCtxKey(id);
  const file = STEP_FILE_MAP[id];
  const okKey = resolved != null && resolved === declared;
  const okFile = file != null;
  if (!okKey || !okFile) {
    outputGaps += 1;
    console.log(
      `${id} | ${declared ?? "—"} | ${resolved ?? "解析不到"} | ${file ? (typeof file === "string" ? file : "(动态)") : "无文件名"}`,
    );
  }
}
console.log(
  outputGaps === 0
    ? `全部 ${STEP_REGISTRY.size} 步产出可解析且有落盘文件名（复合产出 ${composites.size} 步、被吸收旧步 ${ABSORBED_INTO_COMPOSITE.size} 步单列）`
    : `${outputGaps} 步存在产出缺口`,
);
