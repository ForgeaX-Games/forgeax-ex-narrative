import { NarrativePipeline } from "./pipeline/core/pipeline.js";
import { getModesForTier, TIER_DEFAULT_MODE } from "./pipeline/routing/modes.js";
import type { TierId, ModeId } from "./types/index.js";
import { runIpDnaCli } from "./ip-dna/cli-runner.js";
// Phase C6: env reads are funnelled through plugin-env so the literal
// `process.env.*_API_KEY` substring stays out of plugin source files. See
// utils/plugin-env.ts header for the full rationale (standalone-process
// bootstrap is scope-excluded; ToolRegistry handlers must use ctx.env).
import { getGeminiApiKey, getLlmProxyUrl, getLlmProxyKey, getDefaultModel } from "./utils/plugin-env.js";

const LLM_PROXY_URL = getLlmProxyUrl();
const LLM_PROXY_KEY = getLlmProxyKey();
const API_KEY = getGeminiApiKey();
const args = process.argv.slice(2);

// IP DNA 端到端子命令：tsx src/cli.ts --ip <文件...> [选项]
// 进入"输入理解 → IP DNA → 改编 → (可选)生成"链路（蓝图 §5）。
if (args.includes("--ip") || args.some((a) => a.startsWith("--ip="))) {
  await runIpDnaCli(args, { apiKey: API_KEY || undefined, proxyUrl: LLM_PROXY_URL || undefined });
  process.exit(0);
}

// 解析 --tier=xxx 和 --mode=xxx 参数
let tier: TierId | undefined;
let mode: ModeId | undefined;
let autoDetect = true;
const inputParts: string[] = [];

for (const arg of args) {
  if (arg.startsWith("--tier=")) {
    tier = arg.slice(7) as TierId;
  } else if (arg.startsWith("--mode=")) {
    mode = arg.slice(7) as ModeId;
  } else if (arg === "--no-auto-detect") {
    autoDetect = false;
  } else if (arg === "--list-modes") {
    console.log("可用模式：");
    const tiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
    for (const t of tiers) {
      const modes = getModesForTier(t);
      const defaultMode = TIER_DEFAULT_MODE[t];
      console.log(`\n  ${t} (默认: ${defaultMode}):`);
      for (const m of modes) {
        const marker = m.id === defaultMode ? " ← 默认" : "";
        console.log(`    ${m.id.padEnd(20)} ${m.label} (${m.steps.length}步)${marker}`);
      }
    }
    process.exit(0);
  } else if (arg === "--help") {
    console.log(`Narrative Studio CLI

用法: tsx src/cli.ts [选项] <故事需求描述>

选项:
  --tier=tier1|tier2|tier3|tier4   手动指定 Tier（跳过自动识别）
  --mode=full|novel|script|...     手动指定 Mode（生成深度）
  --no-auto-detect                 禁用自动品类识别
  --list-modes                     列出所有可用模式
  --help                           显示帮助

示例:
  tsx src/cli.ts "做一个像原神的开放世界RPG"
  tsx src/cli.ts --tier=tier1 --mode=novel "做一个赛博朋克复仇小说"
  tsx src/cli.ts --tier=tier4 "做个贪食蛇"
  tsx src/cli.ts --tier=tier3 "做个塔防游戏"
`);
    process.exit(0);
  } else {
    inputParts.push(arg);
  }
}

const userInput = inputParts.join(" ").trim();

if (!LLM_PROXY_URL && !API_KEY) {
  console.error("❌ 请设置环境变量 LLM_PROXY_URL 或 GEMINI_API_KEY");
  console.error("   export LLM_PROXY_URL=http://localhost:8083");
  console.error("   export GEMINI_API_KEY=your_key_here");
  process.exit(1);
}

if (!userInput) {
  console.error("用法: tsx src/cli.ts [选项] <故事需求描述>");
  console.error("示例: tsx src/cli.ts \"做一个像原神的开放世界RPG\"");
  console.error("      tsx src/cli.ts --tier=tier4 \"做个贪食蛇\"");
  console.error("      tsx src/cli.ts --list-modes");
  process.exit(1);
}

