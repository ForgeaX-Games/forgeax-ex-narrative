import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SERVICE_VERSION } from './src/catalog.generated';
import { defaultCredentialFile, readKeyFromStdin, resolveCredential, writeCredential } from './src/credentials';
import { DEFAULT_BASE_URL } from './src/service';
import { dispatch, DEFAULT_IDLE_TIMEOUT_MS } from './src/verbs';

const INSTALL_SCHEMA = 1;

/**
 * Structural mirror of `@forgeax/game`'s extension contract, declared here so
 * this directory can be copied into a host that has no ForgeaX sources at all —
 * which is exactly what Codex does when it installs a plugin.
 */
export interface ExtensionContext {
  readonly projectRoot: string;
  readonly stateDir: string;
  readonly packageVersion: string;
}

/**
 * Host-side enable. Returns non-secret configuration only: the host writes this
 * verbatim into config.json, so a key here would be a credential leak.
 */
export async function check(context: ExtensionContext, args: readonly string[]) {
  let baseUrl = DEFAULT_BASE_URL;
  let model: string | undefined;
  let credentialBaseUrl: string | undefined;
  let withKeyStdin = false;
  for (let i = 0; i < args.length; i++) {
    const option = args[i]!;
    if (option === '--json') continue;
    else if (option === '--with-key-stdin') withKeyStdin = true;
    else if (option === '--base-url' && args[i + 1]) baseUrl = args[++i]!;
    else if (option === '--model' && args[i + 1]) model = args[++i];
    else if (option === '--llm-base-url' && args[i + 1]) credentialBaseUrl = args[++i];
    else throw new Error('narrative_arguments_invalid: enable [--base-url URL] [--model NAME] [--llm-base-url URL] [--with-key-stdin]');
  }
  new URL(baseUrl);
  if (withKeyStdin) writeCredential(await readKeyFromStdin(), credentialBaseUrl);

  const resolution = resolveCredential();
  return {
    schemaVersion: INSTALL_SCHEMA,
    adapterVersion: context.packageVersion,
    serviceVersion: SERVICE_VERSION,
    baseUrl,
    model: model ?? null,
    credentialFile: defaultCredentialFile(),
    credentialSource: resolution.source,
    credentialOrigin: resolution.origin,
    degraded: resolution.degraded,
    idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_MS / 1000,
  };
}

export async function run(context: ExtensionContext, args: readonly string[]) {
  return dispatch(
    { projectRoot: context.projectRoot, stateDir: context.stateDir, serviceVersion: SERVICE_VERSION },
    args,
  );
}

/**
 * Standalone entry. `@forgeax/game` imports this module and hands us a context;
 * Codex installs the same directory but only has a shell, so running the file
 * directly synthesizes the identical three fields from the working directory.
 */
function standaloneContext(): ExtensionContext {
  const projectRoot = process.cwd();
  const stateDir = resolve(projectRoot, '.forgeax/extensions/narrative');
  mkdirSync(stateDir, { recursive: true });
  return { projectRoot, stateDir, packageVersion: SERVICE_VERSION };
}

async function main(argv: readonly string[]): Promise<number> {
  const [operation, ...rest] = argv;
  if (!operation || operation === '--help' || operation === '-h' || operation === 'help') {
    console.log(`narrative <command> [options]\n\n  enable   Configure this installation (accepts --with-key-stdin).\n  doctor   Report setup, service and credential source.\n  status | start | stop | open | tools | call <tool>\n\nRun \`tools\` for the full operation list.`);
    return 0;
  }
  const context = standaloneContext();
  const result = operation === 'enable'
    ? await check(context, rest)
    : await run(context, [operation, ...rest]);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      process.exit(1);
    },
  );
}
