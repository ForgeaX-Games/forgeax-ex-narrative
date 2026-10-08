/**
 * 落盘文件 → 内容类别的映射。
 *
 * 类别就是「叙事单品助手」花名册：二十席各占一类，与顶栏「叙事工具 → 叙事单品助手」
 * 同出一张表。本函数一律铺满全表，空类别也留着——两库对空类别的态度不同，
 * 任务库只列这一跑真跑出来的（跑了世界观设定助手才有世界观设定这一条），
 * 项目库只列收进去的东西占到的那几类，各自在渲染时决定滤不滤，故不在这里预先裁剪。
 *
 * 整张表由后端席位注册表投影而来（seats.generated.ts），文件名前缀是后端
 * 从 STEP_FILE_MAP 按席位拥有的 step 算出来的。上一版这里手抄前缀，结果
 * 07 故事大纲被归到大纲席（它其实是结构席的第一步），派生一次就不会再错。
 *
 * 归不到任何席位的（路由与校验中间件、老管线产物）不硬塞类别，
 * 直接挂在资源库 / 资产库下 —— 对它们而言层级从三级退成两级。
 */
import { ASSISTANT_SEATS } from "../composer/seats.generated";

export type ContentTypeId = string;

export interface ContentTypeDef {
  id: ContentTypeId;
  /** i18n 键。 */
  labelKey: string;
  /**
   * 归属的叙事单品助手（composerCatalog 的 engineer item id）。
   * 有归属的类别，标题旁的 @ 送的就是这位助手；用户上传那一类没有归属，故无 @。
   */
  assistantId?: string;
  /** 席位 id——任务侧据此把类别排成这一跑实际走过的环节顺序。 */
  seatId?: string;
  /** 该类成员的文件名前缀（不含分组段）。 */
  prefixes: readonly string[];
  /** 该类成员的分组段（`<group>/…` 的 group）。 */
  groups?: readonly string[];
}

/** 用户上传的原料不属于任何助手，作为第一类单列。 */
const UPLOAD_TYPE: ContentTypeDef = {
  id: "upload",
  labelKey: "lib.type.upload",
  prefixes: ["standardized"],
  groups: ["original", "package"],
};

/** 顺序即席位花名册顺序，用户上传排在最前。 */
export const CONTENT_TYPES: readonly ContentTypeDef[] = [
  UPLOAD_TYPE,
  ...ASSISTANT_SEATS.filter((s) => s.contentType).map((s) => ({
    id: s.contentType!,
    labelKey: `lib.type.${s.contentType}`,
    assistantId: `engineer.${s.id}`,
    seatId: s.id,
    prefixes: s.filePrefixes,
  })),
];

/** 归不到任何助手时返回 null —— 调用方据此把文件直挂库下。 */
export function classifyContent(groupedPath: string): ContentTypeId | null {
  const slash = groupedPath.indexOf("/");
  const group = slash >= 0 ? groupedPath.slice(0, slash) : "";
  const rel = slash >= 0 ? groupedPath.slice(slash + 1) : groupedPath;
  // 只看最后一段的前缀，中间目录（分批子目录等）不参与判定。
  const base = rel.split("/").pop() ?? rel;

  for (const def of CONTENT_TYPES) {
    if (def.groups?.includes(group)) return def.id;
    if (def.prefixes.some((p) => base.startsWith(p))) return def.id;
  }
  return null;
}

/**
 * 运行簿记文件：断点、清单、条目配置、全量结果转储。
 * 它们是"这一跑怎么跑的"而非内容产物，混进两库只会稀释信噪比，故分桶前先滤掉。
 */
const INTERNAL_BASENAMES = new Set([
  "manifest.json",
  "_checkpoint.json",
  "_run_manifest.json",
  "_entry.json",
  "full_result.json",
]);

/**
 * M2 版本溯源 sidecar：`<stem>.versions.json`，与它旁边的 `<stem>_<n>.json` 历史快照
 * 同目录。快照本身是内容（该显示），sidecar 只是"每个版本号为什么产生"的簿记，
 * 后缀固定但主干名逐文件不同，不能进上面那张定长名单，单独按后缀判。
 */
function isVersionOriginSidecar(base: string): boolean {
  return base.endsWith(".versions.json");
}

export function isInternalFile(groupedPath: string): boolean {
  const base = groupedPath.split("/").pop() ?? groupedPath;
  return INTERNAL_BASENAMES.has(base) || isVersionOriginSidecar(base);
}

