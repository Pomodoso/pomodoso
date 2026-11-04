import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createEvaluator, type PluginRecord } from './compute.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';
import { cascadeIds, recordTitle } from './view.ts';

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- fixtures poke at arbitrary paths

const issues = () => {
  const r = parsePluginFile(readFileSync(new URL('./examples/issues.yaml', import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
};
const messages = (m: unknown) => {
  const r = validatePluginData(m);
  return r.ok ? '' : r.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
};
const variant = (change: (m: Mutable) => void) => {
  const m = structuredClone(issues()) as Mutable;
  change(m);
  return messages(m);
};
const board = (m: Mutable) => m.views.find((v: Mutable) => v.id === 'board');

test('$record only works in a record screen', () => {
  assert.match(variant((m) => { m.views[0].blocks.push({ type: 'text', text: '{$record.title}' }); }), /\$record only works in a record's screen/);
  assert.match(variant((m) => { m.computed.mine = { count: 'card', where: { issue: '$record' } }; }), /\$record only works/);
  assert.match(variant((m) => { board(m).blocks.push({ type: 'text', text: '{$record.nope}' }); }), /unknown field in "issue" "nope"/);
  assert.equal(variant((m) => { board(m).blocks.push({ type: 'text', text: 'About {$record.title}' }); }), '');
});

test('record screens and what opens them', () => {
  assert.match(variant((m) => { m.views[0].of = 'issue'; }), /first view is the app's main screen/);
  assert.match(variant((m) => { board(m).of = 'nope'; }), /unknown collection "nope"/);
  assert.match(variant((m) => { m.views[0].blocks[1].opens = 'closed'; }), /"closed" isn't the screen of a "issue" record/);
  assert.match(variant((m) => { m.views[0].blocks[1].opens = 'nowhere'; }), /unknown view "nowhere"/);
});

test('a ref points to an existing item collection', () => {
  const card = (m: Mutable) => m.collections[1].fields.find((f: Mutable) => f.key === 'issue');
  assert.match(variant((m) => { card(m).collection = 'nope'; }), /unknown collection "nope"/);
  assert.match(variant((m) => { delete card(m).collection; }), /a ref field needs the collection/);
  assert.match(variant((m) => { m.collections[0].fields[0].collection = 'card'; }), /only ref fields take a collection/);
});

const at = '2026-03-01T10:00:00Z';
const records: PluginRecord[] = [
  { id: 'i1', collection: 'issue', created_at: at, data: { title: 'Publish the app', state: 'open' } },
  { id: 'i2', collection: 'issue', created_at: at, data: { title: 'Other', state: 'open' } },
  { id: 'c1', collection: 'card', created_at: at, data: { title: 'Screenshots', issue: 'i1', status: 'doing' } },
  { id: 'c2', collection: 'card', created_at: at, data: { title: 'Store listing', issue: 'i1', status: 'todo' } },
  { id: 'c3', collection: 'card', created_at: at, data: { title: 'Elsewhere', issue: 'i2', status: 'todo' } },
];

test('a record screen reads its record', () => {
  const m = issues();
  const ev = createEvaluator(m, { today: '2026-03-01', now: at, timeZone: 'UTC', weekStart: 0, installedOn: '2026-01-01', records });
  const one = ev.forRecord('i1');
  assert.equal(one.value('$record'), 'i1');
  assert.equal(one.template('{$record.title}'), 'Publish the app');
  assert.deepEqual(one.records('card', { issue: '$record' }).map((r) => r.id), ['c1', 'c2']);
  assert.equal(one.value({ count: 'card', where: { issue: '$record', status: 'todo' } }), 1);
  assert.equal(ev.value('$record'), null);
  assert.equal(recordTitle(m, records[0]!), 'Publish the app');
});

test('deleting a record takes what belongs to it', () => {
  assert.deepEqual(cascadeIds(issues(), records, 'i1').sort(), ['c1', 'c2', 'i1']);
  assert.deepEqual(cascadeIds(issues(), records, 'c3'), ['c3']);
});

test('not_in keeps what is none of the values', () => {
  const ev = createEvaluator(issues(), { today: '2026-03-01', now: at, timeZone: 'UTC', weekStart: 0, installedOn: '2026-01-01', records });
  assert.equal(ev.value({ count: 'card', where: { status: { not_in: ['done', 'doing'] } } }), 2);
  assert.equal(ev.forRecord('i1').value({ count: 'card', where: { issue: '$record', status: { not_in: ['todo'] } } }), 1);
});
