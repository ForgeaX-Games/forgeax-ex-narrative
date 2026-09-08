/**
 * Phase 3b · KAG 关系图谱 —— 蓝图 §8。
 *
 * 文件（Tree + JSONL）+ 算法实现增删改查，承载角色关系 / 场景归属等结构化查询。
 * 图数据库为**可选加速器**（GraphBackend seam）；无图数据库时纯文件 + 内存算法即可（默认）。
 *
 * 设计：节点/边都落 JSONL（追加友好、可 diff、断点续传），内存构建邻接表做查询。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { NarrativeTemplate } from "../types/narrative-ip-dna.js";

export type KagNodeType = "character" | "scene" | "item" | "event" | "concept";

export interface KagNode {
  id: string;
  type: KagNodeType;
  name: string;
  props?: Record<string, unknown>;
}

export interface KagEdge {
  from: string;
  to: string;
  /** 关系类型（如 "盟友" / "敌对" / "位于" / "持有"）。 */
  relation: string;
  /** 是否有向（默认有向；角色互为关系可设 false）。 */
  directed?: boolean;
  props?: Record<string, unknown>;
}

/** 可选图数据库加速器（seam）。无实现时全部走内存算法。 */
export interface GraphBackend {
  upsertNode(node: KagNode): Promise<void>;
  upsertEdge(edge: KagEdge): Promise<void>;
  query(cypherLike: string, params?: Record<string, unknown>): Promise<unknown[]>;
}

const NODES_FILE = "kag_nodes.jsonl";
const EDGES_FILE = "kag_edges.jsonl";

/**
 * 文件 + 算法实现的关系图谱。
 */
export class KagGraph {
  private nodes = new Map<string, KagNode>();
  private edges: KagEdge[] = [];
  /** 邻接表（含反向边，便于无向查询）：id → [{to, relation, edge}]。 */
  private adj = new Map<string, Array<{ to: string; relation: string; edge: KagEdge }>>();

  // ── CRUD ──

  upsertNode(node: KagNode): void {
    this.nodes.set(node.id, node);
    if (!this.adj.has(node.id)) this.adj.set(node.id, []);
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.adj.delete(id);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    for (const [k, list] of this.adj) {
      this.adj.set(k, list.filter((l) => l.to !== id));
    }
  }

  addEdge(edge: KagEdge): void {
    this.edges.push(edge);
    this.ensureAdj(edge.from).push({ to: edge.to, relation: edge.relation, edge });
    if (edge.directed === false) {
      this.ensureAdj(edge.to).push({ to: edge.from, relation: edge.relation, edge });
    }
  }

  removeEdge(from: string, to: string, relation?: string): void {
    this.edges = this.edges.filter(
      (e) => !(e.from === from && e.to === to && (relation === undefined || e.relation === relation)),
    );
    this.rebuildAdj();
  }

  private ensureAdj(id: string): Array<{ to: string; relation: string; edge: KagEdge }> {
    if (!this.adj.has(id)) this.adj.set(id, []);
    return this.adj.get(id)!;
  }

  private rebuildAdj(): void {
    this.adj = new Map([...this.nodes.keys()].map((id) => [id, []]));
    for (const e of this.edges) this.addEdgeToAdj(e);
  }

  private addEdgeToAdj(edge: KagEdge): void {
    this.ensureAdj(edge.from).push({ to: edge.to, relation: edge.relation, edge });
    if (edge.directed === false) {
      this.ensureAdj(edge.to).push({ to: edge.from, relation: edge.relation, edge });
    }
  }

  // ── 查询 ──

  getNode(id: string): KagNode | undefined {
    return this.nodes.get(id);
  }

  findByType(type: KagNodeType): KagNode[] {
    return [...this.nodes.values()].filter((n) => n.type === type);
  }

  /** 某节点的直接关系（出边；无向边双向可见）。 */
  relationsOf(id: string): Array<{ to: KagNode; relation: string }> {
    return (this.adj.get(id) ?? [])
      .map((l) => {
        const to = this.nodes.get(l.to);
        return to ? { to, relation: l.relation } : null;
      })
      .filter((x): x is { to: KagNode; relation: string } => x !== null);
  }

  /** 角色关系查询（语义封装）。 */
  characterRelations(characterId: string): Array<{ to: KagNode; relation: string }> {
    return this.relationsOf(characterId).filter((r) => r.to.type === "character");
  }

  /** 某场景包含的角色（"位于"/"出场"边）。 */
  charactersInScene(sceneId: string, relations: string[] = ["位于", "出场"]): KagNode[] {
    const set = new Set(relations);
    return this.edges
      .filter((e) => e.to === sceneId && set.has(e.relation))
      .map((e) => this.nodes.get(e.from))
      .filter((n): n is KagNode => !!n && n.type === "character");
  }

