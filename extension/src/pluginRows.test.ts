import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PluginExport } from '@pomodoso/types/plugins';

import type { PluginRecordRow, PluginRow } from './db.ts';
import { dailyRecordId } from '@pomodoso/types/plugins/ids';

import { planDuplicateMerge, pluginFromSync, pluginRecordFromSync, pluginRecordSyncData, pluginSyncData, rowsFromExport, toEngineRecord } from './pluginRows.ts';

test('a stored row becomes the engine record shape', () => {
  const row: PluginRecordRow = {
    id: 'r1',
    pluginId: 'p1',
    collection: 'cigarette',
    occurredAt: '2026-10-21T15:00:00Z',
    data: { craving: 3 },
    createdAt: '2026-10-21T15:00:00Z',
    updatedAt: '2026-10-21T15:01:00Z',
  };
  assert.deepEqual(toEngineRecord(row), {
    id: 'r1',
    collection: 'cigarette',
    occurred_at: '2026-10-21T15:00:00Z',
    day: null,
    created_at: '2026-10-21T15:00:00Z',
    updated_at: '2026-10-21T15:01:00Z',
    deleted_at: null,
    data: { craving: 3 },
  });
});

test('imported rows are live, dirty and newest, with their original ids', () => {
  const exp = {
    pomodoso_plugin_export: 1,
    exported_at: '2026-10-20T00:00:00Z',
    plugin: { id: 'p1', manifest: { id: 'year-in-pixels' }, settings: { a: 1 }, installed_on: '2026-10-01' },
    records: [
      { id: 'd1', collection: 'day_state', day: '2026-10-19', created_at: '2026-10-19T22:00:00Z', updated_at: '2026-10-19T22:00:00Z', data: { state: 'great' } },
      { id: 'e1', collection: 'x', occurred_at: '2026-10-19T10:00:00Z', created_at: '2026-10-19T10:00:00Z', data: {} },
    ],
  } as unknown as PluginExport;
  const { plugin, records } = rowsFromExport(exp, '2026-10-21T12:00:00Z');
  assert.equal(plugin.id, 'p1');
  assert.equal(plugin.slug, 'year-in-pixels');
  assert.equal(plugin.installedOn, '2026-10-01');
  assert.equal(plugin.deletedAt, null);
  assert.equal(plugin.syncedAt, undefined);
  assert.deepEqual(records.map((r) => [r.id, r.pluginId, r.updatedAt, r.deletedAt]), [
    ['d1', 'p1', '2026-10-21T12:00:00Z', null],
    ['e1', 'p1', '2026-10-21T12:00:00Z', null],
  ]);
  assert.equal(records[0]!.day, '2026-10-19');
  assert.equal(records[1]!.occurredAt, '2026-10-19T10:00:00Z');
  assert.equal('day' in records[1]!, false);
});

test('plugin rows survive the sync mapping both ways, with server timestamps normalized', () => {
  const plugin: PluginRow = {
    id: 'p1', slug: 'water', source: 'file', manifest: { id: 'water' } as unknown as PluginRow['manifest'],
    settings: { 'today:on': true }, enabled: true, autoUpdate: false, installedOn: '2026-10-01',
    createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-02T12:00:00.000Z',
  };
  const meta = { id: 'p1', updatedAt: plugin.updatedAt, deletedAt: null };
  // The server writes timestamps without milliseconds.
  const fromServer = { ...pluginSyncData(plugin), created_at: '2026-10-01T12:00:00Z' };
  assert.deepEqual(pluginFromSync(meta, fromServer), { ...plugin, syncedAt: plugin.updatedAt });

  const rec: PluginRecordRow = {
    id: 'r1', pluginId: 'p1', collection: 'glass', occurredAt: '2026-10-02T15:00:00.000Z', data: { ml: 250 },
    createdAt: '2026-10-02T15:00:00.000Z', updatedAt: '2026-10-02T15:00:00.000Z',
  };
  const recServer = { ...pluginRecordSyncData(rec), occurred_at: '2026-10-02T15:00:00Z', created_at: '2026-10-02T15:00:00Z' };
  assert.deepEqual(pluginRecordFromSync({ id: 'r1', updatedAt: rec.updatedAt, deletedAt: '2026-10-03T00:00:00.000Z' }, recServer), {
    ...rec, syncedAt: rec.updatedAt, deletedAt: '2026-10-03T00:00:00.000Z',
  });
});

test('two installs of one plugin fold into the earliest, the same way on every device', () => {
  const base = { slug: 'pixels', source: 'file' as const, manifest: {} as PluginRow['manifest'], settings: {}, enabled: true, autoUpdate: false, installedOn: '2026-10-01', updatedAt: '2026-10-05T00:00:00.000Z' };
  const a: PluginRow = { ...base, id: 'aaaa', createdAt: '2026-10-01T09:00:00.000Z' };
  const b: PluginRow = { ...base, id: 'bbbb', createdAt: '2026-10-01T10:00:00.000Z' };
  const rec = (id: string, pluginId: string, extra: Partial<PluginRecordRow>): PluginRecordRow => ({ id, pluginId, collection: 'day_state', data: {}, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', ...extra });
  const dayA = rec(dailyRecordId('aaaa', 'day_state', '2026-10-02'), 'aaaa', { day: '2026-10-02', data: { state: 'old' }, updatedAt: '2026-10-02T08:00:00.000Z' });
  const dayB = rec(dailyRecordId('bbbb', 'day_state', '2026-10-02'), 'bbbb', { day: '2026-10-02', data: { state: 'new' }, updatedAt: '2026-10-02T09:00:00.000Z' });
  const onlyB = rec(dailyRecordId('bbbb', 'day_state', '2026-10-03'), 'bbbb', { day: '2026-10-03', data: { state: 'b' } });
  const event = rec('e1', 'bbbb', { occurredAt: '2026-10-02T15:00:00.000Z' });
  const ts = '2026-10-06T00:00:00.000Z';

  const plan = planDuplicateMerge([b, a], [dayA, dayB, onlyB, event], ts);
  // Same plan whatever order the rows come in.
  assert.deepEqual(planDuplicateMerge([a, b], [event, onlyB, dayB, dayA], ts).plugins, plan.plugins);
  assert.deepEqual(plan.plugins.map((p) => [p.id, p.deletedAt]), [['bbbb', ts]]);
  const byId = new Map(plan.records.map((r) => [r.id, r]));
  // The day both had: the more recent edit wins, under the keeper's id.
  assert.equal(byId.get(dayA.id)?.data.state, 'new');
  assert.equal(byId.get(dayA.id)?.pluginId, 'aaaa');
  assert.equal(byId.get(dayB.id)?.deletedAt, ts);
  // A day only B had moves to the keeper's id for that day.
  assert.equal(byId.get(dailyRecordId('aaaa', 'day_state', '2026-10-03'))?.data.state, 'b');
  // Events keep their id and change plugin.
  assert.equal(byId.get('e1')?.pluginId, 'aaaa');
  // Everything written is dirty, so it pushes.
  assert.ok(plan.records.every((r) => r.syncedAt === undefined && r.updatedAt === ts));
  assert.deepEqual(planDuplicateMerge([a], [dayA], ts), { plugins: [], records: [] });
});
