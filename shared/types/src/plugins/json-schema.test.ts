import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { pluginJsonSchema } from './json-schema.ts';

test('schema/plugin.v1.json is up to date (run gen:plugin-schema)', () => {
  const committed = JSON.parse(readFileSync(new URL('../../schema/plugin.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(pluginJsonSchema())));
});

test('the recursive computed value is a named definition', () => {
  const s = pluginJsonSchema() as { $defs?: Record<string, unknown> };
  assert.ok(s.$defs?.ComputedValue);
});

test('the five reference plugins pass the JSON Schema too', async () => {
  // ajv is a dev-only dependency: it compiles with new Function, which is fine
  // in a test and never ships to a client.
  const { Ajv2020 } = await import('ajv/dist/2020.js');
  const { parse } = await import('yaml');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(pluginJsonSchema());
  for (const name of ['quit-smoking', 'year-in-pixels', 'reading-list', 'bookshelf', 'movieshelf']) {
    const data = parse(readFileSync(new URL(`./examples/${name}.yaml`, import.meta.url), 'utf8'));
    assert.ok(validate(data), `${name}: ${ajv.errorsText(validate.errors)}`);
  }
});

test('refinements are in the JSON Schema too: what zod rejects, the schema rejects', async () => {
  const { Ajv2020 } = await import('ajv/dist/2020.js');
  const { parse } = await import('yaml');
  const { validatePluginData } = await import('./parse.ts');
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const validate = ajv.compile(pluginJsonSchema());
  const base = () => parse(readFileSync(new URL('./examples/quit-smoking.yaml', import.meta.url), 'utf8'));

  const cases: [string, (m: any) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any -- fixtures poke at arbitrary paths
    ['taper without a direction', (m) => { m.computed.limit = { taper: { from: 10, every: 'day' } }; }],
    ['taper with both directions', (m) => { m.computed.limit = { taper: { from: 10, down_by: 1, up_by: 1, every: 'day' } }; }],
    ['prompt hook without yes or pick', (m) => { m.hooks = [{ on: 'day_end', ask: 'Smoked?' }]; }],
    ['unknown range', (m) => { m.computed.today = { count: 'cigarette', range: 'fortnight' }; }],
    ['empty where condition', (m) => { m.computed.today = { count: 'cigarette', where: { brand: {} } }; }],
    ['select setting without options', (m) => { m.settings = [{ key: 'unit', type: 'select', label: 'Unit' }]; }],
    ['text setting with options', (m) => { m.settings = [{ key: 'unit', type: 'text', label: 'Unit', options: ['a'] }]; }],
    ['select field without options', (m) => { m.collections[0].fields.push({ key: 'kind', type: 'select' }); }],
    ['text field with options', (m) => { m.collections[0].fields.push({ key: 'kind', type: 'text', options: ['a'] }); }],
    ['user_editable on a multiselect', (m) => { m.collections[0].fields.push({ key: 'kind', type: 'multiselect', options: ['a'], user_editable: true }); }],
    ['min on a text field', (m) => { m.collections[0].fields.push({ key: 'kind', type: 'text', min: 1 }); }],
  ];
  assert.ok(validate(base()), ajv.errorsText(validate.errors));
  for (const [name, change] of cases) {
    const m = base();
    change(m);
    assert.equal(validatePluginData(m).ok, false, `${name}: zod should reject it`);
    assert.equal(validate(m), false, `${name}: the JSON Schema should reject it`);
  }
});
