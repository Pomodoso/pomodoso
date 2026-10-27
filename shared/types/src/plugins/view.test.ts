import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { PluginManifest } from './manifest.ts';
import { parsePluginFile } from './parse.ts';
import {
  applyRules,
  fieldOptions,
  formatStat,
  humanize,
  initialRecordData,
  missingFields,
  optionsSettingKey,
} from './view.ts';

function example(name: string): PluginManifest {
  const r = parsePluginFile(readFileSync(new URL(`./examples/${name}.yaml`, import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
}

const ctx = { today: '2026-10-21', now: '2026-10-21T15:00:00Z', timeZone: 'UTC', weekStart: 0, installedOn: '2026-10-01' };

test('keys read as sentences', () => {
  assert.equal(humanize('after_meal'), 'After meal');
  assert.equal(humanize('to_read'), 'To read');
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

test('a rule stamps the date when a book becomes read, once', () => {
  const m = example('bookshelf');
  const created = applyRules(m, 'book', undefined, { title: 'Dune', status: 'read' }, ctx);
  assert.equal(created.finished_on, '2026-10-21');

  const reading = { title: 'Dune', status: 'reading' };
  assert.equal(applyRules(m, 'book', undefined, reading, ctx).finished_on, undefined);

  const marked = applyRules(m, 'book', reading, { ...reading, status: 'read' }, ctx);
  assert.equal(marked.finished_on, '2026-10-21');

  // Already read: editing the rating later doesn't move the date.
  const later = { ...ctx, today: '2026-11-02' };
  const edited = applyRules(m, 'book', marked, { ...marked, rating: 5 }, later);
  assert.equal(edited.finished_on, '2026-10-21');
});

test('only_if_empty keeps a date the user set', () => {
  const m = example('bookshelf');
  const out = applyRules(m, 'book', { title: 'Dune', status: 'reading' }, { title: 'Dune', status: 'read', finished_on: '2026-09-30' }, ctx);
  assert.equal(out.finished_on, '2026-09-30');
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
