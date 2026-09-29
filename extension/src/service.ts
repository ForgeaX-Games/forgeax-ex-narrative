import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locateNodeBin, locateNpx, spawnForm, WINDOWS, type Launcher } from './locate';

export const DEFAULT_PORT = 8900;
export const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

/** Published service package; `serve` is its long-running entry. */
const SERVICE_PACKAGE = '@forgeax-extension/narrative';
/** Point at a checkout instead of the registry while developing. */
const COMMAND_OVERRIDE = 'FORGEAX_NARRATIVE_SERVICE_CMD';

export interface Health {
  status: string;
  service: string;
  version: string;
  /** Which model path the service actually booted with. Absent on older services. */
  backend?: string;
  /** Why `backend` is unusable, when the service found out at boot. */
  backendError?: string;
  /** The project the service was started for. Absent on older services. */
  projectRoot?: string | null;
}

export async function probeHealth(baseUrl: string, timeoutMs = 3000): Promise<Health | undefined> {
  try {
    const response = await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const value = (await response.json()) as Partial<Health>;
    if (value.service !== 'narrative-studio') return undefined;
    return {
      status: String(value.status), service: value.service, version: String(value.version),
      ...(typeof value.backend === 'string' ? { backend: value.backend } : {}),
      ...(typeof value.backendError === 'string' ? { backendError: value.backendError } : {}),
      ...(typeof value.projectRoot === 'string' ? { projectRoot: value.projectRoot } : {}),
    };
  } catch {
    return undefined;
  }
}

const samePath = (a: string, b: string) =>
  (WINDOWS ? a.toLowerCase() : a).replace(/[\\/]+$/u, '') === (WINDOWS ? b.toLowerCase() : b).replace(/[\\/]+$/u, '');

/**
 * Why the service answering this port is not ours, or undefined when it is.
 *
 * "Something answers /api/health" was the whole identity test, and it is not
 * one: a workshop from another checkout, another project, or another operating
 * system reachable through a loopback forwarder answers it just as well. Driving
 * that one looks like success right up until it fails on a credential we never
 * configured, and by then every report we printed described a different process.
 *
 * The identity is the project, not the version: this shell always injects
 * `FORGEAX_PROJECT_ROOT`, so a service that reports a different one — or none —
 * is one we did not launch. Version is deliberately not a criterion, because a
 * globally installed service may legitimately lag the plugin that starts it.
 */
export function foreignService(
  health: Health,
  expected: { projectRoot: string; startedByUs: boolean },
): string | undefined {
  if (!health.projectRoot) {
    // Our own service predating the field is the one benign case, and a live
    // pid we recorded is what tells the two apart.
    if (expected.startedByUs) return undefined;
    return `its health reports no project, so it did not come from this shell (version ${health.version})`;
  }
  if (samePath(health.projectRoot, expected.projectRoot)) return undefined;
  return `it was started for ${health.projectRoot}, not ${expected.projectRoot} (version ${health.version})`;
}

const pidFile = (stateDir: string) => resolve(stateDir, 'service.pid');
const logFile = (stateDir: string) => resolve(stateDir, 'service.log');

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function logTail(stateDir: string, lines = 12): string {
  try {
    return readFileSync(logFile(stateDir), 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '(no output)';
  }
}

export function recordedPid(stateDir: string): number | undefined {
  const path = pidFile(stateDir);
  if (!existsSync(path)) return undefined;
  const pid = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || !running(pid)) { rmSync(path, { force: true }); return undefined; }
  return pid;
}

/** The service package's single bin. Named explicitly so npx never has to guess. */
const SERVICE_BIN = 'forgeax-narrative';

