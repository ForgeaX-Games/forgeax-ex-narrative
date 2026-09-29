#!/usr/bin/env bun
// Bundles extension/cli.ts into the extension/cli.mjs that both hosts load.
//
// @forgeax/game rebuilds this itself at package time, so for that path the
// committed artifact is only a convenience. Codex is the reason it must be
// committed: `codex plugin add` copies the plugin directory verbatim and never
// runs a build, so whatever is in git is what the user gets.
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const result = await Bun.build({
  entrypoints: [resolve(root, 'extension/cli.ts')],
  outdir: resolve(root, 'extension'),
  naming: 'cli.mjs',
  target: 'node',
  format: 'esm',
});
if (!result.success) throw new Error(result.logs.join('\n'));

const bytes = (await Bun.file(resolve(root, 'extension/cli.mjs')).arrayBuffer()).byteLength;
console.log(`built extension/cli.mjs (${bytes} bytes)`);
