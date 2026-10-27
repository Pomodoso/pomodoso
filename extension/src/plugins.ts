// Plugin storage in the extension: install, records, uninstall, and
// export/import of a single plugin. Validation and every computation live in
// @pomodoso/types/plugins; this module only reads and writes Dexie.
//
// Writes follow the rest of the database: client UUIDs, updatedAt stamped on
// every change, syncedAt cleared so sync picks it up, soft delete only.

import {
  applyRules,
  createEvaluator,
  dailyRecordId,
  parsePluginExport,
  parsePluginFile,
  serializePluginExport,
  SHOW_ON_TODAY_KEY,
  type PluginEvaluator,
  type PluginIssue,
} from '@pomodoso/types/plugins';

import { db, localDate, now, type PluginRecordRow, type PluginRow } from './db';
import { rowsFromExport, toEngineRecord } from './pluginRows';

export type PluginWriteResult = { ok: true; plugin: PluginRow } | { ok: false; issues: PluginIssue[] };

/** What a write needs to know about the user's clock: `rules` can stamp `$today_date`. */
export interface PluginEnv {
  timezone: string;
  weekStart: number;
}

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

export async function installPlugin(
  text: string,
  timezone: string,
  opts: { settings?: Record<string, unknown>; showOnToday?: boolean; source?: PluginRow['source'] } = {},
): Promise<PluginWriteResult> {
  const parsed = parsePluginFile(text);
  if (!parsed.ok) return parsed;
  const ts = now();
  const plugin: PluginRow = {
    id: crypto.randomUUID(),
    slug: parsed.manifest.id,
    source: opts.source ?? 'file',
    manifest: parsed.manifest,
    settings: { ...opts.settings, [SHOW_ON_TODAY_KEY]: Boolean(parsed.manifest.today && (opts.showOnToday ?? parsed.manifest.today.default_on)) },
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

/** Sets one setting, merged over the stored ones in a transaction, so overlapping changes all land. */
export async function updatePluginSetting(pluginId: string, key: string, value: unknown): Promise<void> {
  await db.transaction('rw', db.plugins, async () => {
    const plugin = await db.plugins.get(pluginId);
    if (!plugin || plugin.deletedAt) return;
    await db.plugins.update(pluginId, { settings: { ...plugin.settings, [key]: value }, updatedAt: now(), syncedAt: undefined });
  });
}

// ─── Records ─────────────────────────────────────────────────────────────────
// Every write goes through the file's `rules`, so a rule behaves the same
// whether the record came from a form, a quick button or (later) a hook.

/**
 * `next`'s data after the file's rules. Rules see the record's real dates and
 * the plugin's other records, so a `$count` in `set` counts the collection.
 * Runs inside the caller's transaction.
 */
async function withRules(plugin: PluginRow, env: PluginEnv, prev: PluginRecordRow | undefined, next: PluginRecordRow): Promise<Record<string, unknown>> {
  if (!plugin.manifest.rules?.some((r) => r.collection === next.collection)) return next.data;
  const records = (await pluginRecords(plugin.id)).map(toEngineRecord);
  return applyRules(plugin.manifest, prev && toEngineRecord(prev), toEngineRecord(next), {
    today: localDate(env.timezone),
    now: now(),
    timeZone: env.timezone,
    weekStart: env.weekStart,
    installedOn: plugin.installedOn,
    settings: plugin.settings,
    records,
  });
}

/** Adds a record to an event or item collection. Events happen now. */
export async function addRecord(plugin: PluginRow, collection: string, data: Record<string, unknown>, env: PluginEnv): Promise<PluginRecordRow> {
  const ts = now();
  const kind = plugin.manifest.collections.find((c) => c.key === collection)?.kind;
  const row: PluginRecordRow = {
    id: crypto.randomUUID(),
    pluginId: plugin.id,
    collection,
    ...(kind === 'event' ? { occurredAt: ts } : {}),
    data,
    createdAt: ts,
    updatedAt: ts,
  };
  return db.transaction('rw', db.pluginRecords, async () => {
    row.data = await withRules(plugin, env, undefined, row);
    await db.pluginRecords.add(row);
    return row;
  });
}

/**
 * Writes a daily collection's record for `day`, merged over what's saved
 * (a null clears a field). Same id on every device, so offline edits
 * converge. Read, merge and write share one transaction: overlapping saves
 * of the same day must both land.
 */
export async function setDaily(plugin: PluginRow, collection: string, day: string, data: Record<string, unknown>, env: PluginEnv): Promise<PluginRecordRow> {
  const ts = now();
  const id = dailyRecordId(plugin.id, collection, day);
  return db.transaction('rw', db.pluginRecords, async () => {
    const existing = await db.pluginRecords.get(id);
    const prev = existing && !existing.deletedAt ? existing : undefined;
    const row: PluginRecordRow = {
      id,
      pluginId: plugin.id,
      collection,
      day,
      data: { ...prev?.data, ...data },
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      deletedAt: null,
    };
    row.data = await withRules(plugin, env, prev, row);
    await db.pluginRecords.put(row);
    return row;
  });
}

export async function updateRecord(plugin: PluginRow, id: string, data: Record<string, unknown>, env: PluginEnv): Promise<void> {
  await db.transaction('rw', db.pluginRecords, async () => {
    const existing = await db.pluginRecords.get(id);
    if (!existing || existing.deletedAt) return;
    const ts = now();
    const next = await withRules(plugin, env, existing, { ...existing, data, updatedAt: ts });
    await db.pluginRecords.update(id, { data: next, updatedAt: ts, syncedAt: undefined });
  });
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
