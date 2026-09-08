/**
 * Scene Aggregator — pure algorithmic merge engine (no LLM calls).
 *
 * Ported from v3 scene_aggregator_agent.py.
 * Pipeline: sanitize → merge duplicates → fix parents → infer levels →
 *           depth clip → outdoor placeholders → assign tree UIDs → validate → MD
 */
import type { SceneNode, SceneDescription, SceneLabel, SceneMap } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Internal mutable representation used during aggregation
// ---------------------------------------------------------------------------
interface RawScene {
  name: string;
  parent: string;
  scene_level: number | null;
  label: SceneLabel[];
  description: SceneDescription;
  story_units?: string[];
  _processor_index?: number;
  _is_outdoor_placeholder?: boolean;
  uid?: string;
  parent_uid?: string | null;
  parent_name?: string | null;
  parent_level?: number | null;
}

const VALID_LABELS: Set<string> = new Set(["narrative", "decoration", "path", "entrance"]);
const MAX_DEPTH = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AggregationResult {
  scenes: SceneNode[];
  structureMd: string;
  /** name → uid lookup for back-filling intermediate outputs */
  uidMap: Map<string, string>;
}

/**
 * Full aggregation pipeline: skeleton (L0-L2) + expanded batches (L3-L5)
 * → deduplicated, tree-repaired, uid-assigned SceneNode[].
 */
export function aggregateScenes(
  worldName: string,
  skeletonScenes: RawScene[],
  expandedBatches: Array<{ processorIndex: number; scenes: RawScene[] }>,
): AggregationResult {
  const allRaw: RawScene[] = [];

  for (const s of skeletonScenes) {
    allRaw.push({ ...s, _processor_index: -1 });
  }
  for (const batch of expandedBatches) {
    for (const s of batch.scenes) {
      if (s.scene_level != null && s.scene_level < 3) continue;
      allRaw.push({ ...s, _processor_index: batch.processorIndex });
    }
  }

  sanitizeNames(allRaw);

  const [normalized, seenNames] = mergeDuplicateScenes(allRaw);

  const nameToScene = buildNameMap(normalized);

  ensureWorldRoot(normalized, nameToScene, seenNames, worldName);

  fixParentReferences(normalized, nameToScene, seenNames, worldName);

  const childrenMap = buildChildrenMap(normalized);

  inferLevels(normalized, nameToScene);

  clipDepth(normalized, nameToScene, MAX_DEPTH);

  const childrenMap2 = buildChildrenMap(normalized);

  insertOutdoorPlaceholders(normalized, nameToScene, childrenMap2, seenNames);

  assignTreeUids(worldName, nameToScene, childrenMap2);

  fillParentMeta(normalized, nameToScene);

  for (const s of normalized) {
    delete s._processor_index;
    delete s._is_outdoor_placeholder;
  }

  const scenes = normalized.map(toSceneNode);

  repairStoryUnitsCoverage(scenes, expandedBatches);

  const structureMd = buildSceneStructureMd(scenes);

  const uidMap = new Map<string, string>();
  for (const s of scenes) {
    uidMap.set(s.name, s.uid);
  }

  return { scenes, structureMd, uidMap };
}

/**
 * Build per-node MD tree from a subset of scenes.
 */