function launchCommand(version: string): Launcher {
  const override = process.env[COMMAND_OVERRIDE]?.trim();
  if (override) {
    // A lone path is a path, not a word list: Windows paths contain spaces, and
    // splitting one produces a command nobody wrote. Only split when the whole
    // string is not itself something we can run.
    if (existsSync(override)) return { command: override, args: [] };
    const [command, ...args] = override.split(/\s+/u);
    return { command: command!, args };
  }
  // An already-installed service needs no registry round-trip. That matters
  // inside agent sandboxes, which commonly deny network until the user approves.
  const installed = locateNodeBin(SERVICE_BIN, SERVICE_PACKAGE);
  if (installed) return { ...installed, args: [...installed.args, 'serve'] };
  const npx = locateNpx();
  if (!npx) {
    throw new Error(
      `narrative_service_unavailable: ${SERVICE_PACKAGE} is not installed and npx was not found.\n` +
        `Install the service once with \`npm i -g ${SERVICE_PACKAGE}\`.`,
    );
  }
  return {
    ...npx,
    args: [...npx.args, '-y', `--package=${SERVICE_PACKAGE}@${version}`, '--', SERVICE_BIN, 'serve'],
  };
}

export interface StartResult {
  started: boolean;
  pid?: number;
  baseUrl: string;
  health: Health;
}

/**
 * Starts the workshop and waits for it to answer, then lets it outlive this
 * process: extension CLIs are one-shot, so a child that died with us would be
 * gone before the user could open the UI. `stop` and the service's own idle
 * timeout are what end it.
 */
export async function startService(options: {
  projectRoot: string;
  stateDir: string;
  baseUrl: string;
  env: Record<string, string>;
  version: string;
  idleTimeoutMs: number;
  readyTimeoutMs?: number;
}): Promise<StartResult> {
  const existing = await probeHealth(options.baseUrl);
  if (existing) return { started: false, pid: recordedPid(options.stateDir), baseUrl: options.baseUrl, health: existing };

  mkdirSync(options.stateDir, { recursive: true });
  const log = openSync(logFile(options.stateDir), 'a');
  // Only batch shims need a shell, and they are the one case where the recorded
  // pid belongs to the shell rather than the service. `locateNodeBin` avoids it
  // whenever the package's JS entry can be found.
  const { command, args, shell } = spawnForm(launchCommand(options.version));
  const child = spawn(command, args, {
    detached: true,
    shell,
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      ...options.env,
      // Where artifacts land follows the project, not the host: with a root the
      // service writes into `.forgeax/games/<slug>/narrative/` exactly as it does
      // under Studio, and a directory that is no game has no slug to find, so it
      // falls back to `cwd()/output` on its own. No third mode for Codex.
      FORGEAX_PROJECT_ROOT: options.projectRoot,
      NARRATIVE_PORT: String(new URL(options.baseUrl).port || DEFAULT_PORT),
      NARRATIVE_IDLE_TIMEOUT_MS: String(options.idleTimeoutMs),
    },
  });
  // `spawn` reports a missing executable asynchronously, and an unhandled
  // 'error' event kills this process with a raw stack trace. Capture it so the
  // wait loop below can explain what we tried to launch instead.
  let spawnFailure: Error | undefined;
  child.on('error', (error) => { spawnFailure = error; });
  child.unref();
  if (child.pid) writeFileSync(pidFile(options.stateDir), `${child.pid}\n`, { mode: 0o600 });

  const deadline = Date.now() + (options.readyTimeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    const health = await probeHealth(options.baseUrl, 2000);
    if (health) return { started: true, pid: child.pid, baseUrl: options.baseUrl, health };
    if (spawnFailure) break;
    if (child.pid && !running(child.pid)) break;
    await new Promise((done) => setTimeout(done, 750));
  }
  // A one-shot CLI gets one chance to explain itself, so carry the log tail out
  // rather than making the caller go find it. Registry failures land here when a
  // sandbox denies network before npx can fetch the service package.
  throw new Error(
    `narrative_service_unavailable: did not answer at ${options.baseUrl}\n` +
      `launched: ${command} ${args.join(' ')}\n` +
      (spawnFailure ? `spawn failed: ${spawnFailure.message}\n` : '') +
      `log (${logFile(options.stateDir)}):\n${logTail(options.stateDir)}\n` +
      `If the registry is unreachable, install the service once with ` +
      `\`npm i -g ${SERVICE_PACKAGE}\` and retry; start will then use it directly.`,
  );
}

export function stopService(stateDir: string): { stopped: boolean; pid?: number } {
  const pid = recordedPid(stateDir);
  if (!pid) return { stopped: false };
  try { process.kill(pid); } catch { /* Already gone between the check and the signal. */ }
  rmSync(pidFile(stateDir), { force: true });
  return { stopped: true, pid };
}
