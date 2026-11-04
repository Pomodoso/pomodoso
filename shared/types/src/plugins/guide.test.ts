import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BLOCK_TYPES, COMPUTED_OPS, HOOK_EVENTS, TODAY_WIDGET_TYPES } from './catalog.ts';
import { GUIDE_BLOCK_EXAMPLES, GUIDE_COMPUTED_EXAMPLES, GUIDE_FIRST_APP, GUIDE_HOOK_EXAMPLES, GUIDE_WIDGET_EXAMPLES, guideManifestData, guideSeedRecords } from './guide.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';

const valid = (data: unknown, name: string) => {
  const r = validatePluginData(data);
  assert.ok(r.ok, `${name}: ${r.ok ? '' : JSON.stringify(r.issues)}`);
};

test('every block example is a valid app on the playground', () => {
  for (const b of BLOCK_TYPES) {
    valid(guideManifestData({ blocks: GUIDE_BLOCK_EXAMPLES[b] }), b);
    assert.ok(GUIDE_BLOCK_EXAMPLES[b].includes(`type: ${b}`), `${b} example uses ${b}`);
  }
});

test('every widget, hook and computed example is valid on the playground', () => {
  for (const w of TODAY_WIDGET_TYPES) valid(guideManifestData({ today: GUIDE_WIDGET_EXAMPLES[w] }), w);
  for (const h of HOOK_EVENTS) valid(guideManifestData({ hooks: GUIDE_HOOK_EXAMPLES[h] }), h);
  for (const op of COMPUTED_OPS) valid(guideManifestData({ computed: GUIDE_COMPUTED_EXAMPLES[op] }), op);
});

test('the first-app walkthrough is valid', () => {
  const r = parsePluginFile(GUIDE_FIRST_APP);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.issues));
});

test('seed records belong to playground collections', () => {
  const recs = guideSeedRecords('2026-03-15');
  assert.ok(recs.length > 0);
  for (const r of recs) assert.ok(['glass', 'book', 'mood'].includes(r.collection));
  assert.ok(recs.some((r) => r.collection === 'glass' && r.occurred_at?.startsWith('2026-03-15')), 'some glasses today');
});
