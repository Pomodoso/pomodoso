import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { BLOCK_TYPES, COMPUTED_OPS, TODAY_WIDGET_TYPES } from './catalog.ts';
import { pluginJsonSchema } from './json-schema.ts';
import { LLM_EXAMPLES } from './llms-examples.ts';
import { STARTER_PROMPT, TOP_LEVEL_DOCS, llmsFullTxt, llmsTxt, remixPrompt } from './llms.ts';

const examples = Object.fromEntries(LLM_EXAMPLES.map((n) => [n, readFileSync(new URL(`./examples/${n}.yaml`, import.meta.url), 'utf8')]));
const full = llmsFullTxt(examples);

test('web/public/llms.txt and llms-full.txt are up to date (run gen:llms)', () => {
  assert.equal(readFileSync(new URL('../../../../web/public/llms.txt', import.meta.url), 'utf8'), llmsTxt());
  assert.equal(readFileSync(new URL('../../../../web/public/llms-full.txt', import.meta.url), 'utf8'), full);
});

test('every top-level key of the file is described', () => {
  const keys = Object.keys((pluginJsonSchema() as { properties: Record<string, unknown> }).properties);
  assert.deepEqual(keys.filter((k) => !TOP_LEVEL_DOCS[k]), []);
});

test('every block, widget and computed operator has its section', () => {
  for (const b of BLOCK_TYPES) assert.ok(full.includes(`### \`${b}\``), b);
  for (const w of TODAY_WIDGET_TYPES) assert.ok(full.includes(`### \`${w}\``), w);
  for (const op of COMPUTED_OPS) assert.ok(full.includes(`### \`${op}\``), op);
  assert.ok(!/: any$/m.test(full), 'every property has a readable type');
});

test('the full reference embeds every example whole', () => {
  for (const [name, text] of Object.entries(examples)) assert.ok(full.includes(text.trimEnd()), name);
});

test('the prompts point at the reference and the validator', () => {
  for (const p of [STARTER_PROMPT, remixPrompt(examples['bookshelf']!)]) {
    assert.match(p, /llms-full\.txt/);
    assert.match(p, /npx @pomodoso\/plugin validate/);
  }
  assert.ok(remixPrompt(examples['bookshelf']!).includes(examples['bookshelf']!.trimEnd()));
});
