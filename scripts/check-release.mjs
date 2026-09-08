import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = readJson(join(root, 'package.json'));
const manifest = readJson(join(root, 'forgeax-extension.json'));
const expectedName = '@forgeax-extension/narrative';
const forbiddenDependency = /^(?:file:|link:|workspace:|git(?:\+|:))/u;
const forbiddenPackedPath = /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:node_modules|src|viz\/src|docs)(?:\/|$)/u;

assert(packageJson.name === expectedName, `package name must be ${expectedName}`);
assert(manifest.id === packageJson.name, 'manifest id must equal package name');
assert(manifest.version === packageJson.version, 'manifest and package versions must match');
assert(packageJson.private === false, 'package must be public');
assert(packageJson.publishConfig?.access === 'public', 'publishConfig.access must be public');

for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
    assert(typeof version === 'string' && !forbiddenDependency.test(version),
      `${section}.${name} must use a registry version`);
  }
}

execFileSync('npm', ['run', 'lint'], { cwd: root, stdio: 'inherit' });
execFileSync('npm', ['run', 'test'], { cwd: root, stdio: 'inherit' });
execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });

for (const entry of [manifest.entry?.frontend, manifest.entry?.backend]) {
  assert(typeof entry === 'string' && entry.startsWith('./'), `invalid manifest entry: ${entry}`);
  assert(existsSync(resolve(root, entry)), `manifest entry is missing after build: ${entry}`);
}

for (const directory of [join(root, 'server')]) {
  for (const file of sourceFiles(directory)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\1/gu)) {
      const target = resolve(dirname(file), match[2]);
      assert(target === root || target.startsWith(`${root}${sep}`),
        `${relative(root, file)} imports outside the package: ${match[2]}`);
    }
  }
}

const temp = mkdtempSync(join(tmpdir(), 'forgeax-narrative-pack-'));
try {
  const packOutput = execFileSync('npm', ['pack', '--json', '--pack-destination', temp], {
    cwd: root,
    encoding: 'utf8',
  });
  const pack = JSON.parse(packOutput)[0];
  assert(pack?.filename && Array.isArray(pack.files), 'npm pack returned no artifact');
  const packedPaths = new Set(pack.files.map((file) => file.path.replaceAll('\\', '/')));
  for (const required of [
    'dist/index.js',
    'dist/api/server.js',
    'dist/knowledge/game-narrative/skills/narrative-studio/SKILL.md',
    'viz/dist/index.html',
    'server/tool-handlers.ts',
    'forgeax-extension.json',
    'SKILL.md',
  ]) {
    assert(packedPaths.has(required), `required runtime file is not packed: ${required}`);
  }
  for (const path of packedPaths) assert(!forbiddenPackedPath.test(path), `forbidden packed path: ${path}`);

  const tarball = join(temp, pack.filename);
  execFileSync('npm', ['install', '--ignore-scripts', '--package-lock=false', '--no-audit', '--no-fund', tarball], {
    cwd: temp,
    stdio: 'inherit',
  });
  const installedRoot = join(temp, 'node_modules', '@forgeax-extension', 'narrative');
  const installedPackage = readJson(join(installedRoot, 'package.json'));
  const installedManifest = readJson(join(installedRoot, 'forgeax-extension.json'));
  assert(installedPackage.name === installedManifest.id, 'installed package is not discoverable by manifest identity');
  assert(installedPackage.version === installedManifest.version, 'installed package and manifest versions differ');
  assert(existsSync(join(installedRoot, 'dist/api/server.js')), 'installed backend entry is missing');
  console.log(`release check passed for ${packageJson.name}@${packageJson.version} (${packedPaths.size} files)`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
