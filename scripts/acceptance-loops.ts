/**
 * 三条闭环的真实跑验收。
 *
 * 单测能证明「给定输入，代码按参数算出了该算的形状」；证明不了「用户选了史诗，
 * 模型真的写出史诗那么大的一棵树」——中间隔着一次真实调用，模型完全可能无视预算。
 * 这个脚本就是去跑那一次，把两次跑的客观数字摆在一起比。
 *
 * 用法（要 .env 里的 key）：
 *   npx tsx --env-file=.env scripts/acceptance-loops.ts volume
 *   npx tsx --env-file=.env scripts/acceptance-loops.ts structure
 *   npx tsx --env-file=.env scripts/acceptance-loops.ts ip
 *
 * 判定只看结构性数字（节点数、分叉数、合流数、结局数），不判文笔——文笔要人看。
 * 每条都是**对照跑**：同一份需求只换一个变量，两次结果的差值才是那个变量的效果。
 * 单跑一次拿绝对值比对阈值没有意义，模型每次给的量本来就有波动。
 */
import { NarrativePipeline } from "../src/pipeline/core/pipeline.js";
import { getGeminiApiKey, getLlmProxyUrl, getLlmProxyKey, getDefaultModel } from "../src/utils/plugin-env.js";
import type { NarrativeContext } from "../src/types/index.js";
import type { StoryStructureCode } from "../src/knowledge/narrative-axes/story-structures.js";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DEMAND = "一个关于走私船医生的故事：他在边境海域救人，也运违禁品，直到某天救起的人认得他";

interface Shape {
  nodes: number;
  forks: number;
  merges: number;
  endings: number;
  maxDepth: number;
}

/** 从跑完的 ctx 里读出这棵树的形状。取最深那一层已生成的节点集。 */
function shapeOf(ctx: NarrativeContext): Shape {
  const outlines = ctx.outlines_generated ?? [];
  const framework = ctx.story_framework?.framework?.nodes ?? [];
  const nodes = (outlines.length > 0 ? outlines : framework) as Array<{
    node_id?: string;
    prev_node?: string[];
    next_node?: string[];
  }>;

  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    for (const next of n.next_node ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }

  const byId = new Map(nodes.map((n) => [n.node_id ?? "", n]));
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const prev = byId.get(id)?.prev_node ?? [];
    const d = prev.length === 0 ? 0 : Math.max(...prev.map((p) => depthOf(p, seen))) + 1;
    depth.set(id, d);
    return d;
  };

  return {
    nodes: nodes.length,
    forks: nodes.filter((n) => (n.next_node ?? []).length > 1).length,
    merges: [...inDegree.values()].filter((d) => d > 1).length,
    endings: nodes.filter((n) => (n.next_node ?? []).length === 0).length,
    maxDepth: nodes.length === 0 ? 0 : Math.max(...nodes.map((n) => depthOf(n.node_id ?? ""))),
  };
}

async function runOnce(label: string, config: {
  complexity?: number;
  structure?: StoryStructureCode;
}): Promise<Shape> {
  process.stdout.write(`\n── ${label} ──\n`);
  const pipeline = new NarrativePipeline({
    apiKey: getGeminiApiKey() || undefined,
    proxyUrl: getLlmProxyUrl() || undefined,
    proxyApiKey: getLlmProxyKey() || undefined,
    model: getDefaultModel(),
    tier: "tier1",
    mode: "story_outline",
    autoDetectTier: false,
    complexity: config.complexity,
    narrativeAxes: config.structure ? { structure: config.structure } : undefined,
    onProgress: (p) => {
      if (p.status === "completed") process.stdout.write(`  ✓ ${p.message}\n`);
      if (p.status === "failed") process.stdout.write(`  ✗ ${p.message}\n`);
    },
  });
  const ctx = await pipeline.run(DEMAND);
  const shape = shapeOf(ctx);
  process.stdout.write(`  形状: ${JSON.stringify(shape)}\n`);
  return shape;
}

function verdict(pass: boolean, line: string): void {
  process.stdout.write(`${pass ? "通过" : "不通过"} — ${line}\n`);
  if (!pass) process.exitCode = 1;
}

/** 闭环一：选了史诗，真的产出史诗。 */
async function volumeLoop(): Promise<void> {
  const minimal = await runOnce("极简（体量 1）", { complexity: 1 });
  const epic = await runOnce("史诗（体量 5）", { complexity: 5 });
  process.stdout.write("\n═══ 闭环一：选了史诗，真的产出史诗 ═══\n");
  verdict(
    epic.nodes > minimal.nodes,
    `节点数 ${minimal.nodes} → ${epic.nodes}（体量必须换来更多节点，否则用户选的档位没进到生成里）`,
  );
  verdict(
    epic.maxDepth >= minimal.maxDepth,
    `最大深度 ${minimal.maxDepth} → ${epic.maxDepth}（史诗不该比极简更浅）`,
  );
}

