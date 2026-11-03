import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { createEvaluator, type EvalContext, type PluginRecord, type SeriesPoint } from './compute.ts';
import { resolveRange } from './dates.ts';
import type { PluginManifest } from './manifest.ts';
import { parsePluginFile, validatePluginData } from './parse.ts';

// Wednesday 2026-10-21 in Buenos Aires (UTC-3), weeks start on Monday, the
// plugin was installed two weeks ago on Monday 2026-10-05.
const CTX: Omit<EvalContext, 'records'> = {
  today: '2026-10-21',
  now: '2026-10-21T18:00:00Z',
  timeZone: 'America/Argentina/Buenos_Aires',
  weekStart: 0,
  installedOn: '2026-10-05',
};

function load(name: string): PluginManifest {
  const r = parsePluginFile(readFileSync(new URL(`./examples/${name}.yaml`, import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
}

function manifest(data: Record<string, unknown>): PluginManifest {
  const r = validatePluginData({ schema_version: 1, id: 'test', name: 'Test', version: '1.0.0', views: [{ id: 'main', blocks: [{ type: 'text', text: 'x' }] }], ...data });
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
}

let seq = 0;
function rec(collection: string, fields: Partial<PluginRecord> & { data?: Record<string, unknown> }): PluginRecord {
  seq++;
  return { id: `r${seq}`, collection, created_at: '2026-10-01T12:00:00Z', data: {}, ...fields };
}

/** `n` events on a local day, at 12:00 local (15:00Z). */
function events(collection: string, day: string, n: number, data: Record<string, unknown> = {}): PluginRecord[] {
  return Array.from({ length: n }, (_, i) => rec(collection, { occurred_at: `${day}T15:${String(i).padStart(2, '0')}:00Z`, data }));
}

// ─── Quit smoking ───────────────────────────────────────────────────────────

const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
};

const smoking = [
  // Week 1 (limit 15): 14 a day.
  ...days('2026-10-05', '2026-10-11').flatMap((d) => events('cigarette', d, 14)),
  // Week 2 (limit 14): over on the 13th, then 12 a day.
  ...events('cigarette', '2026-10-12', 14),
  ...events('cigarette', '2026-10-13', 15),
  ...days('2026-10-14', '2026-10-18').flatMap((d) => events('cigarette', d, 12)),
  // Week 3 (limit 13).
  ...events('cigarette', '2026-10-19', 12),
  ...events('cigarette', '2026-10-20', 13),
  ...events('cigarette', '2026-10-21', 5),
];

test('quit smoking: today, the tapering limit and the week comparison', () => {
  const ev = createEvaluator(load('quit-smoking'), { ...CTX, records: smoking });
  assert.equal(ev.computed('today'), 5);
  assert.equal(ev.computed('limit'), 13); // 15, two Mondays down by 1
  assert.equal(ev.computed('week'), 12 + 13 + 5);
  assert.equal(ev.computed('last_week'), 14 + 15 + 12 * 5);
  assert.equal(ev.computed('week_change'), (30 - 89) / 89);
  assert.equal(ev.computed('last'), '2026-10-21T15:04:00Z');
});

test('quit smoking: days under the limit check each day against that week\'s limit', () => {
  const ev = createEvaluator(load('quit-smoking'), { ...CTX, records: smoking });
  // 21, 20 (13 ≤ 13), 19, then 18…14 under 14; the 13th went over 14.
  assert.equal(ev.computed('under_limit'), 8);
});

test('quit smoking: the 14-day chart has one bar per day, zeros included', () => {
  const m = load('quit-smoking');
  const chart = m.views[0]!.blocks.find((b) => b.type === 'chart');
  assert.ok(chart && chart.type === 'chart');
  const series = createEvaluator(m, { ...CTX, records: smoking }).value(chart.series) as SeriesPoint[];
  assert.equal(series.length, 14);
  assert.deepEqual(series[0], { start: '2026-10-08', value: 14 });
  assert.deepEqual(series[13], { start: '2026-10-21', value: 5 });
});

test('quit smoking: the weekly report line fills its references', () => {
  const m = load('quit-smoking');
  const hook = m.hooks!.find((h) => h.on === 'weekly_report');
  assert.ok(hook && 'line' in hook);
  const line = createEvaluator(m, { ...CTX, records: smoking }).template(hook.line, (v, name) =>
    name === 'week_change' ? `${Math.round((v as number) * 100)}%` : String(v),
  );
  assert.equal(line, 'Cigarettes: 30 this week (-66% vs last week)');
});

test('the user\'s own settings override the defaults', () => {
  const ev = createEvaluator(load('quit-smoking'), { ...CTX, settings: { start_limit: 20, weekly_reduction: 2 }, records: [] });
  assert.equal(ev.computed('limit'), 16);
});

// ─── Year in Pixels ─────────────────────────────────────────────────────────

test('year in pixels: days logged this year', () => {
  const records = [
    rec('day_state', { day: '2025-12-31', data: { state: 'great' } }),
    rec('day_state', { day: '2026-01-01', data: { state: 'normal' } }),
    rec('day_state', { day: '2026-06-15', data: { state: 'great' } }),
    rec('day_state', { day: '2026-10-21', data: { state: 'productive' } }),
  ];
  assert.equal(createEvaluator(load('year-in-pixels'), { ...CTX, records }).computed('logged_this_year'), 3);
});

// ─── Reading list ───────────────────────────────────────────────────────────

test('reading list: records from before a field existed read its default; deleted ones are gone', () => {
  const records = [
    rec('link', { data: { url: 'https://a', title: 'A', status: 'to_read' } }),
    rec('link', { data: { url: 'https://b', title: 'B', status: 'done' } }),
    rec('link', { data: { url: 'https://c', title: 'C' } }), // status missing → default to_read
    rec('link', { data: { url: 'https://d', title: 'D', status: 'to_read' }, deleted_at: '2026-10-20T00:00:00Z' }),
  ];
  assert.equal(createEvaluator(load('reading-list'), { ...CTX, records }).computed('to_read'), 2);
});

// ─── Bookshelf ──────────────────────────────────────────────────────────────

const books = [
  rec('book', { data: { title: 'A', status: 'read', finished_on: '2026-03-10' } }),
  rec('book', { data: { title: 'B', status: 'read', finished_on: '2026-10-02' } }),
  rec('book', { data: { title: 'C', status: 'read', finished_on: '2025-12-20' } }),
  rec('book', { data: { title: 'D', status: 'reading' } }),
];

test('bookshelf: read this year counts by finished_on, not by when it was added', () => {
  assert.equal(createEvaluator(load('bookshelf'), { ...CTX, records: books }).computed('read_this_year'), 2);
});

test('bookshelf: books per month covers the last 12 calendar months', () => {
  const m = load('bookshelf');
  const chart = m.views[1]!.blocks.find((b) => b.type === 'chart');
  assert.ok(chart && chart.type === 'chart');
  const series = createEvaluator(m, { ...CTX, records: books }).value(chart.series) as SeriesPoint[];
  assert.equal(series.length, 12);
  assert.equal(series[0]!.start, '2025-11-01');
  assert.deepEqual(series.find((p) => p.start === '2025-12-01'), { start: '2025-12-01', value: 1 });
  assert.deepEqual(series.find((p) => p.start === '2026-03-01'), { start: '2026-03-01', value: 1 });
  assert.deepEqual(series.at(-1), { start: '2026-10-01', value: 1 });
});

// ─── Days and timezones ─────────────────────────────────────────────────────

test('an event counts on the local day it happened, not the UTC day', () => {
  const m = manifest({ collections: [{ key: 'e', kind: 'event', fields: [{ key: 'n', type: 'text', optional: true }] }], computed: { today: { count: 'e', range: 'today' }, yesterday: { count: 'e', range: 'yesterday' } } });
  const records = [rec('e', { occurred_at: '2026-10-21T02:30:00Z' })]; // 23:30 on the 20th in Buenos Aires
  const ev = createEvaluator(m, { ...CTX, records });
  assert.equal(ev.computed('today'), 0);
  assert.equal(ev.computed('yesterday'), 1);
});

test('ranges', () => {
  const r = (range: string, weekStart = 0) => resolveRange(range, '2026-10-21', weekStart);
  assert.deepEqual(r('this_week'), { start: '2026-10-19', end: '2026-10-21' });
  assert.deepEqual(r('this_week', 6), { start: '2026-10-18', end: '2026-10-21' }); // weeks start on Sunday
  assert.deepEqual(r('last_week'), { start: '2026-10-12', end: '2026-10-18' });
  assert.deepEqual(r('this_month'), { start: '2026-10-01', end: '2026-10-21' });
  assert.deepEqual(r('last_month'), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(r('this_year'), { start: '2026-01-01', end: '2026-10-21' });
  assert.deepEqual(r('7d'), { start: '2026-10-15', end: '2026-10-21' });
  assert.deepEqual(r('3mo'), { start: '2026-08-01', end: '2026-10-21' });
  assert.deepEqual(r('all'), { end: '2026-10-21' });
});

// ─── Operators ──────────────────────────────────────────────────────────────

const glassPlugin = () =>
  manifest({
    settings: [{ key: 'goal', type: 'number', label: 'Goal', default: 3 }],
    collections: [
      {
        key: 'glass',
        kind: 'event',
        fields: [
          { key: 'ml', type: 'number', optional: true },
          { key: 'tags', type: 'tags', optional: true },
        ],
      },
    ],
    computed: {
      streak: { streak: 'glass', at_least: '$goal' },
      sum_today: { sum: 'glass', field: 'ml', range: 'today' },
      avg_today: { avg: 'glass', field: 'ml', range: 'today' },
      max_ever: { max: 'glass', field: 'ml' },
      last_ml: { last: 'glass', field: 'ml' },
      cold: { count: 'glass', where: { tags: 'cold' } },
      big: { count: 'glass', where: { ml: { gte: 400 } } },
      tagged: { count: 'glass', where: { tags: { exists: true } } },
      either: { count: 'glass', where: { tags: { in: ['cold', 'sparkling'] } } },
      vs_zero: { delta: ['$sum_today', 0] },
    },
  });

test('streak with a minimum: today still short does not break the run', () => {
  const records = [...events('glass', '2026-10-19', 3), ...events('glass', '2026-10-20', 4), ...events('glass', '2026-10-21', 1)];
  assert.equal(createEvaluator(glassPlugin(), { ...CTX, records }).computed('streak'), 2);
  const done = [...records, ...events('glass', '2026-10-21', 2)];
  assert.equal(createEvaluator(glassPlugin(), { ...CTX, records: done }).computed('streak'), 3);
});

test('streak with a maximum: going over today breaks it right away', () => {
  const m = load('quit-smoking');
  const records = [...events('cigarette', '2026-10-20', 2), ...events('cigarette', '2026-10-21', 14)];
  assert.equal(createEvaluator(m, { ...CTX, records }).computed('under_limit'), 0);
});

test('streak never counts days before the plugin was installed', () => {
  const m = load('quit-smoking');
  // No records at all: every day since install is under the limit.
  assert.equal(createEvaluator(m, { ...CTX, records: [] }).computed('under_limit'), 17);
});

test('sum, avg, max, last and where conditions', () => {
  const records = [
    ...events('glass', '2026-10-21', 1, { ml: 250, tags: ['cold'] }),
    ...events('glass', '2026-10-21', 1, { ml: 500, tags: ['sparkling'] }),
    ...events('glass', '2026-10-20', 1, { ml: 600 }),
  ];
  const ev = createEvaluator(glassPlugin(), { ...CTX, records });
  assert.equal(ev.computed('sum_today'), 750);
  assert.equal(ev.computed('avg_today'), 375);
  assert.equal(ev.computed('max_ever'), 600);
  assert.equal(ev.computed('last_ml'), 500);
  assert.equal(ev.computed('cold'), 1);
  assert.equal(ev.computed('big'), 2);
  assert.equal(ev.computed('tagged'), 2);
  assert.equal(ev.computed('either'), 2);
});

test('empty inputs: sum is 0, avg/max/last are null, delta against 0 is null', () => {
  const ev = createEvaluator(glassPlugin(), { ...CTX, records: [] });
  assert.equal(ev.computed('sum_today'), 0);
  assert.equal(ev.computed('avg_today'), null);
  assert.equal(ev.computed('max_ever'), null);
  assert.equal(ev.computed('last_ml'), null);
  assert.equal(ev.computed('vs_zero'), null);
});

test('taper clamps at its minimum and can go up', () => {
  const m = manifest({
    collections: [{ key: 'e', kind: 'event', fields: [{ key: 'n', type: 'text', optional: true }] }],
    computed: {
      down: { taper: { from: 3, down_by: 1, every: 'week', min: 0 } },
      up: { taper: { from: 10, up_by: 5, every: 'day', max: 50 } },
      monthly: { taper: { from: 100, down_by: 10, every: 'month' } },
    },
  });
  const ev = createEvaluator(m, { ...CTX, installedOn: '2026-08-03', records: [] });
  assert.equal(ev.computed('down'), 0); // 11 weeks later, clamped
  assert.equal(ev.computed('up'), 50); // 79 days later, clamped
  assert.equal(ev.computed('monthly'), 80); // August → October
});

test('$tab and $today_date resolve from the context', () => {
  const ev = createEvaluator(load('reading-list'), { ...CTX, tab: { url: 'https://x.dev', title: 'X' }, records: [] });
  assert.equal(ev.value('$tab.url'), 'https://x.dev');
  assert.equal(ev.value('$today_date'), '2026-10-21');
});

test('a chart over a past range stops at the end of that range', () => {
  const m = manifest({
    collections: [{ key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number', optional: true }] }],
    computed: {
      yesterday: { count: 'glass', range: 'yesterday', group: 'day' },
      last_week: { count: 'glass', range: 'last_week', group: 'day' },
    },
  });
  const ev = createEvaluator(m, { ...CTX, records: events('glass', '2026-10-20', 2) });
  assert.deepEqual(ev.computed('yesterday'), [{ start: '2026-10-20', value: 2 }]);
  const week = ev.computed('last_week') as SeriesPoint[];
  assert.deepEqual([week[0]!.start, week.at(-1)!.start, week.length], ['2026-10-12', '2026-10-18', 7]);
});

test('ranging by a date field reads its default on records written before it existed', () => {
  const m = manifest({
    collections: [{ key: 'book', kind: 'item', fields: [{ key: 'finished_on', type: 'date', default: '2026-10-02' }] }],
    computed: { this_month: { count: 'book', range: 'this_month', by: 'finished_on' } },
  });
  const ev = createEvaluator(m, { ...CTX, records: [rec('book', {}), rec('book', { data: { finished_on: '2025-01-01' } })] });
  assert.equal(ev.computed('this_month'), 1);
});

test('last and first compare instants, not timestamp text', () => {
  const m = manifest({
    collections: [{ key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number', optional: true }] }],
    computed: { last_ml: { last: 'glass', field: 'ml' }, first_ml: { first: 'glass', field: 'ml' } },
  });
  const records = [
    rec('glass', { occurred_at: '2026-10-21T10:00:00-03:00', data: { ml: 1 } }), // 13:00Z
    rec('glass', { occurred_at: '2026-10-21T12:00:00Z', data: { ml: 2 } }),
  ];
  const ev = createEvaluator(m, { ...CTX, records });
  assert.equal(ev.computed('last_ml'), 1);
  assert.equal(ev.computed('first_ml'), 2);
});

test('min and max handle histories longer than the argument limit', () => {
  const m = manifest({
    collections: [{ key: 'glass', kind: 'event', fields: [{ key: 'ml', type: 'number', optional: true }] }],
    computed: { most: { max: 'glass', field: 'ml' }, least: { min: 'glass', field: 'ml' } },
  });
  const records = Array.from({ length: 200_000 }, (_, i) => rec('glass', { occurred_at: '2026-10-01T12:00:00Z', data: { ml: i } }));
  const ev = createEvaluator(m, { ...CTX, records });
  assert.equal(ev.computed('most'), 199_999);
  assert.equal(ev.computed('least'), 0);
});

test('an item may declare a field named day: it is read from the data, not the built-in', () => {
  const m = manifest({
    collections: [{ key: 'trip', kind: 'item', fields: [{ key: 'day', type: 'date' }] }],
    computed: { this_month: { count: 'trip', range: 'this_month', by: 'day' }, on_day: { count: 'trip', where: { day: '2026-10-03' } } },
  });
  const ev = createEvaluator(m, { ...CTX, records: [rec('trip', { data: { day: '2026-10-03' } }), rec('trip', { data: { day: '2025-01-01' } })] });
  assert.equal(ev.computed('this_month'), 1);
  assert.equal(ev.computed('on_day'), 1);
});
