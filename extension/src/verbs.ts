import { readFileSync } from 'node:fs';
import { BY_NAME, CATALOG } from './catalog.generated';
import { resolveCredential, type Resolution } from './credentials';
import { DEFAULT_BASE_URL, foreignService, probeHealth, recordedPid, startService, stopService, type Health } from './service';

/** Default: end an unused workshop after 30 idle minutes so it is not left running forever. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Operations this CLI owns. Must stay disjoint from the generated tool names. */
export const LIFECYCLE = ['doctor', 'status', 'start', 'stop', 'open', 'tools', 'call'] as const;

export interface VerbContext {
  projectRoot: string;
  stateDir: string;
  /** Version of the service package to launch. */
  serviceVersion: string;
}

export interface Options {
  baseUrl: string;
  json: boolean;
  args?: Record<string, unknown>;
  idleTimeoutMs: number;
  timeoutMs: number;
  positional: string[];
}

export function parseOptions(input: readonly string[], usage: string): Options {
  const options: Options = { baseUrl: DEFAULT_BASE_URL, json: false, idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    timeoutMs: 240_000, positional: [] };
  for (let i = 0; i < input.length; i++) {
    const option = input[i]!;
    if (option === '--json') options.json = true;
    else if (option === '--base-url' && input[i + 1]) options.baseUrl = input[++i]!;
    else if (option === '--idle-timeout' && input[i + 1]) options.idleTimeoutMs = Number(input[++i]) * 1000;
    else if (option === '--timeout' && input[i + 1]) options.timeoutMs = Number(input[++i]) * 1000;
    else if (option === '--args-json' && input[i + 1]) options.args = JSON.parse(input[++i]!);
    else if (option === '--args-file' && input[i + 1]) options.args = JSON.parse(readFileSync(input[++i]!, 'utf8'));
    else if (!option.startsWith('-')) options.positional.push(option);
    else throw new Error(`narrative_arguments_invalid: ${usage}`);
  }
  new URL(options.baseUrl);
  if (!Number.isFinite(options.idleTimeoutMs) || options.idleTimeoutMs < 0) {
    throw new Error('narrative_arguments_invalid: --idle-timeout takes seconds');
  }
  return options;
}

/** Which model path `resolution` would boot a service with. Mirrors `/api/health`'s `backend`. */
function plannedBackend(resolution: Resolution): string {
  if (resolution.env.LLM_PROXY_URL) return 'proxy';
  if (resolution.env.GEMINI_API_KEY) return 'gemini';
  if (resolution.env.NARRATIVE_LLM_BACKEND === 'host-agent') return 'host-agent';
  return 'none';
}

/**
 * Non-secret view of the resolved credential, safe for logs and config.json.
 *
 * With a service already up, what this shell *would* inject and what that
 * process *is* using are two different facts, and reporting only the first one
 * next to a live service reads as a statement about the live service. A run
 * then fails on a credential the report said was not in play.
 */
function credentialReport(resolution: Resolution, health?: Health) {
  const planned = plannedBackend(resolution);
  // `host-agent-blocked` is the same choice, reported as unusable — saying a
  // restart would switch to `host-agent` would send the reader back to a door
  // the service already found locked. `blocked` carries that story instead.
  const chosen = health?.backend?.replace(/-blocked$/u, '');
  return {
    credentialSource: resolution.source, credentialOrigin: resolution.origin, degraded: resolution.degraded,
    ...(health ? { serviceBackend: health.backend ?? 'unknown' } : {}),
    ...(chosen && chosen !== planned
      ? { credentialNote: `the running service is using ${chosen}; restarting it would use ${planned}` }
      : {}),
  };
}

/** Why the live service is not ours, phrased as something the caller can act on. */
function conflictReport(health: Health, context: VerbContext, baseUrl: string) {
  const reason = foreignService(health, {
    projectRoot: context.projectRoot,
    startedByUs: recordedPid(context.stateDir) !== undefined,
  });
  if (!reason) return undefined;
  return (
    `narrative_service_conflict: something else is already answering at ${baseUrl} — ${reason}.\n` +
    `Its credential, its version and where it writes are not the ones reported here, so driving it ` +
    `would produce results this installation cannot account for.\n` +
    `Stop that process, or give this one a port of its own: ` +
    `\`start --base-url http://127.0.0.1:8901\` (pass the same --base-url to every later command).`
  );
}

/**
 * What to do about a credential the service cannot boot with, or undefined when
 * it can. Checked here rather than discovered from a dead service's log: the
 * whole point of `doctor` is to answer before anything is spawned.
 */
const CONFIGURE_A_KEY =
  'Configure a key without putting it in argv or shell history:\n' +
  '  <your key> | narrative enable --with-key-stdin';

function credentialBlocker(resolution: Resolution): string | undefined {
  if (resolution.source !== 'none') return undefined;
  return (
    `narrative_credential_missing: no API key and no host agent to borrow.\n${CONFIGURE_A_KEY}\n` +
    'Or install the Codex CLI so the workshop can borrow the host model.'
  );
}

/**
 * Why a service that is up still cannot generate.
 *
 * A running service knows something this shell cannot: whether borrowing the
 * host's model actually works from inside the sandbox it was started in. This
 * one is reported rather than thrown — the authoring UI is still worth having,
 * and the user may be about to configure a key.
 */
