import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { PluginManifest } from './manifest.ts';
import type { PluginRecord } from './compute.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';
import {
  applyRules,
  fieldOptions,
  formatStat,
  humanize,
  initialRecordData,
  missingFields,
  optionsSettingKey,
  showsOnToday,
  SHOW_ON_TODAY_KEY,
} from './view.ts';

function parsed(data: unknown): PluginManifest {
  const r = validatePluginData(data);
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
}

function example(name: string): PluginManifest {
  const r = parsePluginFile(readFileSync(new URL(`./examples/${name}.yaml`, import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
}

const ctx = { today: '2026-10-21', now: '2026-10-21T15:00:00Z', timeZone: 'UTC', weekStart: 0, installedOn: '2026-10-01' };

test('keys read as sentences', () => {
  assert.equal(humanize('after_meal'), 'After meal');
  assert.equal(humanize('to_read'), 'To read');
  assert.equal(humanize('image_url'), 'Image URL');
});

test('a user_editable select reads the user options from settings, else the file', () => {
  const m = example('year-in-pixels');
  const field = m.collections[0]!.fields.find((f) => f.key === 'state')!;
  assert.deepEqual(fieldOptions('day_state', field, {})[0], { value: 'great', label: 'Great', color: '#2D8A7A' });

  const mine = [{ value: 'calm', label: 'Calm', color: '#000000' }];
  assert.deepEqual(fieldOptions('day_state', field, { [optionsSettingKey('day_state', 'state')]: mine }), mine);
  // A malformed override falls back to the file's options instead of showing nothing.
  assert.equal(fieldOptions('day_state', field, { [optionsSettingKey('day_state', 'state')]: 'oops' }).length, 4);
});

test('options of a plain select ignore settings and get humanized labels', () => {
  const m = example('quit-smoking');
  const trigger = m.collections[0]!.fields.find((f) => f.key === 'trigger')!;
  const opts = fieldOptions('cigarette', trigger, { [optionsSettingKey('cigarette', 'trigger')]: [{ value: 'x', label: 'X' }] });
  assert.deepEqual(opts[2], { value: 'after_meal', label: 'After meal' });
});

test('a new record starts from defaults with set on top, and reports what is missing', () => {
  const book = example('bookshelf').collections[0]!;
  const data = initialRecordData(book, { author: 'Le Guin' });
  assert.deepEqual(data, { status: 'want', author: 'Le Guin' });
  assert.deepEqual(missingFields(book, data).map((f) => f.key), ['title']);
  assert.deepEqual(missingFields(book, { ...data, title: '  ' }).map((f) => f.key), ['title']);
  assert.deepEqual(missingFields(book, { ...data, title: 'Dune' }).map((f) => f.key), []);
});

const book = (id: string, data: Record<string, unknown>, created_at = '2026-10-01T12:00:00Z'): PluginRecord => ({ id, collection: 'book', created_at, data });
const rulesCtx = { ...ctx, records: [] as PluginRecord[] };

test('a rule stamps the date when a book becomes read, once', () => {
  const m = example('bookshelf');
  const created = applyRules(m, undefined, book('a', { title: 'Dune', status: 'read' }), rulesCtx);
  assert.equal(created.finished_on, '2026-10-21');

  const reading = book('a', { title: 'Dune', status: 'reading' });
  assert.equal(applyRules(m, undefined, reading, rulesCtx).finished_on, undefined);

  const marked = book('a', applyRules(m, reading, { ...reading, data: { ...reading.data, status: 'read' } }, rulesCtx));
  assert.equal(marked.data.finished_on, '2026-10-21');

  // Already read: editing the rating later doesn't move the date.
  const later = { ...rulesCtx, today: '2026-11-02' };
  const edited = applyRules(m, marked, { ...marked, data: { ...marked.data, rating: 5 } }, later);
  assert.equal(edited.finished_on, '2026-10-21');
});

test('only_if_empty keeps a date the user set', () => {
  const m = example('bookshelf');
  const out = applyRules(m, book('a', { title: 'Dune', status: 'reading' }), book('a', { title: 'Dune', status: 'read', finished_on: '2026-09-30' }), rulesCtx);
  assert.equal(out.finished_on, '2026-09-30');
});

test('rule references see the other records, and the record keeps its own dates', () => {
  const m = parsed({
    schema_version: 1,
    id: 'queue',
    name: 'Queue',
    version: '1.0.0',
    collections: [
      { key: 'book', kind: 'item', fields: [{ key: 'title', type: 'text' }, { key: 'position', type: 'number', optional: true }] },
      { key: 'mood', kind: 'daily', fields: [{ key: 'state', type: 'text' }, { key: 'today', type: 'boolean', optional: true }] },
    ],
    computed: { book_count: { count: 'book' } },
    rules: [
      { collection: 'book', when: { title: { exists: true } }, set: { position: '$book_count' } },
      { collection: 'mood', when: { day: '$today_date' }, set: { today: true } },
    ],
    views: [{ id: 'main', blocks: [{ type: 'text', text: 'x' }] }],
  });
  const stored = [book('a', { title: 'A' }), book('b', { title: 'B' })];
  assert.equal(applyRules(m, undefined, book('c', { title: 'C' }), { ...rulesCtx, records: stored }).position, 3);

  const yesterday: PluginRecord = { id: 'd', collection: 'mood', day: '2026-10-20', created_at: '2026-10-21T12:00:00Z', data: { state: 'ok' } };
  assert.equal(applyRules(m, undefined, yesterday, rulesCtx).today, undefined);
  assert.equal(applyRules(m, undefined, { ...yesterday, day: '2026-10-21' }, rulesCtx).today, true);
});

test('a required field the record predates counts as filled by its default', () => {
  const c = { key: 'book', kind: 'item' as const, fields: [{ key: 'title', type: 'text' as const }, { key: 'status', type: 'text' as const, default: 'want' }] };
  assert.deepEqual(missingFields(c, { title: 'Dune' }).map((f) => f.key), []);
  assert.deepEqual(missingFields(c, { title: 'Dune', status: '' }).map((f) => f.key), ['status']);
});

test('stats read naturally', () => {
  const now = '2026-10-21T15:00:00Z';
  assert.equal(formatStat(5, 'number', now), '5');
  assert.equal(formatStat(2.25, 'number', now), '2.3');
  assert.equal(formatStat(null, 'number', now), '—');
  assert.equal(formatStat(-0.337, 'percent', now), '-34%');
  assert.equal(formatStat(0.2, 'percent', now), '+20%');
  assert.equal(formatStat(1, 'days', now), '1 day');
  assert.equal(formatStat(8, 'days', now), '8 days');
  assert.equal(formatStat(95, 'duration', now), '1h 35m');
  assert.equal(formatStat('2026-10-21T14:58:30Z', 'time_ago', now), '1m ago');
  assert.equal(formatStat('2026-10-21T12:45:00Z', 'time_ago', now), '2h 15m ago');
  assert.equal(formatStat('2026-10-18T15:00:00Z', 'time_ago', now), '3 days ago');
  assert.equal(formatStat('2026-10-21', 'date', now), 'Oct 21, 2026');
  assert.equal(formatStat(['a', 'b'], 'number', now), 'a, b');
});

test('only_if_empty counts a field default as a value', () => {
  const m = parsed({
    schema_version: 1,
    id: 'tasks',
    name: 'Tasks',
    version: '1.0.0',
    collections: [{ key: 'task', kind: 'item', fields: [{ key: 'title', type: 'text' }, { key: 'urgent', type: 'boolean', optional: true }, { key: 'priority', type: 'number', default: 5 }] }],
    rules: [{ collection: 'task', when: { urgent: true }, set: { priority: 1 }, only_if_empty: true }],
    views: [{ id: 'main', blocks: [{ type: 'text', text: 'x' }] }],
  });
  const old: PluginRecord = { id: 't', collection: 'task', created_at: '2026-10-01T12:00:00Z', data: { title: 'A' } };
  const out = applyRules(m, old, { ...old, data: { title: 'A', urgent: true } }, rulesCtx);
  assert.equal(out.priority, undefined);
});

test('Today shows only when the file has a widget and the user turned it on', () => {
  const pixels = example('year-in-pixels');
  assert.equal(showsOnToday(pixels, {}), false);
  assert.equal(showsOnToday(pixels, { [SHOW_ON_TODAY_KEY]: true }), true);
  const { today: _, ...noToday } = pixels;
  assert.equal(showsOnToday(noToday, { [SHOW_ON_TODAY_KEY]: true }), false);
});
