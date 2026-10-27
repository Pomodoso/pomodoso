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
  // Check and write in one transaction, so two overlapping installs can't both pass.
  return db.transaction('rw', db.plugins, async (): Promise<PluginWriteResult> => {
    const existing = await liveBySlug(parsed.manifest.id);
    if (existing) {
      return { ok: false, issues: [{ path: 'id', message: `"${existing.manifest.name}" is already installed (${existing.manifest.version})` }] };
    }
    await db.plugins.add(plugin);
    return { ok: true, plugin };
  });
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
  // Read, merge and write in one transaction: overlapping saves of the same day
  // (state, then note) must both land.
  return db.transaction('rw', db.pluginRecords, async () => {
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
  });
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
  // One read transaction: an uninstall can't land between the plugin and its records.
  const { plugin, records } = await db.transaction('r', db.plugins, db.pluginRecords, async () => ({
    plugin: await db.plugins.get(pluginId),
    records: await pluginRecords(pluginId),
  }));
  if (!plugin) throw new Error(`no plugin ${pluginId}`);
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
  const { plugin, records } = rowsFromExport(parsed.value, now());
  const refuse = (path: string, message: string): PluginWriteResult => ({ ok: false, issues: [{ path, message }] });

  // Every check runs inside the write transaction: an edited export must not
  // overwrite another plugin, or records that belong to one.
  return db.transaction('rw', db.plugins, db.pluginRecords, async (): Promise<PluginWriteResult> => {
    const existing = await liveBySlug(plugin.slug);
    if (existing && existing.id !== plugin.id) {
      return refuse('plugin.manifest.id', `"${existing.manifest.name}" is already installed; uninstall it first to restore this export`);
    }
    const sameId = await db.plugins.get(plugin.id);
    if (sameId && sameId.slug !== plugin.slug) {
      return refuse('plugin.id', `this export's install id belongs to "${sameId.manifest.name}"; it was edited`);
    }
    const stored = await db.pluginRecords.bulkGet(records.map((r) => r.id));
    const taken = stored.findIndex((r) => r !== undefined && r.pluginId !== plugin.id);
    if (taken !== -1) return refuse(`records[${taken}].id`, 'this record id belongs to another plugin; the export was edited');
    await db.plugins.put(plugin);
    await db.pluginRecords.bulkPut(records);
    // The restore is a snapshot: records of this install that the export
    // doesn't have are tombstoned, so old and new data don't mix.
    const restored = new Set(records.map((r) => r.id));
    const ts = now();
    await db.pluginRecords
      .where('pluginId')
      .equals(plugin.id)
      .modify((r) => {
        if (r.deletedAt || restored.has(r.id)) return;
        r.deletedAt = ts;
        r.updatedAt = ts;
        r.syncedAt = undefined;
      });
    return { ok: true, plugin };
  });
}
