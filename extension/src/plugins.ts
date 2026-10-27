// Plugin storage in the extension: install, records, uninstall, and
// export/import of a single plugin. Validation and every computation live in
// @pomodoso/types/plugins; this module only reads and writes Dexie.
//
// Writes follow the rest of the database: client UUIDs, updatedAt stamped on
// every change, syncedAt cleared so sync picks it up, soft delete only.

import {
  createEvaluator,
  dailyRecordId,
  parsePluginExport,
  parsePluginFile,
  serializePluginExport,
  type PluginEvaluator,
  type PluginIssue,
} from '@pomodoso/types/plugins';

import { db, localDate, now, type PluginRecordRow, type PluginRow } from './db';
import { rowsFromExport, toEngineRecord } from './pluginRows';

export type PluginWriteResult = { ok: true; plugin: PluginRow } | { ok: false; issues: PluginIssue[] };

const live = <T extends { deletedAt?: string | null }>(r: T) => !r.deletedAt;

export async function listPlugins(): Promise<PluginRow[]> {
  return (await db.plugins.toArray()).filter(live);
}

export async function pluginRecords(pluginId: string): Promise<PluginRecordRow[]> {
  return (await db.pluginRecords.where('pluginId').equals(pluginId).toArray()).filter(live);
}

async function liveBySlug(slug: string): Promise<PluginRow | undefined> {
  return (await db.plugins.where('slug').equals(slug).toArray()).find(live);
}

// ─── Install / uninstall ─────────────────────────────────────────────────────

export async function installPlugin(text: string, timezone: string, source: PluginRow['source'] = 'file'): Promise<PluginWriteResult> {
  const parsed = parsePluginFile(text);
  if (!parsed.ok) return parsed;
  const existing = await liveBySlug(parsed.manifest.id);
  if (existing) {
    return { ok: false, issues: [{ path: 'id', message: `"${existing.manifest.name}" is already installed (${existing.manifest.version})` }] };
  }
  const ts = now();
  const plugin: PluginRow = {
    id: crypto.randomUUID(),
    slug: parsed.manifest.id,
    source,
    manifest: parsed.manifest,
    settings: {},
    enabled: true,
    autoUpdate: false,
    installedOn: localDate(timezone),
    createdAt: ts,
    updatedAt: ts,
  };
  await db.plugins.add(plugin);
  return { ok: true, plugin };
}

/** Soft-deletes the plugin and every record, in one transaction. */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  const ts = now();
  await db.transaction('rw', db.plugins, db.pluginRecords, async () => {
    await db.plugins.update(pluginId, { deletedAt: ts, updatedAt: ts, syncedAt: undefined });
    await db.pluginRecords
      .where('pluginId')
      .equals(pluginId)
      .modify((r) => {
        if (r.deletedAt) return;
        r.deletedAt = ts;
        r.updatedAt = ts;
        r.syncedAt = undefined;
      });
  });
}

export async function updatePluginSettings(pluginId: string, settings: Record<string, unknown>): Promise<void> {
  await db.plugins.update(pluginId, { settings, updatedAt: now(), syncedAt: undefined });
}

// ─── Records ─────────────────────────────────────────────────────────────────

export async function addEvent(pluginId: string, collection: string, data: Record<string, unknown> = {}): Promise<PluginRecordRow> {
  const ts = now();
  const row: PluginRecordRow = { id: crypto.randomUUID(), pluginId, collection, occurredAt: ts, data, createdAt: ts, updatedAt: ts };
  await db.pluginRecords.add(row);
  return row;
}

export async function addItem(pluginId: string, collection: string, data: Record<string, unknown>): Promise<PluginRecordRow> {
  const ts = now();
  const row: PluginRecordRow = { id: crypto.randomUUID(), pluginId, collection, data, createdAt: ts, updatedAt: ts };
  await db.pluginRecords.add(row);
  return row;
}

/** Writes a daily collection's record for `day`. Same id on every device, so offline edits converge. */
export async function setDaily(pluginId: string, collection: string, day: string, data: Record<string, unknown>): Promise<PluginRecordRow> {
  const ts = now();
  const id = dailyRecordId(pluginId, collection, day);
  const existing = await db.pluginRecords.get(id);
  const row: PluginRecordRow = {
    id,
    pluginId,
    collection,
    day,
    data: existing && !existing.deletedAt ? { ...existing.data, ...data } : data,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    deletedAt: null,
  };
  await db.pluginRecords.put(row);
  return row;
}

export async function updateRecord(id: string, data: Record<string, unknown>): Promise<void> {
  await db.pluginRecords.update(id, { data, updatedAt: now(), syncedAt: undefined });
}

export async function deleteRecord(id: string): Promise<void> {
  const ts = now();
  await db.pluginRecords.update(id, { deletedAt: ts, updatedAt: ts, syncedAt: undefined });
}

// ─── Computing ───────────────────────────────────────────────────────────────

export function evaluatorFor(
  plugin: PluginRow,
  records: readonly PluginRecordRow[],
  opts: { timezone: string; weekStart: number; tab?: { url?: string; title?: string } },
): PluginEvaluator {
  return createEvaluator(plugin.manifest, {
    today: localDate(opts.timezone),
    now: new Date().toISOString(),
    timeZone: opts.timezone,
    weekStart: opts.weekStart,
    installedOn: plugin.installedOn,
    settings: plugin.settings,
    records: records.map(toEngineRecord),
    tab: opts.tab,
  });
}

// ─── Export / import one plugin ──────────────────────────────────────────────

export async function exportPlugin(pluginId: string): Promise<string> {
  const plugin = await db.plugins.get(pluginId);
  if (!plugin) throw new Error(`no plugin ${pluginId}`);
  const records = await pluginRecords(pluginId);
  return serializePluginExport({
    exported_at: now(),
    plugin: { id: plugin.id, manifest: plugin.manifest, settings: plugin.settings, installed_on: plugin.installedOn },
    records: records.map(toEngineRecord),
  });
}

/**
 * Restores an exported plugin with its records. Revives the same ids, so an
 * export made before uninstalling brings the install back as it was. Refuses
 * while another install of the same plugin is live — merging two histories
 * of one plugin is a decision for the user, not for an import.
 */
export async function importPlugin(text: string): Promise<PluginWriteResult> {
  const parsed = parsePluginExport(text);
  if (!parsed.ok) return parsed;
  const existing = await liveBySlug(parsed.value.plugin.manifest.id);
  if (existing && existing.id !== parsed.value.plugin.id) {
    return { ok: false, issues: [{ path: 'plugin.manifest.id', message: `"${existing.manifest.name}" is already installed; uninstall it first to restore this export` }] };
  }
  const { plugin, records } = rowsFromExport(parsed.value, now());
  await db.transaction('rw', db.plugins, db.pluginRecords, async () => {
    await db.plugins.put(plugin);
    await db.pluginRecords.bulkPut(records);
  });
  return { ok: true, plugin };
}