  /** 两节点间最短关系路径（BFS，含关系标签）。无路径返回 null。 */
  shortestPath(from: string, to: string): Array<{ node: string; relation?: string }> | null {
    if (from === to) return [{ node: from }];
    const prev = new Map<string, { node: string; relation: string }>();
    const visited = new Set<string>([from]);
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const l of this.adj.get(cur) ?? []) {
        if (visited.has(l.to)) continue;
        visited.add(l.to);
        prev.set(l.to, { node: cur, relation: l.relation });
        if (l.to === to) {
          // 回溯
          const path: Array<{ node: string; relation?: string }> = [{ node: to, relation: l.relation }];
          let p = cur;
          while (p !== from) {
            const step = prev.get(p)!;
            path.unshift({ node: p, relation: step.relation });
            p = step.node;
          }
          path.unshift({ node: from });
          return path;
        }
        queue.push(l.to);
      }
    }
    return null;
  }

  // ── 持久化（JSONL）──

  saveJsonl(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, NODES_FILE),
      [...this.nodes.values()].map((n) => JSON.stringify(n)).join("\n") + "\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(dir, EDGES_FILE),
      this.edges.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf-8",
    );
  }

  static loadJsonl(dir: string): KagGraph {
    const g = new KagGraph();
    const nodesPath = path.join(dir, NODES_FILE);
    const edgesPath = path.join(dir, EDGES_FILE);
    if (fs.existsSync(nodesPath)) {
      for (const line of fs.readFileSync(nodesPath, "utf-8").split(/\r?\n/)) {
        if (line.trim()) g.upsertNode(JSON.parse(line) as KagNode);
      }
    }
    if (fs.existsSync(edgesPath)) {
      for (const line of fs.readFileSync(edgesPath, "utf-8").split(/\r?\n/)) {
        if (line.trim()) g.addEdge(JSON.parse(line) as KagEdge);
      }
    }
    return g;
  }

  /** 同步到可选图数据库加速器（若提供）。 */
  async syncToBackend(backend: GraphBackend): Promise<void> {
    for (const n of this.nodes.values()) await backend.upsertNode(n);
    for (const e of this.edges) await backend.upsertEdge(e);
  }

  /** 节点总数。 */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /** 边总数。 */
  get edgeCount(): number {
    return this.edges.length;
  }

  /** 全部角色节点。 */
  allCharacters(): KagNode[] {
    return this.findByType("character");
  }
}

// ─────────────────────────────────────────────────────────────────
// 从 IP DNA 模板构图 + 关系网络注入（§8：喂给生成节点）
// ─────────────────────────────────────────────────────────────────

/** 角色名 → 稳定节点 id。 */
function charId(name: string): string {
  return `char:${name}`;
}

/**
 * 由顶层 template 构建关系图谱（角色节点 + 角色关系边 + 场景概念节点）。
 * 确定性：相同模板产出相同图。
 */
export function buildKagFromTemplate(template: NarrativeTemplate): KagGraph {
  const g = new KagGraph();
  for (const ch of template.characters) {
    if (!ch.name) continue;
    g.upsertNode({ id: charId(ch.name), type: "character", name: ch.name, props: { profile: ch.profile, arc: ch.arc } });
  }
  for (const ch of template.characters) {
    if (!ch.name) continue;
    for (const rel of ch.relationships ?? []) {
      if (!rel.target) continue;
      // 目标角色若未在角色列表中，也补一个占位节点，保证边可达。
      if (!g.getNode(charId(rel.target))) {
        g.upsertNode({ id: charId(rel.target), type: "character", name: rel.target });
      }
      g.addEdge({
        from: charId(ch.name),
        to: charId(rel.target),
        relation: rel.relation || "关系",
        props: rel.detail ? { detail: rel.detail } : undefined,
      });
    }
  }
  // 场景结构作为一个概念节点（细化交给生成管线）。
  if (template.worldview.scene_structure?.trim()) {
    g.upsertNode({ id: "scene:root", type: "scene", name: "场景结构", props: { desc: template.worldview.scene_structure } });
  }
  return g;
}

/**
 * 渲染"关系网络注入"文本（§8）：把角色关系网络压成简报，与算子/系统提示词一起喂当前生成节点。
 * 控制长度（默认最多 maxRelations 条），避免污染提示词预算。
 */
export function renderRelationInjection(graph: KagGraph, opts?: { maxRelations?: number }): string {
  const max = opts?.maxRelations ?? 30;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const ch of graph.allCharacters()) {
    const rels = graph.characterRelations(ch.id);
    for (const r of rels) {
      const key = `${ch.id}->${r.to.id}:${r.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`  - ${ch.name} —[${r.relation}]→ ${r.to.name}`);
      if (lines.length >= max) break;
    }
    if (lines.length >= max) break;
  }
  if (lines.length === 0) return "";
  return `## 关系网络（KAG，须在生成中保持一致）\n${lines.join("\n")}`;
}
