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
