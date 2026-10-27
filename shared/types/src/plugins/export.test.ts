import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { PluginRecord } from './compute.ts';
import { parsePluginExport, serializePluginExport } from './export.ts';
import { dailyRecordId } from './ids.ts';
import { parsePluginFile } from './parse.ts';

const manifest = (() => {
  const r = parsePluginFile(readFileSync(new URL('./examples/year-in-pixels.yaml', import.meta.url), 'utf8'));
  if (!r.ok) assert.fail(JSON.stringify(r.issues));
  return r.manifest;
})();

const records: PluginRecord[] = [
  { id: dailyRecordId('p1', 'day_state', '2026-10-20'), collection: 'day_state', day: '2026-10-20', created_at: '2026-10-20T22:00:00Z', updated_at: '2026-10-20T22:00:00Z', data: { state: 'great' } },
  { id: dailyRecordId('p1', 'day_state', '2026-10-21'), collection: 'day_state', day: '2026-10-21', created_at: '2026-10-21T22:00:00Z', data: { state: 'normal', note: 'long: day' } },
  { id: dailyRecordId('p1', 'day_state', '2026-10-19'), collection: 'day_state', day: '2026-10-19', created_at: '2026-10-19T22:00:00Z', deleted_at: '2026-10-20T00:00:00Z', data: { state: 'great' } },
];

test('an export round-trips, without deleted records', () => {
  const text = serializePluginExport({
    exported_at: '2026-10-21T23:00:00Z',
    plugin: { id: 'p1', manifest, settings: { state_options: ['great', 'normal'] }, installed_on: '2026-10-01' },
    records,
  });
  assert.match(text, /^pomodoso_plugin_export: 1/);
  const r = parsePluginExport(text);
  assert.ok(r.ok, r.ok ? '' : JSON.stringify(r.issues));
  assert.deepEqual(r.value.plugin.manifest, manifest);
  assert.deepEqual(r.value.plugin.settings, { state_options: ['great', 'normal'] });
  assert.deepEqual(r.value.records.map((x) => x.id), [records[0]!.id, records[1]!.id]);
  assert.equal(r.value.records[1]!.data.note, 'long: day');
});

test('a broken manifest inside an export is reported under plugin.manifest', () => {
  const text = serializePluginExport({
    exported_at: '2026-10-21T23:00:00Z',
    plugin: { id: 'p1', manifest: { ...manifest, views: [{ id: 'main', blocks: [{ type: 'bord' }] }] } as never, settings: {}, installed_on: '2026-10-01' },
    records: [],
  });
  const r = parsePluginExport(text);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.path === 'plugin.manifest.views[0].blocks[0].type'));
});

test('records must belong to a collection of the plugin, and daily ones need a day', () => {
  const text = serializePluginExport({
    exported_at: '2026-10-21T23:00:00Z',
    plugin: { id: 'p1', manifest, settings: {}, installed_on: '2026-10-01' },
    records: [
      { id: 'x', collection: 'mood', created_at: '2026-10-21T00:00:00Z', data: {} },
      { id: 'y', collection: 'day_state', created_at: '2026-10-21T00:00:00Z', data: {} },
    ],
  });
  const r = parsePluginExport(text);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.ok(r.issues.some((i) => i.path === 'records[0].collection'));
    assert.ok(r.issues.some((i) => i.path === 'records[1].day'));
  }
});

test('a file that is not a plugin export says so', () => {
  const r = parsePluginExport('schema_version: 1\nid: x\n');
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.issues.some((i) => i.path === 'pomodoso_plugin_export'));
});

const exportWith = (recs: PluginRecord[]) =>
  parsePluginExport(
    serializePluginExport({ exported_at: '2026-10-21T23:00:00Z', plugin: { id: 'p1', manifest, settings: {}, installed_on: '2026-10-01' }, records: recs }),
  );

const issuePaths = (r: ReturnType<typeof parsePluginExport>) => (r.ok ? [] : r.issues.map((i) => i.path));

test('repeated record ids and edited daily ids are rejected', () => {
  assert.deepEqual(issuePaths(exportWith([records[0]!, records[0]!])), ['records[1].id']);
  const edited = { ...records[0]!, id: 'my-own-id' };
  assert.deepEqual(issuePaths(exportWith([edited])), ['records[0].id']);
  // Same day twice: the second can only carry the same derived id.
  assert.deepEqual(issuePaths(exportWith([records[0]!, { ...records[0]!, data: { state: 'bad' } }])), ['records[1].id']);
});

test('impossible days and timestamps are rejected', () => {
  const bad = (patch: Partial<PluginRecord>) => issuePaths(exportWith([{ ...records[1]!, ...patch }]));
  assert.deepEqual(bad({ day: '2026-99-99' }), ['records[0].day']);
  assert.deepEqual(bad({ day: '2026-02-30' }), ['records[0].day']);
  assert.deepEqual(bad({ created_at: 'not-a-date-at-all' }), ['records[0].created_at']);
  assert.deepEqual(bad({ updated_at: '2026-10-21T99:00:00Z' }), ['records[0].updated_at']);
});
