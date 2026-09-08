import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8');

test('delegates publishing to the shared versioned workflow', () => {
  assert.match(workflow, /uses:\s+ForgeaX-Games\/forgeax-ci\/\.github\/workflows\/npm-publish\.yml@v\d+/u);
  assert.match(workflow, /secrets:\n\s+NPM_TOKEN:\s+\$\{\{ secrets\.NPM_TOKEN \}\}/u);
});

test('uses canonical tag releases without an inline publisher', () => {
  assert.match(workflow, /on:\n  push:\n    tags: \['v\*'\]\n/u);
  assert.doesNotMatch(workflow, /npm publish/u);
  assert.doesNotMatch(workflow, /--provenance/u);
});
