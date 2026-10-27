import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PLUGIN_FILE_MAX_BYTES } from './catalog.ts';
import type { PluginIssue } from './issues.ts';
import type { PluginManifest } from './manifest.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';
import { z } from './zod.ts';

const EXAMPLES = ['quit-smoking', 'year-in-pixels', 'reading-list', 'bookshelf', 'movieshelf'] as const;

const example = (name: string) => readFileSync(new URL(`./examples/${name}.yaml`, import.meta.url), 'utf8');

function parseExample(name: string): PluginManifest {
  const r = parsePluginFile(example(name));
  if (!r.ok) assert.fail(`${name}:\n${r.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  return r.manifest;
}

/** The smallest valid manifest, for tests that break one thing at a time. */
function base(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'water',
    name: 'Water',
    version: '1.0.0',
    settings: [{ key: 'goal', type: 'number', label: 'Glasses per day', default: 8 }],
    collections: [
      { key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number', optional: true }] },
      { key: 'mood', kind: 'daily', fields: [{ key: 'state', type: 'select', options: ['good', 'bad'] }] },
    ],
    computed: { today: { count: 'glass', range: 'today' } },
    views: [{ id: 'main', blocks: [{ type: 'counter-button', label: 'Drank one', adds: 'glass' }] }],
  };
}

function issuesFor(data: unknown): PluginIssue[] {
  const r = validatePluginData(data);
  assert.equal(r.ok, false, 'expected the manifest to be invalid');
  return r.ok ? [] : r.issues;
}

function blockIssues(block: Record<string, unknown>): PluginIssue[] {
  const m = base();
  m.views = [{ id: 'main', blocks: [block] }];
  return issuesFor(m);
}

function assertIssue(issues: PluginIssue[], path: string, ...fragments: string[]) {
  const found = issues.find((i) => i.path === path);
  assert.ok(found, `no issue at "${path}"; got:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  for (const f of fragments) assert.ok(found.message.includes(f), `"${found.message}" should include "${f}"`);
}

// ─── The five reference plugins ─────────────────────────────────────────────

for (const name of EXAMPLES) {
  test(`example ${name} is valid`, () => {
    const m = parseExample(name);
    assert.equal(m.id, name);
  });
}

test('movieshelf is bookshelf with other fields: same blocks, no special case', () => {
  const types = (m: PluginManifest) => m.views.flatMap((v) => v.blocks.map((b) => b.type));
  assert.deepEqual(types(parseExample('movieshelf')), types(parseExample('bookshelf')));
});

test('the minimal manifest is valid', () => {
  assert.equal(validatePluginData(base()).ok, true);
});

// ─── Typos get a "did you mean" ─────────────────────────────────────────────

test('unknown block type suggests the closest one and lists the rest', () => {
  const issues = blockIssues({ type: 'bord', collection: 'glass' });
  assertIssue(issues, 'views[0].blocks[0].type', 'unknown type "bord"', 'did you mean "board"?', 'counter-button');
});

test('a misspelled key is one issue, not an unknown key plus a missing one', () => {
  const issues = blockIssues({ type: 'form', colection: 'glass' });
  assertIssue(issues, 'views[0].blocks[0].colection', 'did you mean "collection"?');
  assert.equal(issues.length, 1);
});

test('invalid enum values list the options', () => {
  const issues = blockIssues({ type: 'chart', kind: 'pie', series: { count: 'glass', group: 'day' } });
  assertIssue(issues, 'views[0].blocks[0].kind', '"pie"', 'bar, line');
});

test('a computed value with a misspelled operator suggests the operator', () => {
  const m = base();
  m.computed = { today: { cuont: 'glass' } };
  assertIssue(issuesFor(m), 'computed.today', 'did you mean "count"?');
});

test('a bad key inside a known operator is reported on that operator only', () => {
  const m = base();
  m.computed = { today: { count: 'glass', rnage: 'today' } };
  const issues = issuesFor(m);
  assertIssue(issues, 'computed.today.rnage', 'unknown key "rnage"');
  assert.equal(issues.length, 1);
});

test('a bare word where a value goes points out that references start with $', () => {
  const issues = blockIssues({ type: 'stat', label: 'Today', value: 'today' });
  assertIssue(issues, 'views[0].blocks[0].value', 'references start with $');
});

// ─── Cross-references ───────────────────────────────────────────────────────

test('unknown collection suggests the closest one', () => {
  const issues = blockIssues({ type: 'counter-button', label: 'One', adds: 'glas' });
  assertIssue(issues, 'views[0].blocks[0].adds', 'unknown collection "glas"', 'did you mean "glass"?');
});

test('unknown reference suggests the closest one', () => {
  const issues = blockIssues({ type: 'stat', label: 'Today', value: '$tody' });
  assertIssue(issues, 'views[0].blocks[0].value', 'unknown reference "$tody"', 'did you mean "$today"?');
});

test('references inside text templates are checked', () => {
  const issues = blockIssues({ type: 'text', text: 'You drank {$todya} glasses' });
  assertIssue(issues, 'views[0].blocks[0].text', '"$todya"');
});

test('$tab is only available in an add-button prefill', () => {
  const issues = blockIssues({ type: 'stat', label: 'Tab', value: '$tab.url' });
  assertIssue(issues, 'views[0].blocks[0].value', 'only available in an add-button');
});

test('a block on the wrong kind of collection says which kind it needs', () => {
  const issues = blockIssues({ type: 'day-picker', collection: 'glass', field: 'ml' });
  assertIssue(issues, 'views[0].blocks[0].collection', 'needs a daily collection', '"glass" is event');
  assertIssue(issues, 'views[0].blocks[0].field', 'needs a select field', '"ml" is number');
});

test('a one-tap add must be able to fill every required field', () => {
  const m = base();
  m.collections = [{ key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number' }] }];
  assertIssue(issuesFor(m), 'views[0].blocks[0]', '"ml" is required');
});

test('the same add is fine when it opens a form', () => {
  const m = base();
  m.collections = [{ key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number' }] }];
  m.views = [{ id: 'main', blocks: [{ type: 'counter-button', label: 'One', adds: 'glass', details: 'form' }] }];
  assert.equal(validatePluginData(m).ok, true);
});

test('chart series need a group', () => {
  const issues = blockIssues({ type: 'chart', kind: 'bar', series: { count: 'glass' } });
  assertIssue(issues, 'views[0].blocks[0].series', '"group"');
});

test('computed values cannot reference each other in a circle', () => {
  const m = base();
  m.computed = { a: { delta: ['$b', 1] }, b: { delta: ['$a', 1] } };
  assertIssue(issuesFor(m), 'computed.a', 'circular reference');
});

test('a select default must be one of its options', () => {
  const m = base();
  m.collections = [{ key: 'glass', kind: 'event', fields: [{ key: 'size', type: 'select', options: ['s', 'l'], default: 'm' }] }];
  assertIssue(issuesFor(m), 'collections[0].fields[0].default', 'unknown option "m"');
});

test('a prompt hook takes yes or pick, not both', () => {
  const m = base();
  m.hooks = [{ on: 'pomodoro_end', ask: 'Water?', yes: { add: 'glass' }, pick: { collection: 'mood', field: 'state' } }];
  assertIssue(issuesFor(m), 'hooks[0]', 'exactly one of yes or pick');
});

// ─── YAML ───────────────────────────────────────────────────────────────────

test('YAML syntax errors carry the line', () => {
  const r = parsePluginFile('schema_version: 1\nid: x\nname: [unclosed\n');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.issues[0]!.message.startsWith('YAML:'));
    assert.equal(typeof r.issues[0]!.line, 'number');
  }
});

test('duplicate keys are an error, not last-one-wins', () => {
  const r = parsePluginFile(example('quit-smoking').replace('name: Quit smoking', 'name: Quit smoking\nname: Again'));
  assert.equal(r.ok, false);
});

test('custom YAML tags are rejected: a plugin is plain data', () => {
  const r = parsePluginFile(example('quit-smoking').replace('name: Quit smoking', 'name: !!js/function "function () {}"'));
  assert.equal(r.ok, false);
});

test('files over the size limit are rejected before parsing', () => {
  const r = parsePluginFile(`# ${'x'.repeat(PLUGIN_FILE_MAX_BYTES)}\n`);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.issues[0]!.message, /limit/);
});

// ─── Chrome Web Store ───────────────────────────────────────────────────────

test('zod never compiles validators with new Function', () => {
  assert.equal(z.config().jitless, true);
});