export function buildPerNodeMd(scenes: SceneNode[]): string {
  const lines: string[] = [];
  for (const s of scenes) {
    const lvl = s.scene_level;
    lines.push(`- L${lvl} ${s.name} (parent: ${s.parent || "root"})`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Step 1: Sanitize names — remove special chars, trim whitespace
// ---------------------------------------------------------------------------

function sanitizeNames(scenes: RawScene[]): void {
  for (const s of scenes) {
    s.name = sanitizeName(s.name);
    if (s.parent) s.parent = sanitizeName(s.parent);
  }
}

function sanitizeName(raw: string): string {
  if (!raw) return raw;
  return raw.replace(/[\s\-_()（）【】[\]]/g, "").trim();
}

// ---------------------------------------------------------------------------
// Step 2: Merge duplicate scenes
// ---------------------------------------------------------------------------

function mergeDuplicateScenes(scenes: RawScene[]): [RawScene[], Set<string>] {
  // Phase A — (name, parent) dedup
    const keyBest = new Map<string, RawScene>();
  const keyOrder: string[] = [];

  for (const scene of scenes) {
    const name = scene.name;
    if (!name) continue;
    const parent = scene.parent || "";
    const key = `${name}\0${parent}`;
    if (!keyBest.has(key)) {
      keyBest.set(key, scene);
      keyOrder.push(key);
    } else {
      const existing = keyBest.get(key)!;
      existing.label = mergeLabels(existing.label, scene.label);
      existing.description = mergeDescriptions(existing.description, scene.description);
      existing.story_units = mergeStoryUnits(existing.story_units, scene.story_units);
    }
  }

  // Phase B — same name, different parent → disambiguate
  const nameKeys = new Map<string, string[]>();
  for (const key of keyOrder) {
    const name = key.split("\0")[0];
    if (!nameKeys.has(name)) nameKeys.set(name, []);
    nameKeys.get(name)!.push(key);
  }

  const renameMap = new Map<string, string>();
  const seenFinal = new Set<string>();

  for (const [name, keys] of nameKeys) {
    renameMap.set(keys[0], name);
    seenFinal.add(name);
    for (let i = 1; i < keys.length; i++) {
      const parent = keys[i].split("\0")[1];
      let candidate = parent ? `${parent}${name}` : name;
      const base = candidate;
      let c = 1;
      while (seenFinal.has(candidate)) {
        candidate = `${base}${c}`;
        c++;
      }
      renameMap.set(keys[i], candidate);
      seenFinal.add(candidate);
    }
  }

  // Phase C — apply renames + cascade parent fixes
  const procRename = new Map<string, Map<number, string>>();
  for (const [key, newName] of renameMap) {
    const oldName = key.split("\0")[0];
    if (oldName !== newName) {
      const pidx = keyBest.get(key)!._processor_index ?? -1;
      if (!procRename.has(oldName)) procRename.set(oldName, new Map());
      procRename.get(oldName)!.set(pidx, newName);
    }
  }

  const normalized: RawScene[] = [];
  const seenNames = new Set<string>();
  for (const key of keyOrder) {
    const scene = keyBest.get(key)!;
    scene.name = renameMap.get(key) ?? key.split("\0")[0];
    seenNames.add(scene.name);
    normalized.push(scene);
  }

  for (const scene of normalized) {
    const p = scene.parent;
    if (!p || !procRename.has(p)) continue;
    const pidx = scene._processor_index ?? -1;
    const renames = procRename.get(p)!;
    if (renames.has(pidx)) {
      scene.parent = renames.get(pidx)!;
    } else if (renames.has(-1)) {
      scene.parent = renames.get(-1)!;
    } else if (renames.size > 0) {
      // Fallback: child's processor doesn't match any renamed parent's processor.
      // Pick the rename whose processor index is closest, or just the first one.
      // Also merge story_units into the target to prevent coverage loss.
      const fallback = renames.values().next().value;
      if (fallback) scene.parent = fallback;
    }
  }

  return [normalized, seenNames];
}

function mergeLabels(a: SceneLabel[], b: SceneLabel[]): SceneLabel[] {
  const set = new Set([...a, ...b]);
  return set.size > 0 ? [...set] : ["narrative"];
}

function mergeStoryUnits(a?: string[], b?: string[]): string[] | undefined {
  if (!a?.length && !b?.length) return undefined;
  const set = new Set([...(a ?? []), ...(b ?? [])]);
  return [...set].sort();
}

function mergeDescriptions(a: SceneDescription, b: SceneDescription): SceneDescription {
  return {
    location_description: longer(a.location_description, b.location_description),
    art_style_description: longer(a.art_style_description, b.art_style_description),
    semantics_description: longer(a.semantics_description, b.semantics_description),
  };
}

function longer(a: string, b: string): string {
  return (b || "").length > (a || "").length ? b : a;
}

// ---------------------------------------------------------------------------
// Step 3: Ensure world root (L0)
// ---------------------------------------------------------------------------

function ensureWorldRoot(
  scenes: RawScene[], nameMap: Map<string, RawScene>,
  seenNames: Set<string>, worldName: string,
): void {
  if (nameMap.has(worldName)) return;
  const root: RawScene = {
    name: worldName,
    parent: "",
    scene_level: 0,
    label: ["narrative"],
    description: {
      location_description: `${worldName} — 游戏世界根节点`,
      art_style_description: "",
      semantics_description: "世界根节点",
    },
  };
  scenes.unshift(root);
  nameMap.set(worldName, root);
  seenNames.add(worldName);
}

// ---------------------------------------------------------------------------
// Step 4: Fix parent references
// ---------------------------------------------------------------------------

function fixParentReferences(
  scenes: RawScene[], nameMap: Map<string, RawScene>,
  seenNames: Set<string>, worldName: string,
): void {
  for (const scene of scenes) {
    if (scene.name === worldName) {
      scene.parent = "";
      continue;
    }
    if (scene.parent === scene.name) {
      scene.parent = worldName;
      if (scene.scene_level == null) scene.scene_level = 1;
    }
    if (scene.parent && !seenNames.has(scene.parent)) {
      scene.parent = worldName;
      if (scene.scene_level == null) scene.scene_level = 1;
    }
    if (!scene.parent) {
      scene.parent = worldName;
      if (scene.scene_level == null) scene.scene_level = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 5: Infer missing levels
// ---------------------------------------------------------------------------

function inferLevels(scenes: RawScene[], nameMap: Map<string, RawScene>): void {
  function infer(name: string, visited: Set<string>): number {
    if (visited.has(name)) return 1;
    visited.add(name);
    const s = nameMap.get(name);
    if (!s) return 1;
    if (typeof s.scene_level === "number" && s.scene_level >= 0) return s.scene_level;
    const parent = s.parent;
    if (!parent || !nameMap.has(parent)) {
      s.scene_level = 1;
      return 1;
    }
    const parentLevel = infer(parent, visited);
    s.scene_level = Math.min(parentLevel + 1, MAX_DEPTH);
    return s.scene_level;
  }

  for (const s of scenes) {
    if (s.scene_level == null) {
      infer(s.name, new Set());
    }
  }
}

// ---------------------------------------------------------------------------
// Step 6: Clip depth > MAX_DEPTH
// ---------------------------------------------------------------------------

function clipDepth(scenes: RawScene[], nameMap: Map<string, RawScene>, maxDepth: number): void {
  function getChain(name: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let curr: string | undefined = name;
    while (curr && !seen.has(curr) && nameMap.has(curr)) {
      chain.push(curr);
      seen.add(curr);
      const pName: string = nameMap.get(curr)!.parent;
      curr = pName || undefined;
    }
    return chain.reverse();
  }

  for (const scene of scenes) {
    const chain = getChain(scene.name);
    const depth = chain.length - 1;
    if (depth > maxDepth) {
      const reparentTo = chain[maxDepth] ?? chain[chain.length - 1];
      if (reparentTo && scene.name !== reparentTo) {
        scene.parent = reparentTo;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 7: Outdoor placeholders — L5 directly under L2 inserts virtual L3/L4
// ---------------------------------------------------------------------------

function insertOutdoorPlaceholders(
  scenes: RawScene[], nameMap: Map<string, RawScene>,
  childrenMap: Map<string, string[]>, seenNames: Set<string>,
): void {
  const outdoorGroups = new Map<string, RawScene[]>();

  for (const scene of [...scenes]) {
    if (scene.scene_level !== 5) continue;
    const parentName = scene.parent;
    if (!parentName) continue;
    const parentScene = nameMap.get(parentName);
    if (!parentScene || parentScene.scene_level !== 2) continue;
    if (!outdoorGroups.has(parentName)) outdoorGroups.set(parentName, []);
    outdoorGroups.get(parentName)!.push(scene);
  }

  for (const [l2Name, l5Scenes] of outdoorGroups) {
    const l3Name = `${l2Name}户外`;
    const l4Name = `${l2Name}室外`;

    if (!nameMap.has(l3Name)) {
      const l3: RawScene = {
        name: l3Name, scene_level: 3, parent: l2Name,
        label: ["decoration"], _is_outdoor_placeholder: true,
        description: {
          location_description: `${l2Name}的室外户外区域`,
          art_style_description: "",
          semantics_description: `虚拟占位节点，承载${l2Name}的室外物品`,
        },
      };
      scenes.push(l3);
      nameMap.set(l3Name, l3);
      seenNames.add(l3Name);
      if (!childrenMap.has(l2Name)) childrenMap.set(l2Name, []);
      childrenMap.get(l2Name)!.push(l3Name);
    }

    if (!nameMap.has(l4Name)) {
      const l4: RawScene = {
        name: l4Name, scene_level: 4, parent: l3Name,
        label: ["decoration"], _is_outdoor_placeholder: true,
        description: {
          location_description: `${l2Name}的室外开放空间`,
          art_style_description: "",
          semantics_description: `虚拟占位节点，承载${l2Name}的室外物品`,
        },
      };
      scenes.push(l4);
      nameMap.set(l4Name, l4);
      seenNames.add(l4Name);
      if (!childrenMap.has(l3Name)) childrenMap.set(l3Name, []);
      childrenMap.get(l3Name)!.push(l4Name);
    }

    for (const scene of l5Scenes) {
      const oldParent = scene.parent;
      scene.parent = l4Name;
      const oldList = childrenMap.get(oldParent);
      if (oldList) {
        const idx = oldList.indexOf(scene.name);
        if (idx >= 0) oldList.splice(idx, 1);
      }
      if (!childrenMap.has(l4Name)) childrenMap.set(l4Name, []);
      childrenMap.get(l4Name)!.push(scene.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Step 8: Assign hierarchical UIDs via DFS
// ---------------------------------------------------------------------------

function assignTreeUids(
  worldName: string, nameMap: Map<string, RawScene>,
  childrenMap: Map<string, string[]>,
): void {
  function walk(name: string, level: number, uid: string, parentUid: string | null): void {
    const scene = nameMap.get(name);
    if (!scene) return;
    scene.scene_level = level;
    scene.uid = uid;
    scene.parent_uid = parentUid;

    const children = [...(childrenMap.get(name) ?? [])].sort();
    const real: string[] = [];
    const placeholders: string[] = [];
    for (const child of children) {
      const cs = nameMap.get(child);
      if (cs?._is_outdoor_placeholder) placeholders.push(child);
      else real.push(child);
    }

    for (let i = 0; i < real.length; i++) {
      walk(real[i], Math.min(level + 1, MAX_DEPTH), `${uid}-${i}`, uid);
    }
    for (const child of placeholders) {
      walk(child, Math.min(level + 1, MAX_DEPTH), `${uid}-x`, uid);
    }
  }

  walk(worldName, 0, "0", null);
}

// ---------------------------------------------------------------------------
// Step 9: Fill parent_name / parent_level
// ---------------------------------------------------------------------------

function fillParentMeta(scenes: RawScene[], nameMap: Map<string, RawScene>): void {
  for (const scene of scenes) {
    const parentName = scene.parent || null;
    if (parentName) {
      scene.parent_name = parentName;
      const ps = nameMap.get(parentName);
      scene.parent_level = ps?.scene_level ?? null;
    } else {
      scene.parent_name = null;
      scene.parent_level = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Post-merge: repair story_units coverage lost during parent renames
// ---------------------------------------------------------------------------

function repairStoryUnitsCoverage(
  scenes: SceneNode[],
  expandedBatches: Array<{ processorIndex: number; scenes: RawScene[] }>,
): void {
  const coveredUnits = new Set<string>();
  for (const s of scenes) {
    for (const u of s.story_units ?? []) coveredUnits.add(u);
  }

  const nameIndex = new Map<string, SceneNode[]>();
  for (const s of scenes) {
    if (!nameIndex.has(s.name)) nameIndex.set(s.name, []);
    nameIndex.get(s.name)!.push(s);
  }

  for (const batch of expandedBatches) {
    for (const raw of batch.scenes) {
      for (const unit of raw.story_units ?? []) {
        if (coveredUnits.has(unit)) continue;
        // This unit was lost — find the best matching final scene by name
        const candidates = nameIndex.get(raw.name);
        if (candidates?.length) {
          // Prefer the one whose parent contains the original parent or vice versa
          const best = candidates.find(c =>
            (c.parent ?? "").includes(raw.parent) || raw.parent.includes(c.parent ?? ""),
          ) ?? candidates[0];
          if (!best.story_units) best.story_units = [];
          if (!best.story_units.includes(unit)) {
            best.story_units.push(unit);
            best.story_units.sort();
          }
          coveredUnits.add(unit);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

function toSceneNode(raw: RawScene): SceneNode {
  return {
    uid: raw.uid ?? "",
    name: raw.name,
    parent: raw.parent,
    parent_uid: raw.parent_uid ?? null,
    parent_name: raw.parent_name ?? null,
    parent_level: raw.parent_level ?? null,
    scene_level: raw.scene_level ?? 0,
    label: normalizeLabels(raw.label),
    description: normalizeDescription(raw.description),
    story_units: raw.story_units,
    level: raw.scene_level ?? 0,
  };
}

function normalizeLabels(labels: SceneLabel[] | string | unknown): SceneLabel[] {
  if (Array.isArray(labels)) {
    const valid = labels.filter(l => VALID_LABELS.has(l as string)) as SceneLabel[];
    return valid.length > 0 ? valid : ["narrative"];
  }
  if (typeof labels === "string" && VALID_LABELS.has(labels)) return [labels as SceneLabel];
  return ["narrative"];
}

function normalizeDescription(desc: SceneDescription | string | unknown): SceneDescription {
  if (typeof desc === "object" && desc !== null) {
    const d = desc as Record<string, unknown>;
    return {
      location_description: String(d.location_description ?? d.location ?? ""),
      art_style_description: String(d.art_style_description ?? d.art_style ?? ""),
      semantics_description: String(d.semantics_description ?? d.semantics ?? ""),
    };
  }
  const str = typeof desc === "string" ? desc : "";
  return {
    location_description: str,
    art_style_description: "",
    semantics_description: "",
  };
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function buildNameMap(scenes: RawScene[]): Map<string, RawScene> {
  const map = new Map<string, RawScene>();
  for (const s of scenes) {
    if (s.name) map.set(s.name, s);
  }
  return map;
}

function buildChildrenMap(scenes: RawScene[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const s of scenes) {
    if (!s.name || !s.parent) continue;
    if (!map.has(s.parent)) map.set(s.parent, []);
    map.get(s.parent)!.push(s.name);
  }
  return map;
}

// ---------------------------------------------------------------------------
// MD tree generation
// ---------------------------------------------------------------------------

export function buildSceneStructureMd(scenes: SceneNode[]): string {
  if (!scenes.length) return "";
  const nameMap = new Map(scenes.map(s => [s.name, s]));
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];

  for (const s of scenes) {
    if (s.parent) {
      if (!childrenMap.has(s.parent)) childrenMap.set(s.parent, []);
      childrenMap.get(s.parent)!.push(s.name);
    } else {
      roots.push(s.name);
    }
  }

  const lines = ["# 场景结构目录", ""];

  function walk(name: string, depth: number): void {
    const sc = nameMap.get(name);
    const lvl = sc?.scene_level ?? "?";
    const uid = sc?.uid ?? "";
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- L${lvl} ${name} (uid=${uid})`);
    for (const child of [...(childrenMap.get(name) ?? [])].sort()) {
      walk(child, depth + 1);
    }
  }

  for (const root of roots.sort()) {
    walk(root, 0);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helper to convert legacy flat SceneNode[] to RawScene[] for aggregation input
// ---------------------------------------------------------------------------

export function skeletonToRaw(
  skeletonScenes: Array<{ name: string; parent?: string; description?: unknown; level?: number; label?: unknown }>,
): RawScene[] {
  return skeletonScenes.map(s => ({
    name: s.name,
    parent: s.parent ?? "",
    scene_level: s.level ?? 0,
    label: normalizeLabels(s.label),
    description: normalizeDescription(s.description),
  }));
}

export function expandedToRaw(
  expanded: Array<{ name: string; parent?: string; description?: unknown; level?: number; label?: unknown; story_units?: string[] }>,
  processorIndex: number,
): { processorIndex: number; scenes: RawScene[] } {
  return {
    processorIndex,
    scenes: expanded.map(s => ({
      name: s.name,
      parent: s.parent ?? "",
      scene_level: s.level ?? 3,
      label: normalizeLabels(s.label),
      description: normalizeDescription(s.description),
      story_units: s.story_units,
    })),
  };
}
