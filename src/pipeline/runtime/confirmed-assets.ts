/**
 * confirmed-assets.ts — 生成侧读取"已定稿"引用（G5，契约 docs/contracts.md §3：引用不复制）。
 *
 * 定稿表落在 `_entry.json.assets[]`（`src/api/entry-store.ts` 的 `AssetRef`），此前
 * `src/pipeline/` 对它零引用——下游生成想拿"作者已确认为定稿"的产物做参考材料，
 * 没有现成的读取入口，只能重新翻当次运行的 ctx（够不到别的 entry，也分不出
 * "确认过的稿子"与"跑完了但没人看过的中间结果"）。
 *
 * 本模块只做"引用不复制"的读：给 entryKey + AssetRef，返回它当下的内容。
 * `version` 缺省 = 跟随最新（读那份不编号的平铺文件）；给了则钉到 §3.3 版本目录
 * 里那一张历史快照。钉住的版本因磁盘被清理等原因缺失时，退化为跟随最新而不是
 * 让整条下游生成因为一张丢失的历史快照失败——"读不到旧版本"不该变成"读不到任何版本"。
 *
 * 不产生新事实源：这里不写盘、不缓存，每次读都是当次磁盘状态。
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeAssets, type AssetRef, type EntryConfig } from "../../api/entry-store.js";
import { runDirName } from "../../api/run-layout.js";
import { currentVersionNumber, readVersionSnapshot } from "../../api/version-store.js";
import { outputDir } from "../../runtime/artifact-root.js";

export interface ConfirmedAsset {
  ref: AssetRef;
  /** 实际读到的内容；解不出来（文件缺失/group 不支持）时为 `undefined`，不是抛错。 */
  content: unknown;
  /** 这次实际读到的是第几版——跟随最新时也报出来，供调用方判断"是不是还是确认时那版"。 */
  resolvedVersion: number;
}

interface SplitAssetPath {
  group: string;
  relPath: string;
}

/**
 * 拆 `<group>/<相对路径>`。只支持 `output` 组——`assets[]` 面向的是生成产物
 * （下游要引用的"定稿"），不是 IP DNA 那条链路的原始上传件（`original`/`processing`/
 * `extraction_output`/`package`，那些另有自己的事实源与消费方）。
 * 无 `/` 的裸文件名（历史遗留写法）按隐含 `output` 组处理。
 */
function splitAssetPath(assetPath: string): SplitAssetPath {
  const slash = assetPath.indexOf("/");
  if (slash < 0) return { group: "output", relPath: assetPath };
  return { group: assetPath.slice(0, slash), relPath: assetPath.slice(slash + 1) };
}

function readFlatFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined;
  const raw = fs.readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** 单条引用的当下内容 + 实际读到的版本号。 */
export function resolveConfirmedAssetContent(entryKey: string, ref: AssetRef): ConfirmedAsset {
  const { group, relPath } = splitAssetPath(ref.path);
  if (group !== "output" || !relPath) {
    return { ref, content: undefined, resolvedVersion: ref.version ?? 0 };
  }
  const runDir = path.join(outputDir(), runDirName(entryKey, ref.pipelineId));
  const live = currentVersionNumber(runDir, relPath);
  if (ref.version != null && ref.version < live) {
    const snap = readVersionSnapshot(runDir, relPath, ref.version);
    if (snap !== undefined) return { ref, content: snap, resolvedVersion: ref.version };
    // 钉住的那张快照不在了：退化为跟随最新，往下走到平铺文件读取。
  }
  return { ref, content: readFlatFile(path.join(runDir, relPath)), resolvedVersion: live };
}

/**
 * 某条目在指定泳道（缺省 = 主管线）下全部已确认产物的当下内容。
 *
 * 严格按泳道匹配，不做"跨泳道全取"——次管线的同名产物与主管线各自独立
 * 确认（见 entry-store.ts 的 `assetKey`），把它们混进同一次起跑 ctx 会把
 * 另一条泳道的定稿错当作这条泳道的。条目不存在、没有 `_entry.json`、或
 * 没有任何确认记录都返回空数组，不抛错。
 */
export function listConfirmedAssets(entryKey: string, pipelineId?: string): ConfirmedAsset[] {
  const entryPath = path.join(outputDir(), entryKey, "_entry.json");
  if (!fs.existsSync(entryPath)) return [];
  let cfg: EntryConfig;
  try {
    cfg = JSON.parse(fs.readFileSync(entryPath, "utf-8")) as EntryConfig;
  } catch {
    return [];
  }
  const refs = normalizeAssets(cfg.assets).filter((a) => (a.pipelineId ?? undefined) === (pipelineId ?? undefined));
  return refs.map((ref) => resolveConfirmedAssetContent(entryKey, ref));
}
