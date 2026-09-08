/**
 * seats-projection.ts — 把后端席位注册表渲染成前端可直接 import 的模块源码。
 *
 * viz 的 tsconfig 只收 viz/src，跨不过来读后端；而席位是产品侧的事实源，
 * 在前端另抄一份迟早会漂。折中是生成：后端改席位 → 跑 scripts/gen-seats.ts → 前端跟着变，
 * 忘了跑会被 seats-generated.test.ts 拦下来。
 *
 * 渲染逻辑放在 src 下（它是源码、要被测试引用），脚本只负责落盘。
 * 只投影前端用得着的字段；职责原文、上游席位、落差登记留在后端。
 */
import { ASSISTANT_SEATS, type AssistantSeat } from "./assistant-seats.js";
import { STEP_FILE_MAP } from "../runtime/step-files.js";
import { NARRATIVE_PIPELINES } from "./narrative-pipelines.js";

/**
 * 这一席在四条管线里是什么角色。
 *
 * 编排面上「跑一条管线会不会带上这一席」是用户最先要知道的事，而它此前只在
 * 后端的管线定义里，前端看不见——于是百科娘这种从不进任何管线的席位，在面板上
 * 与默认必跑的席位长得一模一样，用户跑完一条管线发现它没产出，只能猜是不是坏了。
 *
 * - `default`   —— 在某条管线的默认步序里，跑那条管线就会跑到；
 * - `optional`  —— 在步序里但默认跳过（CSV 的可选终点席，如剧本）；
 * - `attachable`—— 不在 CSV 步序里，可在编排面勾选挂载（打磨三席）；
 * - `manual`    —— 不属于任何管线，只能手动拖入或单跑（百科娘、玩法适配）。
 */
export type SeatPipelineRole = "default" | "optional" | "attachable" | "manual";

function pipelineRoleOf(seatId: string): SeatPipelineRole {
  let role: SeatPipelineRole = "manual";
  for (const p of Object.values(NARRATIVE_PIPELINES)) {
    if (p.seats.includes(seatId)) {
      // 默认必跑优先：同一席在 A 管线必跑、在 B 管线可选时，先说必跑那一面。
      if (!p.optionalSeats?.includes(seatId)) return "default";
      role = "optional";
    } else if ((p.attachableSeats ?? []).some((a) => a.seatId === seatId) && role === "manual") {
      role = "attachable";
    }
  }
  return role;
}

/**
 * 该席位产物的文件名前缀。
 *
 * 由「席位拥有的全部 agent + 顺带落盘的派生产物」查 STEP_FILE_MAP 得出，
 * 前端两库据此归类。手抄前缀表是上一版两库分错类的直接原因——
 * 07 故事大纲被归到大纲席，而它其实是结构席的第一步。
 */
function filePrefixesOf(seat: AssistantSeat): string[] {
  const keys = [
    ...seat.bindings.flatMap((b) => b.agentIds),
    ...(seat.alsoOwns ?? []),
    ...(seat.derivedArtifacts ?? []),
  ];
  const prefixes = new Set<string>();
  for (const key of keys) {
    const entry = STEP_FILE_MAP[key];
    if (entry) prefixes.add(`${entry.index}_`);
  }
  return [...prefixes].sort();
}

/**
 * 文件名前缀 → 产它的 step id。
 *
 * 前端「点左栏的一份产物，节点视图定位到对应节点」要靠它把文件反查回 step。
 * 席位那层的 filePrefixes 只到席位粒度（需求清单席同时拥有 00_ 与 01_），
 * 定位要的是具体那一步，所以单独投一张精确表。
 *
 * 同一 index 被多个键占用时先到先得（如 12_ 同属 script_generation 与
 * script_scene_generation）：STEP_FILE_MAP 的书写顺序即主次顺序，
 * 排在前面的是真正的 step，后面的是顺带落盘的派生产物。
 */
function filePrefixStepMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [stepId, entry] of Object.entries(STEP_FILE_MAP)) {
    const prefix = `${entry.index}_`;
    if (!(prefix in map)) map[prefix] = stepId;
  }
  return map;
}

