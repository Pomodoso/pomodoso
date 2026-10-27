import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PluginExport } from '@pomodoso/types/plugins';

import type { PluginRecordRow } from './db.ts';
import { rowsFromExport, toEngineRecord } from './pluginRows.ts';

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
