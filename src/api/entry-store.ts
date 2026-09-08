import fs from "node:fs";
import path from "node:path";

/**
 * §条目持久化（统一"条目"模型，无"草稿"一说）。
 *
 * 一次用户需求 = 一个条目，键为首次输入确认时前端铸造的 `<时间戳>`。条目的**全部参数**
 * （INPUT 参数 + ROUTING 参数）落盘到 `output/<key>/_entry.json`，与生成产物同处一个目录，
 * 使"确认输入即建条目、任何阶段点击都能还原 INPUT/ROUTING(+结果)"成立。
 *
 * 与 input/ 的分工：input/ 只存"输入了什么"（IP 作品整条媒体处理链：原始→标准化→压缩→结构化 IP DNA）。
 * IP 作品的 ROUTING 参数仍归 output/<key>/_entry.json，用 `ipRunKey=<时间戳>_<标题>` 指针桥接到媒体目录。
 */
export interface EntryConfig {
  key?: string;
  /** INPUT 来源类型：文本 / 标签 / IP 作品上传。 */
  inputType?: "text" | "tags" | "works";
  userInput?: string;
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  uploadedFileNames?: string[];
  routeGroup?: "planning" | "narrative";
  /** 叙事层级：三期起由 genreCode 派生的只读值，不再是用户选择项。 */
  tier?: string;
  mode?: string;
  genreCode?: string;
  /** 三轴路由（PRD v1.4 §3.2.2）；旧条目无这三个字段，读取端一律按可空处理。 */
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  /** 叙事体量档位（1-5）。 */
  complexity?: number;
  /** UI locale for generated narrative content (en/zh). */
  locale?: "en" | "zh";
  /** IP 作品桥接指针：指向 input 媒体目录下的运行键（<时间戳>_<标题>）。 */
  ipRunKey?: string;
  /** 完成态分叉来源条目键（本条目由某已完成条目改配置后新建）。 */
  parentKey?: string;
  /**
   * Phase-1 多管线条目：一条目 = 一组 RunManifest（按独立开始节点切分）。
   * 形状与 types/run-manifest.RunManifest 对齐；旧条目无此字段时视为单管线。
   */
  pipelines?: unknown[];
  /** 当前聚焦的管线 id（状态栏/文本视图默认展示）。 */
  activePipelineId?: string;
  /** LIST 是否展开显示多管线子行。 */
  listExpanded?: boolean;
  /**
   * 资产库（PRD v1.4 §5.1，契约见 docs/contracts.md §三）：作者确认、可供下游
   * 生成引用的产物 —— 也就是「这个条目里哪些是定稿」这张**确认状态表**。
   *
   * 与项目库的分工：确认是"这份文件定稿了"，归档是"这份定稿归到项目 X 的类别 Y"，
   * 两件正交的事各有事实源。确认状态落在产物旁边，因为下游生成按条目跑，它要问的
   * 就是"这个条目里哪些是定稿"，不该为此去遍历所有项目。
   *
   * 元素形状：历史上是裸路径 `string`，现升级为带版本的 `AssetRef`。两种并存，
   * 读侧一律经 `normalizeAssets` 归一 —— 旧条目不迁移也能读。
   */
  assets?: Array<string | AssetRef>;
  /** 画布编排拓扑快照（nodes/edges），供刷新恢复。 */
  compositionNodes?: unknown[];
  compositionEdges?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 已确认产物的引用（docs/contracts.md §3.2）。
 *
 * 不含文件本体：条目目录本身就是不可变事实源（改配置重生成会铸新 entryKey fork，
 * 原条目全量保留），复制一份只会造出第二个"这是哪一版"说不清的事实源。
 */
export interface AssetRef {
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  /**
   * 泳道；缺省 = 主管线。
   *
   * 一个条目可以并跑多条管线，各自落在 `<entryKey>/pipelines/<pipelineId>/` 下，
   * 产物相对路径完全同名。少了这一元，两条泳道的同名产物在确认表里会互相顶掉 ——
   * 用户确认了 B 泳道的世界观，A 泳道的那份会跟着变成"已确认"。
   */
  pipelineId?: string;
  /**
   * 钉住的版本号；缺省表示"跟随最新"。
   *
   * 钉住与跟随是两种真实需求，不能只留一种：作者说"就用这一稿"要钉住（此后重生成
   * 不改变下游读到的东西），说"用最新的"则要跟随。所以缺省不写 1，写 1 会把"跟随"
   * 悄悄变成"钉在初稿"。
   */
  version?: number;
  /** 确认时间；用于展示"什么时候定的稿"。 */
  confirmedAt?: string;
}

/** 一条确认记录的身份：泳道 + 路径。同名产物靠泳道分开。 */
const assetKey = (ref: { path: string; pipelineId?: string }): string =>
  `${ref.pipelineId ?? ""}::${ref.path}`;

/** 归一化 `assets[]`：裸路径按"主管线 + 跟随最新"处理，非法项丢掉。 */
export function normalizeAssets(assets: EntryConfig["assets"]): AssetRef[] {
  if (!Array.isArray(assets)) return [];
  const out: AssetRef[] = [];
  for (const a of assets) {
    if (typeof a === "string") {
      if (a.trim()) out.push({ path: a.trim() });
      continue;
    }
    if (a && typeof a.path === "string" && a.path.trim()) {
      out.push({
        path: a.path.trim(),
        pipelineId: typeof a.pipelineId === "string" && a.pipelineId.trim() ? a.pipelineId.trim() : undefined,
        version: Number.isInteger(a.version) && a.version! > 0 ? a.version : undefined,
        confirmedAt: typeof a.confirmedAt === "string" ? a.confirmedAt : undefined,
      });
    }
  }
  // 同一泳道的同一路径只留最后一条：重复确认是改版本钉住，不是攒两条互相矛盾的记录。
  const byKey = new Map(out.map((a) => [assetKey(a), a]));
  return [...byKey.values()];
}

/** 确认一份产物为定稿（`version` 缺省 = 跟随最新）；已确认则更新钉住的版本。 */
export function confirmAsset(
  assets: EntryConfig["assets"],
  ref: { path: string; pipelineId?: string; version?: number },
): AssetRef[] {
  const next = normalizeAssets(assets).filter((a) => assetKey(a) !== assetKey(ref));
  next.push({
    path: ref.path,
    pipelineId: ref.pipelineId,
    version: Number.isInteger(ref.version) && ref.version! > 0 ? ref.version : undefined,
    confirmedAt: new Date().toISOString(),
  });
  return next;
}

/** 撤销确认。 */
export function unconfirmAsset(
  assets: EntryConfig["assets"],
  ref: { path: string; pipelineId?: string } | string,
): AssetRef[] {
  const target = typeof ref === "string" ? { path: ref } : ref;
  return normalizeAssets(assets).filter((a) => assetKey(a) !== assetKey(target));
}

/** 一条泳道启动后才知道的落盘事实。 */
export interface PipelineLocation {
  /** 产物目录（相对 `output/`）：主管线 = 条目键，次管线 = `<key>/pipelines/<pipelineId>`。 */
  sourceDir: string;
  primary: boolean;
}

/**
 * 把「泳道 → 产物目录」这个只有启动时刻知道的事实合并进 `pipelines[]` 快照。
 *
 * 为什么必须落盘而不能让读侧推：主管线的产物落条目根、次管线落子目录，而"谁是主"
 * 取决于启动时哪几条真跑起来了 —— 跳过一条（缺需求、带跑不起来的步），按清单下标
 * 推主次就全错，读侧会安静地读到另一条泳道的文件。
 *
 * 只认 pipelineId 匹配，不按下标对齐：`pipelines[]` 是全部计划管线，locations 只覆盖
 * 真启动了的那几条。未命中的原样保留（它还没有产物，也就没有目录可记）。
 */
export function applyPipelineLocations(
  pipelines: readonly unknown[],
  locations: ReadonlyMap<string, PipelineLocation>,
): unknown[] {
  if (locations.size === 0) return [...pipelines];
  return pipelines.map((p) => {
    const snap = p as { pipelineId?: string };
    const hit = snap?.pipelineId ? locations.get(snap.pipelineId) : undefined;
    return hit ? { ...snap, sourceDir: hit.sourceDir, primary: hit.primary } : p;
  });
}

/** key 安全校验：仅允许安全的相对目录名（防目录穿越）。 */
export function isSafeKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_.-]+$/.test(key) && !key.includes("..");
}

