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
/**
 * 需求从哪来 —— 只有两条入口。
 *
 * 从前是三值 `text | tags | works`，把"自己描述"拆成了文本与标签两档。那个三分挡住了
 * 真正的需求形状：需求描述、标签六维、叙事体量三者是**并存**的（"与"不是"或"）—— 用户
 * 完全可以既写一段"想做个赛博朋克侦探故事"，又勾上题材与风格标签，再选体量。三值字段
 * 答不出这种情形，于是写入侧只能按当前那一档落盘，另一份**当场丢掉**（用户勾完标签再去
 * 写文本，标签就没了）。
 *
 * 而三值里真正被读到的区分只有一个：是不是上传原作。`TaskPanel` 判 `=== "works"` 走
 * 上传流，其余地方全是透传 —— text 与 tags 的二分从来没有消费者，它只服务于 UI 那个
 * 互斥切换，而互斥本身就是病。
 */
export type IntakeSource = "authored" | "adapted";

/**
 * 归一成两条入口 —— 全仓唯一的归一点。
 *
 * 存量 `_entry.json` 里写着 `text` / `tags` / `works`，MCP `narrative:create-entry`
 * 的旧调用方也可能还在传它们，所以收窄类型不够，得有地方把旧词吃下来。
 *
 * 认不出来的归 `authored`：那是自己描述的入口，不需要有原作在场。猜成 `adapted` 会让
 * 任务面板去找一份不存在的上传媒体。
 */
export function toIntakeSource(raw: unknown): IntakeSource {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return s === "adapted" || s === "works" ? "adapted" : "authored";
}

export interface EntryConfig {
  key?: string;
  /** 需求从哪来：自己描述 / 上传原作改编。读取一律过 `toIntakeSource`。 */
  inputType?: IntakeSource;
  /**
   * 以下三项**并存**，不是三选一：自然语言需求、标签六维、叙事体量（`complexity`）。
   * 三者都可为空（全空则由需求分析全自动推断），也可以同时给满。写入侧不得因为其中
   * 一项有值就丢掉另一项。
   */
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
  /**
   * 用户对叙事结构的**覆盖**，不是推导结论。
   *
   * 结论由三轴投票派生，不落在这里：落了会在下一次被 `resolveNarrativeStructure`
   * 当成 `explicit` 读回去短路投票，于是用户改了类型或题材，结构永远锁在第一次的
   * 结论上。某一次跑成了什么结构，去那次的 `manifest.config.narrativeStructure` 读。
   */
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

/**
 * 读取条目配置；不存在或损坏返回 null。
 *
 * 读盘即归一 `inputType` —— 这是全仓唯一的读盘点，所以也是唯一该确定入口口径的地方。
 * 下游（server 的历史列表、任务面板、还原 INPUT 的前端）一律只见两值，各自不必再判一次
 * `=== "works"` 还是 `=== "adapted"`。存量条目里写的是旧三值，而 viz 是独立 bundle、
 * import 不到这里，若不在读盘处归一，前端就得自带第二份归一实现。
 */
export function loadEntry(outputDir: string, key: string): EntryConfig | null {
  if (!isSafeKey(key)) return null;
  const p = entryPath(outputDir, key);
  try {
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as EntryConfig;
    // 没写过这个字段的条目保持没写：归一只管有值的，凭空补一个 `authored` 会把
    // "作者没说" 记成 "作者说了自己描述"。
    if (raw.inputType !== undefined) raw.inputType = toIntakeSource(raw.inputType);
    return raw;
  } catch {
    return null;
  }
}

/**
 * 一个条目**首次**落盘时，从已有字段判出它走的是哪条入口。
 *
 * v4 §1.5 的口径是条目在用户确认输入那一刻建立，那条路径（`POST /api/narrative/entry`）
 * 会把 `inputType` 一起交上来。但实际落盘的还有另外几处：单席直跑的兜底建、`/start`
 * 与 `/entry/start` 的配置回写 —— 它们各自拼自己那份 patch，都不带 `inputType`（chat
 * 入口与 MCP 直接开跑，压根没有过 UI 的确认动作）。于是条目的入口标记取决于**哪条路径
 * 先落盘**：先走确认的有，先开跑的永远没有，任务面板便显示不出它投了什么。
 *
 * 所以创建这一刻补齐，而不是让每个调用点各自记得带。有上传名单或 IP 指针就是改编，
 * 否则是自己描述 —— 两条入口都有据可依，不必猜。
 */
function seedIntakeSource(cfg: EntryConfig): IntakeSource {
  const hasUpload = (cfg.uploadedFileNames?.length ?? 0) > 0 || !!cfg.ipRunKey;
  return hasUpload ? "adapted" : "authored";
}

/**
 * upsert 条目配置到 output/<key>/_entry.json。合并语义：保留已有 createdAt，
 * 刷新 updatedAt，patch 中 undefined 字段不覆盖既有值。返回落盘后的完整配置。
 *
 * 创建与更新走同一个函数（它本就是 upsert），差别只在首次：首次会补 `createdAt` 与
 * `inputType`。写成两个函数并不更清楚 —— 调用点分不清自己是不是第一个到的，那本来
 * 就是它们不该关心的事。
 */
export function writeEntry(outputDir: string, key: string, patch: Partial<EntryConfig>): EntryConfig {
  if (!isSafeKey(key)) throw new Error(`invalid entry key: ${String(key)}`);
  const dir = path.join(outputDir, key);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadEntry(outputDir, key);
  const now = new Date().toISOString();
  const merged: EntryConfig = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  merged.key = key;
  // 写盘也归一：MCP `narrative:create-entry` 的旧调用方仍可能传三值中的一个，
  // 让旧词落进盘里，下一次读出来就又是一份要归一的存量。
  if (merged.inputType !== undefined) merged.inputType = toIntakeSource(merged.inputType);
  // 只在首次补：存量条目没写过这个字段就让它继续没写，事后按当下字段倒推一个入口
  // 标记是在替一次已经发生的操作编说法。
  else if (!existing) merged.inputType = seedIntakeSource(merged);
  merged.createdAt = existing?.createdAt ?? now;
  merged.updatedAt = now;
  fs.writeFileSync(path.join(dir, "_entry.json"), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}
