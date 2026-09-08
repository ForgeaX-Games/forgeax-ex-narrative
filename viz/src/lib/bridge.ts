/**
 * Narrative Viz ↔ host (Narrative Runtime UI) postMessage bridge protocol.
 *
 * Inbound (host → narrative-viz):
 *   narrative:load-run             — Load and display a specific run by ID
 *   narrative:reload               — Re-fetch current run status
 *   narrative:trigger-regenerate   — Host triggers regeneration of a step
 *   narrative:attach-run           — Attach UI to a run started externally (e.g. by 剧情师 Kotone
 *                                    via the narrative:start-pipeline tool). Sets runningRunId so
 *                                    the SSE stream drives the center preview live, and回填 INPUT/
 *                                    ROUTING 选择器 so the left toolbar reflects what the agent chose.
 *
 * Outbound (narrative-viz → host):
 *   narrative:ready                — Viz has loaded, ready to receive commands
 *   narrative:run-started          — A new pipeline run has been started
 *   narrative:run-completed        — Pipeline run finished successfully
 *   narrative:run-failed           — Pipeline run failed
 *   narrative:step-changed         — A pipeline step changed status
 *   narrative:progress             — Step progress with numeric details
 *   narrative:regenerate-requested — Viz requests regeneration of a step
 *   narrative:step-approved        — User approved a step's output
 *   narrative:step-rejected        — User rejected a step's output
 *   narrative:content-edited       — User saved edits to a step/node
 *   narrative:lifecycle-changed    — Step lifecycle state changed (editing/modified/stale)
 *   narrative:surface-snapshot     — Surface state snapshot for AI DUAL-MODALITY
 */

import { parseSourceDir } from "../store/laneAddress";

export type InboundEvent =
  | { type: "narrative:load-run"; payload: { runId: string } }
  | { type: "narrative:reload" }
  | { type: "narrative:trigger-regenerate"; payload: { stepId: string; instructions?: string } }
  | {
      type: "narrative:attach-run";
      payload: {
        runId: string;
        /** 后端 /start 返回的 sourceDir（输出目录名）。缺省时退化用 runId 作 entryKey。 */
        entryKey?: string;
        tier?: string;
        mode?: string;
        genreCode?: string | null;
        /** agent 解析出的用户需求原文（回填 INPUT 框）。 */
        userInput?: string;
        routeGroup?: "planning" | "narrative";
      };
    };

export type OutboundEvent =
  | { type: "narrative:ready" }
  | { type: "narrative:run-started"; payload: { runId: string; tier?: string; mode?: string } }
  | { type: "narrative:run-completed"; payload: { runId: string } }
  | { type: "narrative:run-failed"; payload: { runId: string; error: string } }
  | { type: "narrative:step-changed"; payload: { stepId: string; status: string; label?: string } }
  | { type: "narrative:progress"; payload: { stepId: string; label?: string; step: number; totalSteps: number; status: string } }
  | { type: "narrative:regenerate-requested"; payload: { stepId: string; instructions?: string } }
  | { type: "narrative:step-approved"; payload: { stepId: string } }
  | { type: "narrative:step-rejected"; payload: { stepId: string; reason?: string } }
  | {
      type: "narrative:content-edited";
      payload: {
        stepId: string;
        nodeId?: string;
        hasUserInput: boolean;
        /**
         * 改的是哪个条目的产物。**没有它这个事件是不可行动的**：宿主 agent 收到
         * "worldview 被改了"却不知道是哪一条任务，既查不了影响面也重跑不了下游。
         */
        entryKey?: string;
        /** 次管线泳道（主管线不置位，与产物地址四元组同口径）。 */
        pipelineId?: string;
        /** 产物目录（相对 `output/`）；`narrative:get-stale-steps` 等工具的 sourceDir 参数直接用它。 */
        sourceDir?: string;
      };
    }
  | { type: "narrative:lifecycle-changed"; payload: { stepId: string; lifecycle: string; previousLifecycle?: string } }
  | { type: "narrative:surface-snapshot"; payload: { surface: string; snapshot: Record<string, unknown> } };

const isEmbedded = typeof window !== "undefined" && window.parent !== window;

export function sendToHost(event: OutboundEvent): void {
  if (isEmbedded) {
    window.parent.postMessage(event, "*");
  }
}