/**
 * sourceDir 安全校验（防目录穿越）。
 *
 * 与 `isSafeKey` 分开是因为 sourceDir 可以是次管线的 `<entryKey>/pipelines/<pipelineId>`，
 * 天生带斜杠 —— 拿 `isSafeKey` 去校验会把所有次管线一并拒掉。所以这里放行斜杠、
 * 逐段用 `isSafeKey` 校验，`..` 与绝对路径都落在段校验里被拦住。
 */
export function isSafeSourceDir(dir: unknown): dir is string {
  if (typeof dir !== "string" || !dir.trim()) return false;
  const parts = dir.split("/");
  return parts.length > 0 && parts.every((p) => isSafeKey(p));
}

/** _entry.json 在 output/<key>/ 下的绝对路径。 */
export function entryPath(outputDir: string, key: string): string {
  return path.join(outputDir, key, "_entry.json");
}

/** 读取条目配置；不存在或损坏返回 null。 */
export function loadEntry(outputDir: string, key: string): EntryConfig | null {
  if (!isSafeKey(key)) return null;
  const p = entryPath(outputDir, key);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as EntryConfig;
  } catch {
    return null;
  }
}

/**
 * upsert 条目配置到 output/<key>/_entry.json。合并语义：保留已有 createdAt，
 * 刷新 updatedAt，patch 中 undefined 字段不覆盖既有值。返回落盘后的完整配置。
 */
export function writeEntry(outputDir: string, key: string, patch: Partial<EntryConfig>): EntryConfig {
  if (!isSafeKey(key)) throw new Error(`invalid entry key: ${String(key)}`);
  const dir = path.join(outputDir, key);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadEntry(outputDir, key) ?? {};
  const now = new Date().toISOString();
  const merged: EntryConfig = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  merged.key = key;
  merged.createdAt = existing.createdAt ?? now;
  merged.updatedAt = now;
  fs.writeFileSync(path.join(dir, "_entry.json"), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}
