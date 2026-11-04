import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { APPS_VERSION, BASE_APPS_VERSION, compareAppsVersions, requiredAppsVersion } from './apps-version.ts';
import { GUIDE_BLOCK_EXAMPLES, GUIDE_COMPUTED_EXAMPLES, GUIDE_HOOK_EXAMPLES, GUIDE_WIDGET_EXAMPLES, guideManifestData } from './guide.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';
import type { PluginManifest } from './manifest.ts';

const frozenDir = new URL('../../schema/apps/', import.meta.url);
const frozen = readdirSync(frozenDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort(compareAppsVersions);

const examples: [string, PluginManifest][] = readdirSync(new URL('./examples/', import.meta.url))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => {
    const r = parsePluginFile(readFileSync(new URL(`./examples/${f}`, import.meta.url), 'utf8'));
    if (!r.ok) assert.fail(f);
    return [f, r.manifest];
  });

const guide: [string, PluginManifest][] = [
  ...Object.entries(GUIDE_BLOCK_EXAMPLES).map(([k, y]) => [`block ${k}`, { blocks: y }] as const),
  ...Object.entries(GUIDE_WIDGET_EXAMPLES).map(([k, y]) => [`widget ${k}`, { today: y }] as const),
  ...Object.entries(GUIDE_HOOK_EXAMPLES).map(([k, y]) => [`hook ${k}`, { hooks: y }] as const),
  ...Object.entries(GUIDE_COMPUTED_EXAMPLES).map(([k, y]) => [`computed ${k}`, { computed: y }] as const),
].map(([name, part]) => {
  const r = validatePluginData(guideManifestData(part));
  if (!r.ok) assert.fail(name);
  return [name, r.manifest];
});

test('every frozen schema is an older APPS_VERSION, and the base one is frozen', () => {
  assert.ok(frozen.includes(BASE_APPS_VERSION));
  for (const v of frozen) assert.ok(compareAppsVersions(v, APPS_VERSION) < 0, `${v} must be before ${APPS_VERSION}`);
});

test('the backend embeds the same frozen schemas', () => {
  for (const v of frozen) {
    const ours = readFileSync(new URL(`${v}.json`, frozenDir), 'utf8');
    assert.equal(readFileSync(new URL(`../../../../backend/schema/apps/${v}.json`, import.meta.url), 'utf8'), ours, v);
  }
});

test('a file an older schema rejects needs a later APPS_VERSION (what the server computes agrees)', async () => {
  const { Ajv2020 } = await import('ajv/dist/2020.js');
  const validators = frozen.map((v) => {
    const ajv = new Ajv2020({ strict: false });
    return [v, ajv.compile(JSON.parse(readFileSync(new URL(`${v}.json`, frozenDir), 'utf8')))] as const;
  });
  for (const [name, m] of [...examples, ...guide]) {
    const need = requiredAppsVersion(m);
    assert.ok(compareAppsVersions(need, APPS_VERSION) <= 0, `${name} needs ${need}, after APPS_VERSION`);
    for (const [v, validate] of validators) {
      if (!validate(JSON.parse(JSON.stringify(m)))) assert.ok(compareAppsVersions(need, v) > 0, `${name}: ${v}'s schema rejects it, but it says it needs ${need}`);
    }
  }
});

test('what each app needs', () => {
  const need = Object.fromEntries(examples.map(([f, m]) => [f.replace('.yaml', ''), requiredAppsVersion(m)]));
  assert.equal(need['year-progress'], '0.2'); // calendar, progress widget, no collections
  assert.equal(need['bookshelf'], '0.2'); // $tab.image: a string the old schema accepts
  // The playground with nothing new is a 0.1 app.
  const plain = validatePluginData(guideManifestData({ blocks: GUIDE_BLOCK_EXAMPLES.list }));
  assert.ok(plain.ok);
  assert.equal(requiredAppsVersion(plain.manifest), '0.1');
});

test('versions compare as numbers', () => {
  assert.ok(compareAppsVersions('0.10', '0.9') > 0);
  assert.equal(compareAppsVersions('0.2', '0.2'), 0);
  assert.ok(compareAppsVersions('1.0', '0.9') > 0);
});

test('the backend knows the same APPS_VERSION', () => {
  const rust = readFileSync(new URL('../../../../backend/src/routes/plugin_directory.rs', import.meta.url), 'utf8');
  assert.match(rust, new RegExp(`pub const APPS_VERSION: &str = "${APPS_VERSION.replace('.', '\\.')}";`));
  assert.match(rust, new RegExp(`pub const BASE_APPS_VERSION: &str = "${BASE_APPS_VERSION.replace('.', '\\.')}";`));
});
