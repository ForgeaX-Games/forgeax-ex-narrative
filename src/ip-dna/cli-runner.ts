/**
 * IP DNA 端到端 CLI 子命令 —— `tsx src/cli.ts --ip <文件...> [选项]`（蓝图 §5）。
 *
 * 用法：
 *   tsx src/cli.ts --ip story.txt
 *   tsx src/cli.ts --ip a.txt b.txt --title=我的IP --mode=series --target-units=25
 *   tsx src/cli.ts --ip story.txt --generate --tier=tier1 --gen-mode=novel --max-units=1
 *
 * 选项：
 *   --title=...        故事标题（缺省取首文件名）
 *   --mode=single|series   完整游戏模式（默认 series）
 *   --target-units=N   每游戏单元最小单元数（默认 25）
 *   --complexity=1..5  目标复杂度
 *   --generate         真正跑生成管线（默认仅产出 IP DNA + 改编指令 + 生成输入）
 *   --max-units=N      最多生成多少个游戏单元（默认全部）
 *   --tier=tierN / --gen-mode=...   透传给生成管线
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { LLMClient } from "../pipeline/runtime/llm-client.js";
import { getDefaultModel } from "../utils/plugin-env.js";
import type { TierId, ModeId } from "../types/index.js";
import type { GameMode } from "../types/narrative-ip-dna.js";
import {
  runIpDnaPipeline,
  resolveIpDnaRuntimeAdapters,
  type IncomingFile,
} from "./index.js";

export interface IpDnaCliEnv {
  apiKey?: string;
  proxyUrl?: string;
}

export async function runIpDnaCli(args: string[], env: IpDnaCliEnv): Promise<void> {
  const files: string[] = [];
  let title: string | undefined;
  let mode: GameMode = "series";
  let targetUnits: number | undefined;
  let complexity: number | undefined;
  let generate = false;
  let maxUnits: number | undefined;
  let tier: TierId | undefined;
  let genMode: ModeId | undefined;

  // --ip 之后、下一个 -- 选项之前的位置参数都是文件路径。
  let collecting = false;
  for (const arg of args) {
    if (arg === "--ip") { collecting = true; continue; }
    if (arg.startsWith("--ip=")) { files.push(arg.slice(5)); collecting = true; continue; }
    if (arg.startsWith("--title=")) { title = arg.slice(8); continue; }
    if (arg.startsWith("--mode=")) { mode = arg.slice(7) as GameMode; continue; }
    if (arg.startsWith("--target-units=")) { targetUnits = Number(arg.slice(15)); continue; }
    if (arg.startsWith("--complexity=")) { complexity = Number(arg.slice(13)); continue; }
    if (arg === "--generate") { generate = true; continue; }
    if (arg.startsWith("--max-units=")) { maxUnits = Number(arg.slice(12)); continue; }
    if (arg.startsWith("--tier=")) { tier = arg.slice(7) as TierId; continue; }
    if (arg.startsWith("--gen-mode=")) { genMode = arg.slice(11) as ModeId; continue; }
    if (arg.startsWith("--")) { collecting = false; continue; }
    if (collecting) files.push(arg);
  }

  if (files.length === 0) {
    console.error("用法: tsx src/cli.ts --ip <文件...> [--title=..] [--mode=series] [--generate]");
    process.exit(1);
  }

  // 二进制扩展名（zip/图片/视频/PDF）按 Buffer 读，避免 utf-8 读取损坏压缩包/媒体字节；
  // 文本仍按 utf-8。修：此前一律 utf-8 读取导致 `--ip x.zip` 无法解压（zip 全流程测试踩坑）。
  const BINARY_EXT = new Set([
    ".zip", ".tar", ".gz", ".tgz", ".pdf",
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp4", ".mov", ".mkv", ".webm",
  ]);
  const incoming: IncomingFile[] = files.map((p) => {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      console.error(`❌ 文件不存在: ${abs}`);
      process.exit(1);
    }
    const ext = path.extname(abs).toLowerCase();
    const isBinary = BINARY_EXT.has(ext);
    return {
      fileName: path.basename(abs),
      data: isBinary ? fs.readFileSync(abs) : fs.readFileSync(abs, "utf-8"),
      fileType: isBinary ? ext.slice(1) : "text/plain",
    };
  });

  const hasLlm = !!(env.apiKey || env.proxyUrl);
  const llm = hasLlm
    ? new LLMClient({ apiKey: env.apiKey, proxyUrl: env.proxyUrl, defaultModel: getDefaultModel() })
    : undefined;

  // 本地运行时适配器（蓝图 §7，D-B）：向量化器 + 视频抽帧器 + 媒体压缩器 + zip 解压器，与 server 共用统一 helper。
  const { queryEmbedder, frameSampler, transcriber, mediaCompressor, archiveExtractor, pdfPageSplitter } = await resolveIpDnaRuntimeAdapters(process.env);

  console.log("═".repeat(60));
  console.log("  Narrative Studio — IP DNA 端到端管线（蓝图 §5）");
  console.log("═".repeat(60));
  console.log(`📂 输入文件: ${files.join(", ")}`);
  console.log(`🧬 提取模式: ${hasLlm ? "LLM" : "确定性兜底（无 key，dry-run）"}`);
  console.log(`🔎 向量检索: ${queryEmbedder ? "本地 e5 向量化（RAG vector 通道）" : "未配置（scope+tag 降级）"}`);
  console.log(`🎞️  视频抽帧: ffmpeg=${process.env.FFMPEG_PATH ?? "ffmpeg(PATH)"}`);
  console.log(`🎬 生成: ${generate ? "开启" : "关闭（仅产出 IP DNA + 改编指令 + 生成输入）"}`);
  console.log();

  const result = await runIpDnaPipeline({
    files: incoming,
    title,
    mode,
    targetUnits,
    targetComplexity: complexity,
    llm,
    queryEmbedder,
    frameSampler,
    transcriber,
    mediaCompressor,
    archiveExtractor,
    pdfPageSplitter,
    runGeneration: generate,
    maxGameUnits: maxUnits,
    tier,
    generationMode: genMode,
    pipelineConfig: {
      apiKey: env.apiKey,
      proxyUrl: env.proxyUrl,
      model: getDefaultModel(),
      complexity,
    },
    onProgress: (e) => console.log(`  [${Math.round((e.ratio ?? 0) * 100)}%] ${e.message}`),
  });

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ 完成");
  console.log("═".repeat(60));
  console.log(`📌 故事时间戳: ${result.story_timestamp}`);
  console.log(`📖 标题: ${result.title}`);
  console.log(`🌳 层级节点数: ${Object.keys(result.dna.nodes).length}`);
  console.log(`🎯 改编模式: ${result.directive.game_unit_plan.mode}，游戏单元数: ${result.directive.game_unit_plan.units.length}`);
  result.gameUnits.forEach((gu) => {
    console.log(`  - 游戏单元 ${gu.index}: ${gu.leafIds.length} 单元 / ${gu.operatorPool.length} 算子${gu.generated ? " ✓已生成" : ""}`);
  });
  console.log(`\n💾 IP DNA 已落盘到 input/${result.story_timestamp}_${result.title}/_extraction_output/`);
  if (generate) console.log(`💾 生成产物已落盘到 output/${result.story_timestamp}_${result.title}/`);
}
