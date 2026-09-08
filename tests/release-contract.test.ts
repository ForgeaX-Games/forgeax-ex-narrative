import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('release package identity', () => {
  it('keeps package and extension manifest identity aligned', () => {
    const root = resolve(import.meta.dirname, '..');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(resolve(root, 'forgeax-extension.json'), 'utf8'));
    expect(packageJson.name).toBe('@forgeax-extension/narrative');
    expect(manifest.id).toBe(packageJson.name);
    expect(manifest.version).toBe(packageJson.version);
  });
});
