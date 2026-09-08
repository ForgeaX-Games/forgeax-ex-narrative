import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'src');
const outputRoot = join(root, 'dist');
const runtimeExtensions = new Set(['.json', '.md', '.py', '.yaml', '.yml']);
let copied = 0;

copyRuntimeAssets(sourceRoot);
console.log(`[copy-runtime-assets] copied ${copied} runtime asset(s) into ${relative(root, outputRoot)}`);

function copyRuntimeAssets(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    if (entry.isDirectory()) {
      copyRuntimeAssets(source);
      continue;
    }
    if (!entry.isFile() || !runtimeExtensions.has(extname(entry.name))) continue;
    const destination = join(outputRoot, relative(sourceRoot, source));
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
    copied += 1;
  }
}
