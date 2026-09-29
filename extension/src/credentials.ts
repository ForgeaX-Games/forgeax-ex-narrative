import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findHostAgent } from './locate';

/**
 * Three credential sources, tried in order. Swap PRECEDENCE to change which wins.
 *
 * Nothing here is ever persisted outside the narrative-owned credential file: the
 * Engine variables are read straight from the environment and forwarded to the
 * service process, so uninstalling narrative cannot invalidate an Engine key.
 */
export const PRECEDENCE = ['narrative', 'engine', 'platform'] as const;
export type Source = (typeof PRECEDENCE)[number] | 'none';

export const NARRATIVE_ENV = 'FORGEAX_NARRATIVE_API_KEY';
const ENGINE_KEY_ENV = 'FORGEAX_LITELLM_API_KEY';
const ENGINE_URL_ENV = 'FORGEAX_LITELLM_BASE_URL';

export interface Resolution {
  source: Source;
  /** Human-readable origin for `doctor`; never contains the secret itself. */
  origin: string;
  /** Environment the narrative service needs. Treat as secret; never log. */
  env: Record<string, string>;
  /** Platform fallback borrows the host model and loses narrative's own prompts. */
  degraded: boolean;
}

export function defaultCredentialFile(): string {
  return resolve(homedir(), '.forgeax', 'narrative', 'credentials.json');
}

const trimmed = (name: string) => process.env[name]?.trim() || undefined;

function fromNarrative(file: string): Resolution | undefined {
  const direct = trimmed(NARRATIVE_ENV) ?? trimmed('GEMINI_API_KEY');
  if (direct) {
    return { source: 'narrative', origin: trimmed(NARRATIVE_ENV) ? `${NARRATIVE_ENV} (env)` : 'GEMINI_API_KEY (env)',
      env: { GEMINI_API_KEY: direct }, degraded: false };
  }
  const proxyKey = trimmed('LITELLM_PROXY_KEY');
  const proxyUrl = trimmed('LLM_PROXY_URL');
  if (proxyKey && proxyUrl) {
    return { source: 'narrative', origin: 'LITELLM_PROXY_KEY + LLM_PROXY_URL (env)',
      env: { LITELLM_PROXY_KEY: proxyKey, LLM_PROXY_URL: proxyUrl }, degraded: false };
  }
  if (!existsSync(file)) return undefined;
  const value = JSON.parse(readFileSync(file, 'utf8')) as { apiKey?: unknown; baseUrl?: unknown };
  if (typeof value.apiKey !== 'string' || !value.apiKey.trim()) {
    throw new Error(`narrative_credential_invalid: ${file} has no usable apiKey`);
  }
  const key = value.apiKey.trim();
  const url = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '';
  return { source: 'narrative', origin: file,
    env: url ? { LITELLM_PROXY_KEY: key, LLM_PROXY_URL: url } : { GEMINI_API_KEY: key }, degraded: false };
}

/**
 * The Engine gateway and narrative's proxy mode are the same LiteLLM deployment
 * behind different variable names, so borrowing it is a rename rather than a
 * second integration.
 */
function fromEngine(): Resolution | undefined {
  const key = trimmed(ENGINE_KEY_ENV);
  const url = trimmed(ENGINE_URL_ENV);
  if (!key || !url) return undefined;
  return { source: 'engine', origin: `${ENGINE_KEY_ENV} + ${ENGINE_URL_ENV} (env, read-only)`,
    env: { LITELLM_PROXY_KEY: key, LLM_PROXY_URL: url }, degraded: false };
}

/**
 * Last resort: no key anywhere, so the workshop borrows the host agent's model.
 *
 * Resolving the host executable is this side's job, not the service's: the shell
 * runs inside the host and can see where it lives, while the service is a
 * detached process that would only be guessing. Finding nothing returns
 * undefined rather than a cheerful `degraded` — a fallback that cannot run is
 * worse than no fallback, because the caller acts on the claim.
 */
function fromPlatform(): Resolution | undefined {
  const command = findHostAgent();
  if (!command) return undefined;
  // The host's own login is what makes this work, and it lives under
  // CODEX_HOME. Forwarding it matters because the service is a detached
  // process: a relocated CODEX_HOME that we drop turns into a 401 from a
  // binary the user can run by hand, which reads as our bug.
  const codexHome = trimmed('CODEX_HOME');
  return { source: 'platform', origin: `host agent via \`${command} exec\``,
    env: { NARRATIVE_LLM_BACKEND: 'host-agent', NARRATIVE_HOST_AGENT_CMD: command,
      ...(codexHome ? { CODEX_HOME: codexHome } : {}) }, degraded: true };
}

/** No credential of any kind. Named so `doctor` can say so before `start` tries. */
export const NO_CREDENTIAL: Resolution = {
  source: 'none', origin: 'nothing configured and no host agent found', env: {}, degraded: true,
};

export function resolveCredential(file = defaultCredentialFile()): Resolution {
  for (const source of PRECEDENCE) {
    const found = source === 'narrative' ? fromNarrative(file) : source === 'engine' ? fromEngine() : fromPlatform();
    if (found) return found;
  }
  return NO_CREDENTIAL;
}

export function writeCredential(key: string, baseUrl?: string, file = defaultCredentialFile()): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify({ apiKey: key, ...(baseUrl ? { baseUrl } : {}) }) + '\n', { mode: 0o600 });
  renameSync(temp, file);
  chmodSync(file, 0o600);
}

/** Reads a secret from stdin so it never appears in argv, shell history or logs. */
export async function readKeyFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const key = Buffer.concat(chunks).toString('utf8').trim();
  if (!key) throw new Error('narrative_credential_missing: no key on stdin');
  return key;
}
