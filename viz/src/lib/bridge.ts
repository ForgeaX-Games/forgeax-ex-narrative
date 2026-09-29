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
 * 三类：`role`（一位叙事角色/席位/团队成员）、`artifact`（一份落盘产物）与
 * `entry`（一个任务的初始需求）。入口单列一类而不是塞进 `role`：它指向的工具是
 * `narrative:create-entry`，与 role 的 `start-pipeline` 不是同一件事——混作一类时
 * agent 读到的 hint 会让它直接开跑，而用户要的是先把需求与路由定下来。
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
      kind: "entry";
      /** 展示名。 */
      name: string;
      /**
       * 要配置哪个任务的初始需求。不置位 = 另起一个任务（`create-entry` 铸新 key）。
       *
       * 只在当前任务确实可改配置时才置位：跑着的条目由键权层挡住改配置，带上它只会
       * 让用户发出一条注定被拒的消息，退回"另起一个"才是那一刻唯一做得到的事。
       */
      entryKey?: string;
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
  const body = (() => {
    if (ref.kind === "role") {
      return attrs([
        ["kind", "role"],
        ["category", ref.category],
        ["catalog", ref.catalogId],
        ["step", ref.stepId],
        ["strategy", ref.modeId],
        ["team", ref.teamId],
        ["tier", ref.tier],
        ["routeGroup", ref.routeGroup],
        ["pipeline", ref.pipelineTemplate],
      ]);
    }
    if (ref.kind === "entry") {
      // `entry=new` 而不是省略该键：省略时 agent 无从分辨"没带这个参数"和"故意要新起
      // 一个"，两者会导向完全不同的动作（改现有条目 vs 铸新条目）。
      return attrs([
        ["kind", "entry"],
        ["entry", ref.entryKey ?? "new"],
      ]);
    }
    return attrs([
      ["kind", "artifact"],
      ["entry", ref.entryKey],
      ["pipeline", ref.pipelineId],
      ["sourceDir", ref.sourceDir],
      ["path", ref.path],
      ["type", ref.contentType],
    ]);
  })();
  const hint =
    ref.kind === "role"
      ? "call the matching narrative:* tool (start-pipeline / regenerate-step / ip-dna-*)"
      : ref.kind === "entry"
        ? "settle the requirement with narrative:list-axes then narrative:create-entry" +
          " (omit key when entry=new); do not start a run until the user confirms it." +
          // 平台对话框附件上限 2MB；大文件（原著全本等）不该经它转手，而是引导用户去
          // 叙事自己的入口节点摄入——那条链路走整份多模态 IP 摄入，没有这个限制。
          " Files over the chat attachment limit: tell the user to use this entry" +
          " node's file-upload tab in the workspace canvas instead of a chat attachment."
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
export function sendRoleToComposer(role: ComposerRoleInsert): Promise<ComposerDelivery> {
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
  return sendTextToComposer(formatReference(ref), ref);
}

/**
 * 一个任务的初始需求在对话里的引用。
 *
 * 与拖进画布的那一枚入口是同一把键权：两者最终都落到同一份 `_entry.json`
 * （画布经 `/entry/start` 写，chat 经 `narrative:create-entry` 写）。区别只在于
 * 谁来填——画布上用户自己点三轴，chat 里由 agent 问出来再填。
 *
 * 裸打一段需求进对话栏在"新任务"这一情形下与本引用等价；本引用多说的是另外两件
 * 裸文本说不清的事：这一轮是要**另起一个任务**，还是要**回去改某个已有任务**的
 * 初始需求。`create-entry` 的必填项只有 `key`，正是为了区分这两者。
 */
export function sendEntryToComposer(name: string, entryKey?: string): Promise<ComposerDelivery> {
  const ref: NarrativeReference = { kind: "entry", name, ...(entryKey ? { entryKey } : {}) };
  return sendTextToComposer(formatReference(ref), ref);
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

export function sendFileToComposer(file: ProjectFileInsert): Promise<ComposerDelivery> {
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
  return sendTextToComposer(formatReference(ref), ref);
}

/**
 * 「定位」：让平台的系统文件区展开并选中这份产物。
 *
 * 对应插件产品规范里资产右键三动作（下载 / 引用 / 定位）的第三项。宿主收到这条
 * 消息会先 `app.panel.reveal` 把文件区从折叠的底栏抽屉里展开，再把目标交给挂载
 * 着的文件区去选中——**折叠状态下也能定位**，不需要用户先自己把面板拉开。
 *
 * `path` 必须是「相对游戏根」的路径（文件区自己列文件就用这个口径），且只能由后端
 * `GET /api/narrative/locate/:runId` 折算：环节标签→磁盘目录、双模式映射这两张表
 * 都只存在于后端，前端复刻必然漂移。独立模式下后端回 `standalone`，此时不该调用
 * 本函数——没有宿主，也没有文件区。
 */
export function revealInContentBrowser(target: { path: string; name?: string }): void {
  if (!isEmbedded) return;
  window.parent.postMessage(
    {
      type: "FORGEAX_CONTENT_BROWSER_REVEAL",
      target: { path: target.path, pathKind: "file", ...(target.name ? { name: target.name } : {}) },
      source: "narrative",
    },
    "*",
  );
}

/** 引用最终去了哪。调用点据此决定给用户什么反馈。 */
export type ComposerDelivery = "host" | "clipboard" | "failed";

/** 当前形态下 @ 会把引用送到哪一端。同步、零请求，用于选按钮文案。 */
export function composerTarget(): "host" | "clipboard" {
  return isEmbedded ? "host" : "clipboard";
}

/** 非安全上下文（经局域网 IP 访问时）拿不到 navigator.clipboard，退回旧 API。 */
function copyViaTextarea(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/**
 * 把一条引用交给「对话的那一端」。
 *
 * 嵌在平台里时那一端是宿主 composer：`text` 是宿主今天就消费的通用通道，
 * `reference` 是同源的结构化载荷。两个一起送而不是二选一——宿主当前把这条消息当
 * 纯文本粘贴（`kind:'paste'`），未知字段会被忽略，所以多送不出错；等宿主注册了
 * 叙事引用类型，直接读 `reference` 即可，叙事这一侧不必再改一次。
 *
 * 独立形态（在 Codex 之类的宿主里直接开这个页面）没有父窗口可发，但**用户自己就在
 * 一个对话里**，而引用文本点名的那些工具（read-file / create-entry / start-pipeline …）
 * 扩展 CLI 全都提供，所以同一段文本在那边同样可执行。因此这里落到剪贴板，
 * 而不是把按钮藏掉、更不是让它点了没反应。
 */
async function sendTextToComposer(
  text: string,
  reference?: NarrativeReference,
): Promise<ComposerDelivery> {
  if (isEmbedded) {
    window.parent.postMessage(
      { type: "FORGEAX_COMPOSER_INSERT", text, reference, source: "narrative" },
      "*",
    );
    return "host";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "clipboard";
  } catch {
    return copyViaTextarea(text) ? "clipboard" : "failed";
  }
}

/** 引用的文本形态，供拖拽把同一段载荷放进 `text/plain`。 */
export function roleReferenceText(role: ComposerRoleInsert): string {
  return formatReference({
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
  });
}
