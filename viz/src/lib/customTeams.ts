/**
 * 自定义专属团队——用户投喂作品后蒸馏出来的私有助手。
 *
 * 两种形态，差别在投喂的粒度与产出的角色：
 *  - 单本蒸馏（book_template）：喂一本书，得到《书名》模板创作助手，
 *    照这本书的骨架与笔法写；
 *  - 全维度蒸馏（author_advisor）：喂同一作者的多份材料，得到创作顾问，
 *    抽的是作者跨作品的稳定方法论，而非某一本的结构。
 *
 * ─────────────────────────────────────────────────────────────────
 * 事实源在后端，本文件只是端口
 * ─────────────────────────────────────────────────────────────────
 * 上一版把团队记录存在 localStorage 里（`createLocalCollection`）。那时后端没有蒸馏链路，
 * 这是合理的过渡；但现在蒸馏与**注入都跑在后端**，profile 若只存在浏览器里，
 * 生成时后端读不到，用户会看到"团队已就绪"而生成毫无变化——不报错的那种断链。
 *
 * 所以本文件改成后端 `/api/narrative/teams` 的薄封装。函数签名刻意与上一版保持一致
 * （这正是 localCollection 注释预留的"换掉实现、调用方一行不用改"）。
 *
 * ─────────────────────────────────────────────────────────────────
 * 材料本体在蒸馏时才上传
 * ─────────────────────────────────────────────────────────────────
 * 建团队只登记"蒸馏什么、用哪些文件"（文件名清单）；`distillCustomTeam` 才把文件本体
 * 送过去。分两步是因为建团队要立即返回、而一本书的提炼是几十次模型调用起步。
 */
import { API_BASE } from "../hooks/useNarrativeStream";

export type CustomTeamKind = "book_template" | "author_advisor";

/**
 * 后端状态机原样映射：
 *   draft      材料已登记，还没跑蒸馏
 *   distilling 正在跑（前端据此转圈并禁止再点）
 *   ready      profile 已产出，可被生成选用
 *   failed     跑挂了，带原因；不回落 draft（回落就与"从没跑过"分不开了）
 */
export type CustomTeamStatus = "draft" | "distilling" | "ready" | "failed";

/** 用户显式声明的书籍分组：分组是声明来的，后端不做任何推测。 */
export interface CustomTeamBook {
  bookUid: string;
  title: string;
  files: string[];
  ipDnaRunId: string | null;
}

export interface CustomTeam {
  id: string;
  kind: CustomTeamKind;
  /** 单本蒸馏填书名，全维度蒸馏填作者名。 */
  source: string;
  /** 后端算好的展示名：未蒸馏时按形态兜，已蒸馏时用 profile 里的名字。 */
  displayName: string;
  books: CustomTeamBook[];
  authorMaterials: string[];
  useEncyclopedia: boolean;
  status: CustomTeamStatus;
  errorMessage: string | null;
  /** 蒸馏产物；只有 ready 时有值。 */
  profile: {
    displayName: string;
    summary: string;
    signatureTraits: string[];
    taboos: string[];
    structureTemplate?: string;
    methodology?: string;
    stageSkills: Record<string, string>;
    operatorUids: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

/** 建团队时给的一组材料：一本书一组，书名由用户声明。 */
export interface TeamMaterialGroup {
  /** 书名；留空表示"作者本人资料"（访谈/创作谈，仅全维度蒸馏用得上）。 */
  title: string;
  files: File[];
}

const listeners = new Set<(items: CustomTeam[]) => void>();
let cache: CustomTeam[] = [];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/api/narrative/teams${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** 拉一次并广播。写操作之后都走它，让多处订阅者（顶栏、画布）同步。 */
async function refresh(): Promise<CustomTeam[]> {
  const { teams } = await request<{ teams: CustomTeam[] }>("");
  cache = teams;
  for (const l of listeners) l(teams);
  return teams;
}

export const listCustomTeams = (): Promise<CustomTeam[]> => refresh();

/**
 * 订阅团队列表。
 *
 * 除了写操作后的广播，还带一个轮询：蒸馏在后端异步跑，没有推送通道，
 * 不轮询的话状态会一直停在 distilling 直到用户手动重开面板。只在有 distilling 时轮询——
 * 空闲期不打扰后端。
 */
export function subscribeCustomTeams(listener: (items: CustomTeam[]) => void): () => void {
  listeners.add(listener);
  if (cache.length > 0) listener(cache);

  const timer = window.setInterval(() => {
    if (cache.some((t) => t.status === "distilling")) void refresh().catch(() => {});
  }, 5000);

  return () => {
    listeners.delete(listener);
    window.clearInterval(timer);
  };
}

export async function deleteCustomTeam(id: string): Promise<void> {
  await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refresh();
}

export async function createCustomTeam(
  kind: CustomTeamKind,
  source: string,
  materials: readonly TeamMaterialGroup[] = [],
): Promise<CustomTeam> {
  const books = materials
    .filter((g) => g.title.trim())
    .map((g) => ({ title: g.title.trim(), files: g.files.map((f) => f.name) }));
  const authorMaterials = materials
    .filter((g) => !g.title.trim())
    .flatMap((g) => g.files.map((f) => f.name));

  const team = await request<CustomTeam>("", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind,
      source: source.trim(),
      // 单本蒸馏没声明分组时按书名兜一组：书名就是团队来源，用户不必再抄一遍。
      books: books.length > 0 || kind === "author_advisor"
        ? books
        : [{ title: source.trim(), files: [] }],
      author_materials: authorMaterials,
    }),
  });
  await refresh();
  return team;
}

/** 文本文件直传 utf8；其余（docx 等）转 base64 交后端解析，与 IP DNA 上传同口径。 */
async function encodeFile(file: File, bookTitle: string): Promise<Record<string, unknown>> {
  const isDocx = /\.docx$/i.test(file.name);
  if (isDocx) {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
    return {
      file_name: file.name,
      content_base64: btoa(binary),
      encoding: "base64-docx",
      file_type: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      book_title: bookTitle || undefined,
    };
  }
  return {
    file_name: file.name,
    content: await file.text(),
    file_type: file.type || "text/plain",
    book_title: bookTitle || undefined,
  };
}

/**
 * 起蒸馏：把材料本体送过去，后端异步跑（202）。
 *
 * `book_title` 决定这份材料归到哪本书——后端只按声明归位，不猜。缺省（空标题）
 * 视为作者本人资料。
 */
export async function distillCustomTeam(
  id: string,
  materials: readonly TeamMaterialGroup[],
): Promise<CustomTeam> {
  const files = await Promise.all(
    materials.flatMap((g) => g.files.map((f) => encodeFile(f, g.title.trim()))),
  );
  const team = await request<CustomTeam>(`/${encodeURIComponent(id)}/distil`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  await refresh();
  return team;
}

/** 团队在界面上的显示名：形态决定叫法，用户不用自己起名。 */
export function customTeamLabel(
  team: CustomTeam,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  // 蒸馏出来的名字优先（模型会给更贴切的），没有再按形态兜。
  if (team.profile?.displayName) return team.profile.displayName;
  return team.kind === "book_template"
    ? t("team.label.bookTemplate", { name: team.source })
    : t("team.label.authorAdvisor", { name: team.source });
}

/** 只有 ready 的团队能带进生成——其余状态下 profile 还不存在。 */
export function isTeamUsable(team: CustomTeam): boolean {
  return team.status === "ready" && !!team.profile;
}