function generationBlocker(health: Health): string | undefined {
  if (health.backend !== 'host-agent-blocked') return undefined;
  return (
    `narrative_generation_unavailable: the workshop has no key of its own, and cannot borrow ` +
    `the host's model from where it is running.\n${health.backendError ?? ''}\n${CONFIGURE_A_KEY}`
  );
}

async function diagnose(context: VerbContext, options: Options, operation: string) {
  const resolution = resolveCredential();
  const health = await probeHealth(options.baseUrl);
  // A live service settles the credential question by having booted; what it
  // cannot settle is whether the model it was told to borrow is reachable.
  const blocker = health ? generationBlocker(health) : credentialBlocker(resolution);
  const conflict = health ? conflictReport(health, context, options.baseUrl) : undefined;
  return {
    ok: !conflict && !blocker,
    operation,
    projectRoot: context.projectRoot,
    stateDir: context.stateDir,
    baseUrl: options.baseUrl,
    service: health ?? null,
    pid: recordedPid(context.stateDir) ?? null,
    ...credentialReport(resolution, health),
    ...(conflict ? { conflict } : {}),
    ...(blocker ? { blocked: blocker } : {}),
  };
}

export async function dispatch(context: VerbContext, argv: readonly string[]): Promise<unknown> {
  const [operation, ...rest] = argv;

  if (operation === 'doctor' || operation === 'status') {
    return diagnose(context, parseOptions(rest, `${operation} [--base-url URL] [--json]`), operation);
  }

  if (operation === 'start') {
    const options = parseOptions(rest, 'start [--base-url URL] [--idle-timeout SECONDS] [--json]');
    const resolution = resolveCredential();
    // Adopting whatever holds the port is how `start` reports success for a
    // process it did not launch and cannot describe. Check before adopting.
    const existing = await probeHealth(options.baseUrl);
    if (existing) {
      const conflict = conflictReport(existing, context, options.baseUrl);
      if (conflict) throw new Error(conflict);
    }
    // Refuse before spawning. Letting a doomed service start means the reason
    // arrives as a log tail after a 90-second wait, which is how one missing
    // key turns into an afternoon of chasing the wrong bug.
    const blocker = credentialBlocker(resolution);
    if (blocker && !existing) throw new Error(blocker);
    const result = await startService({
      projectRoot: context.projectRoot, stateDir: context.stateDir,
      baseUrl: options.baseUrl, env: resolution.env,
      version: context.serviceVersion, idleTimeoutMs: options.idleTimeoutMs,
    });
    const unusable = generationBlocker(result.health);
    return {
      ...result, url: options.baseUrl, ...credentialReport(resolution, result.health),
      // Not thrown: the service is up and the UI is usable. But `start` is the
      // last moment before the caller asks it to generate, so say it here.
      ...(unusable ? { blocked: unusable } : {}),
    };
  }

  if (operation === 'stop') {
    parseOptions(rest, 'stop [--json]');
    return stopService(context.stateDir);
  }

  /**
   * Returns the address rather than launching a browser: the workshop should be
   * offered, not forced on the user mid-conversation.
   */
  if (operation === 'open') {
    const options = parseOptions(rest, 'open [--base-url URL] [--json]');
    const health = await probeHealth(options.baseUrl);
    const conflict = health ? conflictReport(health, context, options.baseUrl) : undefined;
    if (conflict) throw new Error(conflict);
    return { url: options.baseUrl, running: Boolean(health), service: health ?? null,
      hint: health ? 'Offer this address to the user.' : 'Run `start` first.' };
  }

  if (operation === 'tools') {
    parseOptions(rest, 'tools [--json]');
    return { count: CATALOG.length, tools: CATALOG };
  }

  /**
   * Every workshop operation reaches the same handler table the Studio host
   * uses, so the two surfaces cannot drift apart. `call <tool>` and a bare
   * tool name are the same path; LIFECYCLE keeps the two namespaces disjoint.
   */
  const tool = operation === 'call' ? rest[0] : operation;
  const tail = operation === 'call' ? rest.slice(1) : rest;
  if (tool && BY_NAME.has(tool)) {
    const entry = BY_NAME.get(tool)!;
    const options = parseOptions(tail, `${tool} --args-json '{...}' | --args-file PATH`);
    const args = options.args ?? {};
    const missing = entry.required.filter((name) => !(name in args));
    if (missing.length) throw new Error(`narrative_arguments_invalid: ${tool} requires ${missing.join(', ')}`);
    const health = await probeHealth(options.baseUrl);
    if (!health) {
      throw new Error(`narrative_service_unavailable: nothing answering at ${options.baseUrl}; run \`start\` first`);
    }
    // The same check `start` makes, because a tool call is where the mistake
    // actually costs something: `start` merely adopts the stranger, this sends
    // the user's work to it.
    const conflict = conflictReport(health, context, options.baseUrl);
    if (conflict) throw new Error(conflict);
    const response = await fetch(new URL(`/api/tools/${tool}`, options.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args, projectRoot: context.projectRoot }),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body = (await response.json()) as { ok?: boolean; value?: unknown; error?: string };
    if (!response.ok || body.ok === false) throw new Error(`${tool}_failed: ${body.error ?? response.statusText}`);
    return { tool, value: body.value };
  }

  throw new Error(
    `narrative_arguments_invalid: unknown operation ${operation ?? '(none)'}; ` +
      `expected ${LIFECYCLE.join(', ')} or a tool name from \`tools --json\``,
  );
}