export function renderSeatsModule(): string {
  const rows = ASSISTANT_SEATS.map((seat) => {
    const bindings = seat.bindings.map((b) => {
      const scope = b.templateId ?? b.modeId ?? null;
      return `      { scope: ${scope ? JSON.stringify(scope) : "null"}, agentIds: ${JSON.stringify(b.agentIds)} }`;
    });
    return [
      "  {",
      `    id: ${JSON.stringify(seat.id)},`,
      `    featureId: ${JSON.stringify(seat.featureId)},`,
      `    name: ${JSON.stringify(seat.name)},`,
      `    kind: ${JSON.stringify(seat.kind)},`,
      `    status: ${JSON.stringify(seat.status)},`,
      `    contentType: ${seat.contentType ? JSON.stringify(seat.contentType) : "null"},`,
      `    pipelineRole: ${JSON.stringify(pipelineRoleOf(seat.id))},`,
      `    filePrefixes: ${JSON.stringify(filePrefixesOf(seat))},`,
      bindings.length > 0
        ? `    bindings: [\n${bindings.join(",\n")},\n    ],`
        : "    bindings: [],",
      "  }",
    ].join("\n");
  });

  return `/**
 * 由 scripts/gen-seats.ts 从 src/pipeline/routing/assistant-seats.ts 生成——请勿手改。
 * 改席位请改后端注册表，然后跑 \`npm run gen:seats\`。
 */

export type SeatKind = "generator" | "validator" | "polisher" | "retriever";

/**
 * 跑一条管线会不会带上这一席。
 * - default    跑那条管线就会跑到
 * - optional   在步序里但默认跳过（可选终点席）
 * - attachable 不在步序里，可在编排面勾选挂载（打磨席）
 * - manual     不属于任何管线，只能手动拖入或单跑
 */
export type SeatPipelineRole = "default" | "optional" | "attachable" | "manual";

export interface SeatBindingView {
  /** 管线模板 id 或运行模式 id；null = 通用兜底。 */
  scope: string | null;
  agentIds: string[];
}

export interface SeatView {
  id: string;
  featureId: string;
  name: string;
  kind: SeatKind;
  /** planned = 契约已立、后端实现待建：可拖可 @，不可单跑。 */
  status: "active" | "planned";
  /** 产物落到哪个内容类别（对应 lib/contentTypes.ts）。 */
  contentType: string | null;
  /** 跑一条管线会不会带上这一席。 */
  pipelineRole: SeatPipelineRole;
  /** 该席位产物的文件名前缀，两库据此归类。 */
  filePrefixes: string[];
  bindings: SeatBindingView[];
}

export const ASSISTANT_SEATS: readonly SeatView[] = [
${rows.join(",\n")},
];

const INDEX = new Map(ASSISTANT_SEATS.map((s) => [s.id, s]));

export function getSeat(id: string): SeatView | undefined {
  return INDEX.get(id);
}

/** 该席位在指定作用域下要跑的 agent 序列；无绑定返回空数组。 */
export function resolveSeatAgents(id: string, scope?: string | null): string[] {
  const seat = INDEX.get(id);
  if (!seat) return [];
  if (scope) {
    const exact = seat.bindings.find((b) => b.scope === scope);
    if (exact) return [...exact.agentIds];
  }
  const generic = seat.bindings.find((b) => b.scope === null);
  return generic ? [...generic.agentIds] : [];
}

/** 席位的代表步骤：通用绑定的第一步，用于单节点试跑。 */
export function seatPrimaryStep(id: string): string | undefined {
  return resolveSeatAgents(id)[0];
}

/**
 * 文件名前缀 → 产它的 step id。点一份产物要定位到节点视图的哪个节点，查这张表。
 * 席位的 filePrefixes 只到席位粒度，定位要的是具体那一步，故单列。
 */
export const FILE_PREFIX_STEP: Readonly<Record<string, string>> = ${JSON.stringify(filePrefixStepMap(), null, 2)};

/** 由 \`<group>/<路径>\` 反查产它的 step id；查不到返回 undefined。 */
export function stepIdForFile(groupedPath: string): string | undefined {
  const base = groupedPath.split("/").pop() ?? groupedPath;
  // 长前缀优先：01a_ 必须先于 01_ 命中，否则全局控制参数会被认成偏好分析。
  const hit = Object.keys(FILE_PREFIX_STEP)
    .filter((p) => base.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? FILE_PREFIX_STEP[hit] : undefined;
}
`;
}
