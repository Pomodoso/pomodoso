import {
  applyRules,
  cascadeIds,
  createEvaluator,
  dailyRecordId,
  normalizeOption,
  PLUGIN_VALUES_MAX_BYTES,
  SHOW_ON_TODAY_KEY,
  type PluginEvaluator,
  type PluginManifest,
  type PluginIssue,
} from '@pomodoso/types/plugins';
import { toEngineRecord, type PluginRecordRow, type PluginRow } from '@pomodoso/types/plugins/rows';
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { plugin as pluginTable, pluginRecord } from '@/db/schema';
import { uid } from '@/utils/id';
import { pluginFromColumns, putPlugins, putRecords, recordFromColumns } from '@/utils/pluginStore';
import { triggerSync } from '@/utils/sync';

// Apps' local writes, ported from the extension's plugins.ts: the same rules,
// size limit and cascade, on SQLite. Every write leaves the row dirty
// (syncedAt cleared) and asks for a sync.

export type PluginWriteResult = { ok: true; plugin: PluginRow } | { ok: false; issues: PluginIssue[] };

/** What a write needs to know about the user's clock: `rules` can stamp `$today_date`. */
export interface PluginClock {
  timeZone: string;
  weekStart: number;
}

const nowIso = () => new Date().toISOString();

export function localToday(timeZone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone });
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function livePlugin(id: string): PluginRow | undefined {
  const c = db.select().from(pluginTable).where(eq(pluginTable.id, id)).all()[0];
  return c && !c.deletedAt ? pluginFromColumns(c) : undefined;
}

function liveBySlug(slug: string): PluginRow | undefined {
  const c = db.select().from(pluginTable).where(and(eq(pluginTable.slug, slug), isNull(pluginTable.deletedAt))).all()[0];
  return c ? pluginFromColumns(c) : undefined;
}

export function installedBySlug(slug: string): PluginRow | undefined {
  return liveBySlug(slug);
}

export function pluginRecords(pluginId: string): PluginRecordRow[] {
  return db
    .select()
    .from(pluginRecord)
    .where(and(eq(pluginRecord.pluginId, pluginId), isNull(pluginRecord.deletedAt)))
    .all()
    .map(recordFromColumns);
}

/**
 * The settings an app starts with: each declared setting's default. A select
 * without one starts on its first option, which is what its picker shows.
 */
export function defaultSettings(manifest: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings ?? []) {
    if (s.default !== undefined) out[s.key] = s.default;
    else if (s.type === 'select' && s.options?.[0] !== undefined) out[s.key] = normalizeOption(s.options[0]).value;
  }
  return out;
}

/** Installs a validated manifest. Refuses a second live install of the same app. */
export function installPlugin(
  manifest: PluginManifest,
  timeZone: string,
  opts: { settings?: Record<string, unknown>; showOnToday?: boolean; source?: PluginRow['source']; directoryVersionId?: string } = {},
): PluginWriteResult {
  const existing = liveBySlug(manifest.id);
  if (existing) {
    return { ok: false, issues: [{ path: 'id', message: `"${existing.manifest.name}" is already installed (${existing.manifest.version})` }] };
  }
  const ts = nowIso();
  const plugin: PluginRow = {
    id: uid(),
    slug: manifest.id,
    source: opts.source ?? 'file',
    ...(opts.directoryVersionId ? { directoryVersionId: opts.directoryVersionId } : {}),
    manifest,
    settings: { ...opts.settings, [SHOW_ON_TODAY_KEY]: Boolean(manifest.today && (opts.showOnToday ?? manifest.today.default_on)) },
    enabled: true,
    autoUpdate: false,
    installedOn: localToday(timeZone),
    createdAt: ts,
    updatedAt: ts,
  };
  putPlugins([plugin]);
  triggerSync();
  return { ok: true, plugin };
}

/** Soft-deletes the app and every record, in one transaction. */
export function uninstallPlugin(pluginId: string): void {
  const ts = nowIso();
  db.transaction(tx => {
    tx.update(pluginTable).set({ deletedAt: ts, updatedAt: ts, syncedAt: null }).where(eq(pluginTable.id, pluginId)).run();
    tx.update(pluginRecord)
      .set({ deletedAt: ts, updatedAt: ts, syncedAt: null })
      .where(and(eq(pluginRecord.pluginId, pluginId), isNull(pluginRecord.deletedAt)))
      .run();
  });
  triggerSync();
}

/** Sets one setting, merged over the stored ones, so two quick changes can't undo each other. */
export function updatePluginSetting(pluginId: string, key: string, value: unknown): void {
  const plugin = livePlugin(pluginId);
  if (!plugin) return;
  const settings = withinLimit({ ...plugin.settings, [key]: value }, 'These settings');
  db.update(pluginTable).set({ settings, updatedAt: nowIso(), syncedAt: null }).where(eq(pluginTable.id, pluginId)).run();
  triggerSync();
}