export function onHostMessage(handler: (event: InboundEvent) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (typeof e.data?.type === "string" && e.data.type.startsWith("narrative:")) {
      handler(e.data as InboundEvent);
    }
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

export function notifyReady(): void {
  sendToHost({ type: "narrative:ready" });
}

/**
 * 上报"用户改了某份产物"，并把产物地址一并带上。
 *
 * 地址由调用方传目录（`sourceDir`）即可，条目键与泳道在这里反解 —— 三个发点各自拼
 * 一遍必然有一处忘记，而漏掉地址的事件宿主收得到却用不上。
 */
export function notifyContentEdited(p: {
  stepId: string;
  nodeId?: string;
  hasUserInput: boolean;
  /** 产物目录（相对 `output/`）：`activeSourceDir ?? activeEntryKey`。 */
  sourceDir?: string | null;
}): void {
  const parsed = p.sourceDir ? parseSourceDir(p.sourceDir) : null;
  sendToHost({
    type: "narrative:content-edited",
    payload: {
      stepId: p.stepId,
      nodeId: p.nodeId,
      hasUserInput: p.hasUserInput,
      entryKey: parsed?.entryKey,
      pipelineId: parsed?.pipelineId,
      sourceDir: p.sourceDir ?? undefined,
    },
  });
}

/**
 * 叙事角色拖入右侧平台对话（Composer）时用的载荷。
 */
export interface ComposerRoleInsert {
  /** 角色显示名（对话里以 "@<name>" 开头）。 */
  name: string;
  /** 五大类之一：input/routing/expert/assistant/engineer。 */
  category: string;
  /** 目录 item id（溯源）。 */
  catalogId: string;
  /** 专家预制管线模板（若有）。 */
  pipelineTemplate?: string;
  /** 默认叙事层级（若有）。 */
  tier?: string | null;
  routeGroup?: string;
  /** 工程师对应的生成环节 step id（若有）。 */
  stepId?: string;
  /** 助手对应的叙事策略 mode（若有）。 */
  modeId?: string;
  /**
   * 自定义专属团队 id（2.4，若有）。
   *
   * 必须随 @ 一起送出：平台 agent 起生成时要把它填进 `narrative:start-pipeline` 的
   * team_id，后端才会注入这位成员。只送名字的话 agent 无从得知该带哪个 id，
   * 于是生成照跑、风格却与团队无关，且不报错。
   */
  teamId?: string;
}

/**
 * 结构化引用 —— 送进平台对话的那个 `@` 到底指什么。
 *
 * 两类：`role`（一位叙事角色/席位/团队成员）与 `artifact`（一份落盘产物）。
 * 与插入文本的关系：文本是给人和 LLM 看的，这个对象是给程序看的，两者同源生成，
 * 所以不会互相漂移。宿主今天只消费 `text`（`FORGEAX_COMPOSER_INSERT` 的通用通道），
 * 但结构化载荷一并送出——宿主哪天注册了叙事引用类型，不必再改叙事这一侧。
 */
export type NarrativeReference =
  | {
      kind: "role";
      /** 角色显示名。 */
      name: string;
      category: string;
      catalogId: string;
      stepId?: string;
      modeId?: string;
      teamId?: string;
      tier?: string;
      routeGroup?: string;
      pipelineTemplate?: string;
    }
  | {
      kind: "artifact";
      /** 展示名（文件名）。 */
      name: string;
      /** 产物地址：条目键。 */
      entryKey: string;
      /** 产物地址：次管线泳道；主管线不置位。 */
      pipelineId?: string;
      /** `<group>/<相对路径>`，与 `GET /files/:ref` 返回同形。 */
      path: string;
      /** 产物目录（相对 `output/`）—— 直接可当各工具的 `sourceDir` / `runId` 参数用。 */
      sourceDir: string;
      contentType?: string;
    };

/** 属性串：`k=v` 空格分隔，值里有空格才加引号。locale 无关，便于 agent 稳定解析。 */
function attrs(pairs: Array<[string, string | undefined | null]>): string {
  return pairs
    .filter((p): p is [string, string] => !!p[1])
    .map(([k, v]) => (/[\s"]/.test(v) ? `${k}="${v.replace(/"/g, "'")}"` : `${k}=${v}`))
    .join(" ");
}

/**
 * 引用的文本形态：`@名字 [narrative-ref k=v …]`。
 *
 * 为什么是这种机器语法而不是原来的中文说明句：这段文本最终由宿主 agent 解析，
 * 而中文散句里的键名会随界面语言变（英文界面下拿到的是另一套词），agent 只能猜。
 * 键名固定为 ASCII 后，"该调哪个工具、参数从哪来"是可读的规则而不是推测。
 */
function formatReference(ref: NarrativeReference): string {
  const body =
    ref.kind === "role"
      ? attrs([
          ["kind", "role"],
          ["category", ref.category],
          ["catalog", ref.catalogId],
          ["step", ref.stepId],
          ["strategy", ref.modeId],
          ["team", ref.teamId],
          ["tier", ref.tier],
          ["routeGroup", ref.routeGroup],
          ["pipeline", ref.pipelineTemplate],
        ])
      : attrs([
          ["kind", "artifact"],
          ["entry", ref.entryKey],
          ["pipeline", ref.pipelineId],
          ["sourceDir", ref.sourceDir],
          ["path", ref.path],
          ["type", ref.contentType],
        ]);
  const hint =
    ref.kind === "role"
      ? "call the matching narrative:* tool (start-pipeline / regenerate-step / ip-dna-*)"
      : "read it with narrative:read-file(runId=sourceDir, filePath=path)";
  return `@${ref.name} [narrative-ref ${body} · ${hint}]`;
}

/**
 * 把一个叙事角色发送到宿主 Chat 的 composer。
 *
 * 复用宿主 PluginIframeHost **既有的** `FORGEAX_COMPOSER_INSERT` + `text` 通用文本通道
 * （上游即已存在），因此**不需要改动宿主 interface 仓库**——整功能内聚在叙事仓库内，
 * 适配"只维护叙事仓库、其它子模块用上游"的工作流，`fx update` reset interface 也不受影响。
 *
 * 跨 iframe 原生拖拽无法直达宿主，故用 postMessage 兜底：拖拽释放 / 点击"@"均走此函数。
 */
export function sendRoleToComposer(role: ComposerRoleInsert): void {
  const ref: NarrativeReference = {
    kind: "role",
    name: role.name,
    category: role.category,
    catalogId: role.catalogId,
    stepId: role.stepId,
    modeId: role.modeId,
    teamId: role.teamId,
    tier: role.tier ?? undefined,
    routeGroup: role.routeGroup,
    pipelineTemplate: role.pipelineTemplate,
  };
  sendTextToComposer(formatReference(ref), ref);
}

/**
 * 项目产物文件在对话里的引用。
 *
 * 与角色 @ 同一条通道，只是载荷换成"这是哪个项目的哪份产物"，
 * 让平台 agent 能直接对这份文件动手（读、改、以它为输入重跑下游）。
 */
export interface ProjectFileInsert {
  /**
   * 产物目录（相对 `output/`）：主管线就是条目键，次管线是 `<key>/pipelines/<pid>`。
   *
   * 沿用 `entryKey` 这个名字是为了不动调用方，但它收的是**目录**——产物清单本来就按
   * 目录取（`fetchRunFiles(taskKey)`）。所以这里必须反解一次，把条目键与泳道分开报，
   * 否则次管线的引用会告诉 agent 一个不存在的条目键。
   */
  entryKey: string;
  /** `<group>/<相对路径>`，与 GET /files/:key 同形。 */
  path: string;
  /** 展示名（文件名）。 */
  name: string;
  /** 内容类型 id（角色档案 / 道具清单 …）。 */
  contentType?: string;
}

export function sendFileToComposer(file: ProjectFileInsert): void {
  const parsed = parseSourceDir(file.entryKey);
  const ref: NarrativeReference = {
    kind: "artifact",
    name: file.name,
    entryKey: parsed?.entryKey ?? file.entryKey,
    pipelineId: parsed?.pipelineId,
    sourceDir: file.entryKey,
    path: file.path,
    contentType: file.contentType,
  };
  sendTextToComposer(formatReference(ref), ref);
}

/**
 * 送进宿主 composer：`text` 是宿主今天就消费的通用通道，`reference` 是同源的结构化载荷。
 *
 * 两个一起送而不是二选一：宿主当前把这条消息当纯文本粘贴（`kind:'paste'`），未知字段
 * 会被忽略，所以多送不出错；等宿主注册了叙事引用类型，直接读 `reference` 即可，
 * 叙事这一侧不必再改一次。
 */
function sendTextToComposer(text: string, reference?: NarrativeReference): void {
  if (!isEmbedded) return;
  window.parent.postMessage(
    { type: "FORGEAX_COMPOSER_INSERT", text, reference, source: "narrative" },
    "*",
  );
}