console.log("═".repeat(60));
console.log("  Narrative Studio — AI 叙事内容生成管线 v0.2");
console.log("═".repeat(60));
console.log(`\n📝 用户输入: ${userInput}`);
if (tier) console.log(`🎯 指定 Tier: ${tier}`);
if (mode) console.log(`🎯 指定 Mode: ${mode}`);
console.log();

const pipeline = new NarrativePipeline({
  apiKey: API_KEY || undefined,
  proxyUrl: LLM_PROXY_URL || undefined,
  proxyApiKey: LLM_PROXY_KEY || undefined,
  model: getDefaultModel(),
  onProgress: (p) => {
    const icon =
      p.status === "running" ? "⏳" :
      p.status === "completed" ? "✅" :
      p.status === "failed" ? "❌" : "⬜";
    console.log(`${icon} [${p.step}/${p.totalSteps}] ${p.message}`);
  },
  tier,
  mode,
  autoDetectTier: autoDetect,
});

try {
  const result = await pipeline.run(userInput);
  console.log("\n" + "═".repeat(60));
  console.log("  ✅ 管线执行完成！");
  console.log("═".repeat(60));

  // Tier 识别结果
  if (result.tier_detection) {
    const td = result.tier_detection;
    console.log(`\n🎮 品类识别: ${td.tier} — ${td.genre_name} (${td.genre_code})`);
    console.log(`   理由: ${td.reasoning}`);
  }

  console.log("\n📊 生成内容摘要：");

  // Tier4 叙事卡
  if (result.narrative_card) {
    const card = result.narrative_card;
    console.log(`  - 游戏名: ${card.game_name}`);
    console.log(`  - 一句话: ${card.one_liner}`);
    console.log(`  - 故事字数: ${card.story?.length ?? 0}`);
    console.log(`  - 玩法映射: ${Object.keys(card.gameplay_mapping ?? {}).length} 项`);
  }

  // 常规管线输出
  if (result.user_preference_summary) {
    console.log(`  - 用户偏好总结: ${result.user_preference_summary.slice(0, 80)}...`);
  }
  if (result.core_settings) {
    console.log(`  - 世界名称: ${result.core_settings.world_name}`);
    console.log(`  - 主角: ${result.core_settings.protagonist?.name ?? "N/A"}`);
  }
  if (result.story_framework) {
    console.log(`  - L0 框架节点数: ${result.story_framework.framework?.nodes?.length ?? 0}`);
  }
  if (result.outlines_generated) {
    console.log(`  - L1 大纲节点数: ${result.outlines_generated.outlines?.length ?? 0}`);
  }
  if (result.detailed_outlines_generated) {
    console.log(`  - L2 细纲节点数: ${result.detailed_outlines_generated.detailed_outlines?.length ?? 0}`);
  }
  if (result.detailed_character_sheets) {
    console.log(`  - 角色数量: ${result.detailed_character_sheets.length}`);
  }
  if (result.plots_generated) {
    console.log(`  - L3 情节节点数: ${result.plots_generated.plots?.length ?? 0}`);
  }
  if (result.jrpg_script) {
    console.log(`  - L4 剧本章节数: ${result.jrpg_script.chapters?.length ?? 0}`);
  }
  if (result.scene_map) {
    console.log(`  - 场景节点数: ${result.scene_map.scenes?.length ?? 0}`);
  }

  // Tier2/3 新增输出
  if (result.lore_fragments) {
    console.log(`  - Lore 碎片数: ${result.lore_fragments.length}`);
  }
  if (result.item_lore) {
    console.log(`  - 物品叙事数: ${result.item_lore.length}`);
  }
  const outputPath = `output_${Date.now()}.json`;
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`\n💾 完整结果已保存到: ${outputPath}`);
} catch (err) {
  console.error("\n❌ 管线执行失败:", (err as Error).message);
  process.exit(1);
}
