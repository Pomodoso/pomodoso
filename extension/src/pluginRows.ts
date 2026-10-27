// Pure conversions between the extension's plugin rows (camelCase, Dexie)
// and the shared engine/export shapes (snake_case, as on the server). Split
// from plugins.ts so they run in a plain Node test without IndexedDB.

import type { PluginExport, PluginRecord } from '@pomodoso/types/plugins';

import type { PluginRecordRow, PluginRow } from './db.ts';

export function toEngineRecord(r: PluginRecordRow): PluginRecord {
  return {
    id: r.id,
    collection: r.collection,
    occurred_at: r.occurredAt ?? null,
    day: r.day ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    deleted_at: r.deletedAt ?? null,
    data: r.data,
  };
}

/**
 * Rows to write for an imported export. They must look like fresh local
 * edits — no syncedAt, updatedAt = now, no tombstone — so sync pushes them
 * and LWW lets the restore win (the same rule backup.ts applies).
 */
export function rowsFromExport(exp: PluginExport, ts: string): { plugin: PluginRow; records: PluginRecordRow[] } {
  const plugin: PluginRow = {
    id: exp.plugin.id,
    slug: exp.plugin.manifest.id,
    source: 'file',
    manifest: exp.plugin.manifest,
    settings: exp.plugin.settings,
    enabled: true,
    autoUpdate: false,
    installedOn: exp.plugin.installed_on,
    createdAt: ts,
    updatedAt: ts,
    deletedAt: null,
  };
  const records = exp.records.map((r): PluginRecordRow => ({
    id: r.id,
    pluginId: exp.plugin.id,
    collection: r.collection,
    ...(r.day ? { day: r.day } : {}),
    ...(r.occurred_at ? { occurredAt: r.occurred_at } : {}),
    data: r.data,
    createdAt: r.created_at,
    updatedAt: ts,
    deletedAt: null,
  }));
  return { plugin, records };
}
