#!/usr/bin/env node
// Copies extension/ into a @forgeax/game working copy so the real host loader and
// build script can exercise it. The host rejects symlinked extension directories
// (`extension_symlink_not_allowed`), so this copies rather than links.
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '..', 'extension');
const rig = process.env.FORGEAX_GAME_RIG ?? '/root/dev-ForgeaX-GamesV2/fxgame-dev';
const target = resolve(rig, 'extensions', 'narrative');

if (!existsSync(resolve(rig, 'src/extensions/manager.ts'))) {
  throw new Error(`not a @forgeax/game working copy: ${rig} (set FORGEAX_GAME_RIG)`);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.log(`synced ${source} -> ${target}`);