/** 闭环二：投票出鱼骨，树真的长成鱼骨。 */
async function structureLoop(): Promise<void> {
  const fishbone = await runOnce("鱼骨（侧支必回主骨）", { complexity: 3, structure: "fishbone" });
  const tree = await runOnce("纯树状（分了不回头）", { complexity: 3, structure: "tree" });
  process.stdout.write("\n═══ 闭环二：投票出鱼骨，树真的长成鱼骨 ═══\n");
  verdict(
    fishbone.merges >= tree.merges,
    `合流数 鱼骨 ${fishbone.merges} vs 树状 ${tree.merges}（鱼骨的侧支必须回主骨，树状分了不回头）`,
  );
  verdict(
    fishbone.endings <= tree.endings,
    `结局数 鱼骨 ${fishbone.endings} vs 树状 ${tree.endings}（鱼骨少数结局，树状多结局）`,
  );
}

/**
 * 闭环三：IP 原作的结构，真的保留下来了。
 *
 * 素材是一部形状明确的短篇——七次循环顺序推进，八段线性、单结局，一个分叉都没有。
 * 形状越干净，"没保留"就越藏不住：改编成一棵多结局的分叉树，一眼就看得出来。
 *
 * 这一条与前两条不同，不是对照跑：原作只有一个，比的是改编结果与**原作自己的形状**。
 */
async function ipLoop(): Promise<void> {
  const source = path.join(import.meta.dirname, "fixtures", "ip-linear-sample.md");
  process.stdout.write(`\n── IP 改编（原作八段线性、单结局）──\n`);

  /**
   * 走真实 CLI 而不是在这里拼一遍管线参数：改编入口的参数有十几个（运行时适配器、
   * 体量、生成开关、下游 tier/mode），照抄一份就是照抄一份会过期的组装逻辑，
   * 而这个脚本要验的恰恰是**用户真的跑那条命令**会得到什么。
   */
  const cli = spawnSync(
    "npx",
    [
      "tsx", "--env-file=.env", "src/cli.ts",
      "--ip", source,
      "--title=第七次日落",
      "--complexity=3",
      "--generate",
      "--tier=tier1",
      "--gen-mode=story_outline",
    ],
    { cwd: path.join(import.meta.dirname, ".."), encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (cli.status !== 0) {
    process.stdout.write(`改编没跑完（退出码 ${cli.status}）：\n${cli.stderr?.slice(-1200) ?? ""}\n`);
    process.exitCode = 1;
    return;
  }

  const dir = latestOutputDir("第七次日落");
  if (!dir) {
    process.stdout.write("跑完了但没找到产物目录\n");
    process.exitCode = 1;
    return;
  }
  const unit = JSON.parse(await readFile(path.join(dir, "game_unit_1.json"), "utf-8")) as {
    result?: NarrativeContext;
  };
  const ctx = unit.result;
  if (!ctx) {
    process.stdout.write(`产物在 ${dir}，但里面没有生成结果\n`);
    process.exitCode = 1;
    return;
  }
  const shape = shapeOf(ctx);
  process.stdout.write(`  结构轴: ${ctx.narrative_axes?.structure ?? "（未定）"}\n`);
  process.stdout.write(`  形状: ${JSON.stringify(shape)}\n`);

  process.stdout.write("\n═══ 闭环三：IP 原作的结构，真的保留下来了 ═══\n");
  verdict(
    ctx.narrative_axes?.structure === "linear",
    `结构轴 = ${ctx.narrative_axes?.structure}（原作形状要成为这次改编的结构轴，否则生成侧按缺省参数长树）`,
  );
  verdict(
    shape.endings === 1,
    `结局数 ${shape.endings}（线性结构收敛到一个结局；多出来的结局说明结构只进了提示词、没进约束）`,
  );
  verdict(
    shape.forks === 0 || shape.merges >= shape.forks,
    `分叉 ${shape.forks} / 合流 ${shape.merges}（线性允许万不得已开一处，但必须收束回主链）`,
  );
}

/** 本次跑出来的产物目录（同名标题会有多份，取最新那份）。 */
function latestOutputDir(title: string): string | null {
  const root = path.join(import.meta.dirname, "..", "output");
  if (!existsSync(root)) return null;
  const hits = readdirSync(root).filter((d) => d.endsWith(`_${title}`)).sort();
  const last = hits[hits.length - 1];
  return last ? path.join(root, last) : null;
}

const which = process.argv[2];
const loops: Record<string, () => Promise<void>> = {
  volume: volumeLoop,
  structure: structureLoop,
  ip: ipLoop,
};
const run = loops[which ?? ""];
if (!run) {
  process.stdout.write(`用法: tsx scripts/acceptance-loops.ts <${Object.keys(loops).join("|")}>\n`);
  process.exit(2);
}
await run();