/** `values` if it serializes within PLUGIN_VALUES_MAX_BYTES, else throws: the server drops anything larger. */
function withinLimit<T extends Record<string, unknown>>(values: T, what: string): T {
  if (new TextEncoder().encode(JSON.stringify(values)).length > PLUGIN_VALUES_MAX_BYTES) {
    throw new Error(`${what} are too large to save (limit ${PLUGIN_VALUES_MAX_BYTES / 1024} KB)`);
  }
  return values;
}

/** `next`'s data after the file's rules, which see the record's real dates and the app's other records. */
function withRules(plugin: PluginRow, clock: PluginClock, prev: PluginRecordRow | undefined, next: PluginRecordRow): Record<string, unknown> {
  if (!plugin.manifest.rules?.some(r => r.collection === next.collection)) return next.data;
  return applyRules(plugin.manifest, prev && toEngineRecord(prev), toEngineRecord(next), {
    today: localToday(clock.timeZone),
    now: nowIso(),
    timeZone: clock.timeZone,
    weekStart: clock.weekStart,
    installedOn: plugin.installedOn,
    settings: plugin.settings,
    records: pluginRecords(plugin.id).map(toEngineRecord),
  });
}

/** Adds a record to an event or item collection. Events happen now unless `occurredAt` says otherwise. */
export function addRecord(plugin: PluginRow, collection: string, data: Record<string, unknown>, clock: PluginClock, opts: { occurredAt?: string } = {}): PluginRecordRow {
  const ts = nowIso();
  const kind = plugin.manifest.collections.find(c => c.key === collection)?.kind;
  const row: PluginRecordRow = {
    id: uid(),
    pluginId: plugin.id,
    collection,
    ...(kind === 'event' ? { occurredAt: opts.occurredAt ?? ts } : {}),
    data,
    createdAt: ts,
    updatedAt: ts,
  };
  row.data = withinLimit(withRules(plugin, clock, undefined, row), 'These values');
  putRecords([row]);
  triggerSync();
  return row;
}

/**
 * Writes a daily collection's record for `day`, merged over what's saved (a
 * null clears a field). Same id on every device, so offline edits converge.
 */
export function setDaily(plugin: PluginRow, collection: string, day: string, data: Record<string, unknown>, clock: PluginClock): PluginRecordRow {
  const ts = nowIso();
  const id = dailyRecordId(plugin.id, collection, day);
  const stored = db.select().from(pluginRecord).where(eq(pluginRecord.id, id)).all()[0];
  const existing = stored ? recordFromColumns(stored) : undefined;
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
  row.data = withinLimit(withRules(plugin, clock, prev, row), 'These values');
  putRecords([row]);
  triggerSync();
  return row;
}

/** `occurredAt` moves an event to another moment (logged at the wrong time). */
export function updateRecord(plugin: PluginRow, id: string, data: Record<string, unknown>, clock: PluginClock, opts: { occurredAt?: string } = {}): void {
  const stored = db.select().from(pluginRecord).where(eq(pluginRecord.id, id)).all()[0];
  if (!stored || stored.deletedAt) return;
  const existing = recordFromColumns(stored);
  const ts = nowIso();
  const occurredAt = existing.occurredAt !== undefined && opts.occurredAt ? opts.occurredAt : existing.occurredAt;
  const next = withinLimit(withRules(plugin, clock, existing, { ...existing, occurredAt, data, updatedAt: ts }), 'These values');
  putRecords([{ ...existing, data: next, ...(occurredAt !== undefined ? { occurredAt } : {}), updatedAt: ts, syncedAt: undefined }]);
  triggerSync();
}

/** Soft-deletes a record and everything whose `ref` fields point at it, transitively. */
export function deleteRecord(plugin: PluginRow, id: string): void {
  const ts = nowIso();
  const ids = cascadeIds(plugin.manifest, pluginRecords(plugin.id).map(toEngineRecord), id);
  db.transaction(tx => {
    for (const x of ids) {
      tx.update(pluginRecord).set({ deletedAt: ts, updatedAt: ts, syncedAt: null }).where(eq(pluginRecord.id, x)).run();
    }
  });
  triggerSync();
}

export function evaluatorFor(plugin: PluginRow, records: readonly PluginRecordRow[], clock: PluginClock): PluginEvaluator {
  return createEvaluator(plugin.manifest, {
    today: localToday(clock.timeZone),
    now: nowIso(),
    timeZone: clock.timeZone,
    weekStart: clock.weekStart,
    installedOn: plugin.installedOn,
    settings: plugin.settings,
    records: records.map(toEngineRecord),
  });
}