export interface LibraryFile {
  /** `<group>/<相对路径>`，与 `GET /files/:key` 的扁平清单同形。 */
  path: string;
  /** 展示名（去掉目录段）。 */
  name: string;
  group: string;
  /** 归属类别；null = 无类别，直挂库下。 */
  type: ContentTypeId | null;
}

export interface ContentBucket {
  def: ContentTypeDef;
  files: LibraryFile[];
}

/**
 * 一条产物条目——多版本时它是一叠，单份时它就是那一份。
 *
 * 用户在界面上改一份产物，改出来的每一稿都留着，同一份东西于是有多个版本。
 * 库里不能把 n 个版本铺成 n 条并列的产物，否则一份世界观改三次，类别下就冒出四条，
 * 用户分不清哪条是当前的。所以折叠成一条，默认给最新版，历史版按需展开。
 */
export interface FileEntry {
  /** 折叠后的展示名：多版本取主干名，单份取文件名。 */
  name: string;
  /** 当前那一份（多版本取版号最大的）。 */
  file: LibraryFile;
  /** 从新到旧；单份文件长度为 1，版号记 0。 */
  versions: { n: number; file: LibraryFile }[];
}

/**
 * 版本约定：`<主干>/<主干>_<n>.<ext>`——同一份产物的各版本装在以主干命名的文件夹里。
 *
 * 只认这种「专属文件夹」形态，不认平铺的 `xxx_1.json`：分批产物（情节按批落盘）
 * 就长成平铺带序号的样子，认了会把一批批内容误当成同一份东西的历史版。
 * 后端眼下还不产版本目录，这里先把读的一侧备好，落盘侧照此约定补即可。
 */
function parseVersion(file: LibraryFile): { stem: string; n: number } | null {
  const segs = file.path.split("/");
  if (segs.length < 3) return null; // 至少 <group>/<主干目录>/<文件>
  const dir = segs[segs.length - 2]!;
  const dot = file.name.lastIndexOf(".");
  if (dot <= 0) return null;
  const base = file.name.slice(0, dot);
  const ext = file.name.slice(dot);
  if (!base.startsWith(`${dir}_`)) return null;
  const tail = base.slice(dir.length + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { stem: `${dir}${ext}`, n: Number(tail) };
}

/** 把同一份产物的多个版本折成一条，其余原样成条；顺序沿用入参。 */
export function groupVersions(files: readonly LibraryFile[]): FileEntry[] {
  const entries: FileEntry[] = [];
  const byStem = new Map<string, FileEntry>();

  for (const file of files) {
    const ver = parseVersion(file);
    if (!ver) {
      entries.push({ name: file.name, file, versions: [{ n: 0, file }] });
      continue;
    }
    const existing = byStem.get(ver.stem);
    if (existing) {
      existing.versions.push({ n: ver.n, file });
      continue;
    }
    const entry: FileEntry = { name: ver.stem, file, versions: [{ n: ver.n, file }] };
    byStem.set(ver.stem, entry);
    entries.push(entry);
  }

  for (const entry of byStem.values()) {
    entry.versions.sort((a, b) => b.n - a.n);
    entry.file = entry.versions[0]!.file;
  }
  return entries;
}

export interface LibraryContents {
  /** 固定的全套类别条目，没有产物的也在，files 为空。 */
  buckets: ContentBucket[];
  /** 归不到类别的文件，直挂库下。 */
  loose: LibraryFile[];
}

function toLibraryFile(p: string): LibraryFile {
  const slash = p.indexOf("/");
  const group = slash >= 0 ? p.slice(0, slash) : "";
  const rel = slash >= 0 ? p.slice(slash + 1) : p;
  return { path: p, name: rel.split("/").pop() ?? rel, group, type: classifyContent(p) };
}

/** 把扁平文件清单铺进固定类别表；类别恒在，无归属的进 loose。 */
export function buildLibraryContents(paths: readonly string[]): LibraryContents {
  const byType = new Map<ContentTypeId, LibraryFile[]>();
  const loose: LibraryFile[] = [];

  for (const p of paths) {
    if (isInternalFile(p)) continue;
    const file = toLibraryFile(p);
    if (file.type === null) {
      loose.push(file);
      continue;
    }
    const arr = byType.get(file.type);
    if (arr) arr.push(file);
    else byType.set(file.type, [file]);
  }

  return {
    buckets: CONTENT_TYPES.map((def) => ({ def, files: byType.get(def.id) ?? [] })),
    loose,
  };
}
