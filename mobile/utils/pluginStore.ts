import { planDuplicateMerge, type PluginRecordRow, type PluginRow } from '@pomodoso/types/plugins/rows';

import { db } from '@/db/client';
import { plugin, pluginRecord } from '@/db/schema';

// Local storage for apps. The rows themselves are the shared shape
// (@pomodoso/types/plugins/rows), so sync, duplicate-install merging and
// export behave exactly as in the extension; this file only converts between
// that shape and SQLite's columns (null for absent, booleans as integers).

type PluginColumns = typeof plugin.$inferSelect;
type RecordColumns = typeof pluginRecord.$inferSelect;

export function pluginFromColumns(c: PluginColumns): PluginRow {
  return {
    id: c.id,
    slug: c.slug,
    source: c.source,
    ...(c.directoryVersionId ? { directoryVersionId: c.directoryVersionId } : {}),
    manifest: c.manifest,
    settings: c.settings,
    enabled: c.enabled,
    autoUpdate: c.autoUpdate,
    installedOn: c.installedOn,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
    ...(c.syncedAt ? { syncedAt: c.syncedAt } : {}),
  };
}

export function pluginToColumns(r: PluginRow): PluginColumns {
  return {
    id: r.id,
    slug: r.slug,
    source: r.source,
    directoryVersionId: r.directoryVersionId ?? null,
    manifest: r.manifest,
    settings: r.settings,
    enabled: r.enabled,
    autoUpdate: r.autoUpdate,
    installedOn: r.installedOn,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt ?? null,
    syncedAt: r.syncedAt ?? null,
  };
}

export function recordFromColumns(c: RecordColumns): PluginRecordRow {
  return {
    id: c.id,
    pluginId: c.pluginId,
    collection: c.collection,
    ...(c.day ? { day: c.day } : {}),
    ...(c.occurredAt ? { occurredAt: c.occurredAt } : {}),
    data: c.data,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
    ...(c.syncedAt ? { syncedAt: c.syncedAt } : {}),
  };
}

export function recordToColumns(r: PluginRecordRow): RecordColumns {
  return {
    id: r.id,
    pluginId: r.pluginId,
    collection: r.collection,
    day: r.day ?? null,
    occurredAt: r.occurredAt ?? null,
    data: r.data,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt ?? null,
    syncedAt: r.syncedAt ?? null,
  };
}

/** Inserts or replaces app rows. */
export function putPlugins(rows: PluginRow[]): void {
  for (const r of rows) {
    const c = pluginToColumns(r);
    db.insert(plugin).values(c).onConflictDoUpdate({ target: plugin.id, set: c }).run();
  }
}

/** Inserts or replaces app records. */
export function putRecords(rows: PluginRecordRow[]): void {
  for (const r of rows) {
    const c = recordToColumns(r);
    db.insert(pluginRecord).values(c).onConflictDoUpdate({ target: pluginRecord.id, set: c }).run();
  }
}

/**
 * The same app installed on two devices while offline arrives as two live
 * installs; fold them into one (planDuplicateMerge, shared with the
 * extension). Written as local edits, so the result pushes and every device
 * converges on the same install.
 */
export function mergeDuplicatePluginInstalls(): void {
  const plugins = db.select().from(plugin).all().map(pluginFromColumns);
  const live = new Map<string, number>();
  for (const p of plugins) if (!p.deletedAt) live.set(p.slug, (live.get(p.slug) ?? 0) + 1);
  if (![...live.values()].some(n => n > 1)) return;
  const records = db.select().from(pluginRecord).all().map(recordFromColumns);
  const plan = planDuplicateMerge(plugins, records, new Date().toISOString());
  db.transaction(() => {
    putPlugins(plan.plugins);
    putRecords(plan.records);
  });
}
