import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Finding executables somebody else installed.
 *
 * Both things this shell has to launch — the narrative service and the host
 * agent — were installed by a package manager we do not control, at a path we
 * cannot hardcode. Two rules learned the hard way on Windows:
 *
 *  - A name is not a command. `spawn` does not apply PATHEXT, so "is
 *    `foo.cmd` on PATH" and "can I `spawn('foo')`" are different questions.
 *    Everything here returns the resolved path, never the bare name.
 *  - Prefer a JS entry over a shim. npm's Windows `.cmd` shims cannot be
 *    spawned without a shell, and a shell in between costs us the real pid.
 *    Running `node <entry>` works the same on every platform.
 */

export const WINDOWS = process.platform === 'win32';

/** Resolved absolute path of an executable on PATH, or undefined. */
export function findOnPath(name: string): string | undefined {
  const candidates = WINDOWS ? [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name] : [name];
  for (const dir of (process.env.PATH ?? '').split(WINDOWS ? ';' : ':')) {
    if (!dir) continue;
    for (const file of candidates) {
      const full = resolve(dir, file);
      if (existsSync(full)) return full;
    }
  }
  return undefined;
}

/** A spawnable command: an executable plus any leading args it needs. */
export interface Launcher {
  command: string;
  args: string[];
}

/**
 * The JS file an npm bin entry ultimately runs, when we can find it.
 *
 * On POSIX the bin is a symlink straight to it. On Windows it is a `.cmd`
 * shim next to `node_modules/`, so we walk to the package and read its own
 * `bin` field rather than parsing the shim.
 */
function jsEntryBehind(binPath: string, packageName: string, binName: string): string | undefined {
  try {
    const real = realpathSync(binPath);
    if (real.endsWith('.js') || real.endsWith('.mjs')) return real;
  } catch { /* Broken symlink; fall through to the package lookup. */ }

  const root = join(dirname(binPath), 'node_modules', ...packageName.split('/'));
  return binEntry(root, join(root, 'package.json'), binName);
}

/**
 * The file a package's `bin` field points at, absolute, or undefined.
 *
 * The name matters when a package ships several: npm's own `bin` lists `npm`
 * first, so taking whichever comes first hands back `npm-cli.js` to a caller
 * that asked for `npx`.
 */
export function pickBinPath(bin: unknown, binName: string): string | undefined {
  if (typeof bin === 'string') return bin;
  if (!bin || typeof bin !== 'object') return undefined;
  const table = bin as Record<string, string>;
  return table[binName] ?? Object.values(table)[0];
}

function binEntry(root: string, manifest: string, binName: string): string | undefined {
  if (!existsSync(manifest)) return undefined;
  try {
    const relative = pickBinPath((JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: unknown }).bin, binName);
    if (!relative) return undefined;
    const entry = join(root, relative);
    return existsSync(entry) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where global packages live when the bin directory is not on PATH.
 *
 * On Windows it usually is not: npm installs to `%APPDATA%\npm`, and nothing
 * adds that to PATH for you. Searching these means an installed service is
 * found even then — otherwise the machine most likely to be offline is also
 * the one that falls back to the registry.
 */
function globalRoots(): string[] {
  const prefix = process.env.npm_config_prefix?.trim();
  const nodeDir = dirname(process.execPath);
  const roots = prefix
    ? [WINDOWS ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules')]
    : [];
  if (WINDOWS) {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    roots.push(join(appData, 'npm', 'node_modules'), join(nodeDir, 'node_modules'));
  } else {
    roots.push(
      join(nodeDir, '..', 'lib', 'node_modules'),
      '/usr/local/lib/node_modules',
      '/usr/lib/node_modules',
      join(homedir(), '.npm-global', 'lib', 'node_modules'),
    );
  }
  return roots;
}

/** The JS entry of a package installed under one of the global roots. */
function jsEntryInGlobalRoots(packageName: string, binName: string): string | undefined {
  for (const root of globalRoots()) {
    const manifest = join(root, ...packageName.split('/'), 'package.json');
    if (!existsSync(manifest)) continue;
    const entry = binEntry(join(root, ...packageName.split('/')), manifest, binName);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * How to launch an npm-installed bin, preferring `node <entry>` over the shim.
 * Returns undefined when the package is not installed at all.
 */
export function locateNodeBin(binName: string, packageName: string): Launcher | undefined {
  const onPath = findOnPath(binName);
  if (onPath) {
    const entry = jsEntryBehind(onPath, packageName, binName);
    if (entry) return { command: process.execPath, args: [entry] };
    // A shim we could not see behind. Batch files need a shell, which costs us
    // the child's real pid — acceptable only because the alternative is not
    // starting at all.
    return { command: onPath, args: [] };
  }
  const global = jsEntryInGlobalRoots(packageName, binName);
  return global ? { command: process.execPath, args: [global] } : undefined;
}

/**
 * `npx`, resolved rather than named — and run as a script, not as a shim.
 *
 * Same trap as every other bin: on Windows it is `npx.cmd`, so `spawn('npx')`
 * fails with ENOENT on a machine where `npx` works fine in a terminal. Going
 * through the shim is worse than it looks: the default Windows install lives
 * in `C:\Program Files\nodejs`, and a `.cmd` has to be handed to a shell,
 * which splits that path at the space. `node <npx-cli.js>` has neither problem.
 */
export function locateNpx(): Launcher | undefined {
  const found = findOnPath('npx');
  if (!found) return undefined;
  const entry = jsEntryBehind(found, 'npm', 'npx');
  return entry ? { command: process.execPath, args: [entry] } : { command: found, args: [] };
}

/** True when a `.cmd`/`.bat` launcher needs a shell to run at all. */
export function needsShell(launcher: Launcher): boolean {
  return WINDOWS && /\.(cmd|bat)$/i.test(launcher.command);
}

/**
 * A launcher in the exact form `spawn` needs.
 *
 * With `shell: true` the command and args are pasted into one string for
 * `cmd.exe`, so anything containing a space has to arrive already quoted —
 * otherwise a perfectly good path becomes two words and the shell reports a
 * command nobody wrote. Quoting is the caller's job and this is that caller.
 */
export function spawnForm(launcher: Launcher): { command: string; args: string[]; shell: boolean } {
  const shell = needsShell(launcher);
  if (!shell) return { command: launcher.command, args: launcher.args, shell };
  const quote = (value: string) => (/\s/u.test(value) ? `"${value}"` : value);
  return { command: quote(launcher.command), args: launcher.args.map(quote), shell };
}

/**
 * The host agent's executable.
 *
 * PATH first, because that is where every sane install puts it. The Windows
 * desktop app is the exception: it keeps its CLI in an opaque per-build
 * directory that is deliberately off PATH, so we scan for it — otherwise the
 * one platform where users are most likely to have no API key is also the one
 * where borrowing the host model silently fails.
 */
export function findHostAgent(): string | undefined {
  const override = process.env.FORGEAX_NARRATIVE_HOST_AGENT?.trim();
  if (override) return existsSync(override) ? override : undefined;

  const onPath = findOnPath('codex');
  if (onPath) return onPath;
  if (!WINDOWS) return undefined;

  const base = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
    'OpenAI', 'Codex', 'bin');
  if (!existsSync(base)) return undefined;
  try {
    // Several build directories can coexist after an update; the newest one is
    // the CLI the installed desktop app actually ships.
    const found = readdirSync(base)
      .map((entry) => join(base, entry, 'codex.exe'))
      .filter((file) => existsSync(file) && statSync(file).isFile())
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return found[0];
  } catch { /* Unreadable directory is the same as no host agent. */ }
  return undefined;
}
