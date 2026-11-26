// How a client stores an installed app and its records (camelCase rows), the
// conversions to the engine and export shapes (snake_case, as on the server),
// and how those rows travel through sync. Shared by every client that runs
// apps (extension, mobile), so both write the same wire shape, read pulls the
// same way, and fold duplicate installs into the same result.
//
// Served on its own subpath (@pomodoso/types/plugins/rows), and importing
// only types plus ids.ts: it runs in sync engines, which must not pull the
// YAML parser and zod in through the plugins entry.

import type { PluginRecord } from './compute.ts';
import type { PluginExport } from './export.ts';
import { dailyRecordId } from './ids.ts';
import type { PluginManifest } from './manifest.ts';

/** Last-Write-Wins bookkeeping, as every syncable local row carries it. */
interface RowSyncMeta {
  updatedAt: string;
  /** Tombstone: soft delete only. */
  deletedAt?: string | null;
  /** Undefined means dirty, not yet pushed. `| undefined` spelled out so code
   *  can clear it to re-dirty a row under exactOptionalPropertyTypes. */
  syncedAt?: string | undefined;
}

/** An installed app. Personal like habits: no workspace. The row keeps the
 *  parsed, validated manifest, never the YAML text. */
export interface PluginRow extends RowSyncMeta {
  id: string;
  /** manifest.id; one live install per slug. */
  slug: string;
  source: 'file' | 'directory';
  directoryVersionId?: string | undefined;
  manifest: PluginManifest;
  /** The user's values for manifest.settings, plus per-user state that must
   *  survive updates of the file (edited select options, Today on/off). */
  settings: Record<string, unknown>;
  enabled: boolean;
  autoUpdate: boolean;
  /** YYYY-MM-DD local: where taper starts, how far back streak looks. */
  installedOn: string;
  createdAt: string;
}

/** One record of one of an app's collections. Same shape as the engine's
 *  PluginRecord, in camelCase; see toEngineRecord. */
export interface PluginRecordRow extends RowSyncMeta {
  /** UUID; for daily collections derived by dailyRecordId(). */
  id: string;
  pluginId: string;
  collection: string;
  /** Daily collections, YYYY-MM-DD. */
  day?: string | undefined;
  /** Event collections, ISO. */
  occurredAt?: string | undefined;
  data: Record<string, unknown>;
  createdAt: string;
}

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

// ─── Sync ─────────────────────────────────────────────────────────────────────
// The `data` of a sync entity is snake_case, as the server stores it
// (backend/src/routes/sync.rs push_plugin / push_plugin_record).

export function pluginSyncData(p: PluginRow): Record<string, unknown> {
  return {
    slug: p.slug,
    source: p.source,
    directory_version_id: p.directoryVersionId ?? null,
    manifest: p.manifest,
    settings: p.settings,
    enabled: p.enabled,
    auto_update: p.autoUpdate,
    installed_on: p.installedOn,
    created_at: p.createdAt,
  };
}

export function pluginRecordSyncData(r: PluginRecordRow): Record<string, unknown> {
  return {
    plugin_id: r.pluginId,
    collection: r.collection,
    day: r.day ?? null,
    occurred_at: r.occurredAt ?? null,
    data: r.data,
    created_at: r.createdAt,
  };
}

/**
 * A server timestamp in the client's ISO form. The server writes
 * `…T10:00:00Z`, the client `…T10:00:00.000Z`; they sort as text (list order
 * by created_at), so both must have one shape.
 */
export function iso(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

interface RemoteMeta {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A pulled plugin as a local row, already marked synced. */
export function pluginFromSync(meta: RemoteMeta, data: Record<string, unknown>): PluginRow {
  return {
    id: meta.id,
    slug: String(data['slug'] ?? ''),
    source: data['source'] === 'directory' ? 'directory' : 'file',
    ...(typeof data['directory_version_id'] === 'string' ? { directoryVersionId: data['directory_version_id'] } : {}),
    manifest: data['manifest'] as PluginRow['manifest'],
    settings: (data['settings'] as Record<string, unknown> | null) ?? {},
    enabled: data['enabled'] !== false,
    autoUpdate: data['auto_update'] === true,
    installedOn: String(data['installed_on'] ?? '').slice(0, 10),
    createdAt: iso(data['created_at'], meta.updatedAt),
    updatedAt: meta.updatedAt,
    syncedAt: meta.updatedAt,
    ...(meta.deletedAt ? { deletedAt: meta.deletedAt } : {}),
  };
}

/** A pulled plugin record as a local row, already marked synced. */
export function pluginRecordFromSync(meta: RemoteMeta, data: Record<string, unknown>): PluginRecordRow {
  return {
    id: meta.id,
    pluginId: String(data['plugin_id'] ?? ''),
    collection: String(data['collection'] ?? ''),
    ...(typeof data['day'] === 'string' ? { day: data['day'].slice(0, 10) } : {}),
    ...(typeof data['occurred_at'] === 'string' ? { occurredAt: iso(data['occurred_at'], meta.updatedAt) } : {}),
    data: (data['data'] as Record<string, unknown> | null) ?? {},
    createdAt: iso(data['created_at'], meta.updatedAt),
    updatedAt: meta.updatedAt,
    syncedAt: meta.updatedAt,
    ...(meta.deletedAt ? { deletedAt: meta.deletedAt } : {}),
  };
}

// ─── Duplicate installs ───────────────────────────────────────────────────────

/**
 * Two devices can install the same plugin while offline: after sync there
 * are two live installs of one slug, each with its own records. This plans
 * folding them into one. Every device computes the same plan, so they
 * converge without coordinating:
 *
 * - the keeper is the earliest install (createdAt, then id);
 * - the others are tombstoned, and their records move to the keeper — event
 *   and item records keep their id; daily records take the keeper's daily id
 *   for that day (and when the keeper already has that day, the more
 *   recently edited one wins); their old rows are tombstoned.
 *
 * Returns the rows to write, all dirty so they push. Empty when nothing is
 * duplicated.
 */
export function planDuplicateMerge(
  plugins: readonly PluginRow[],
  records: readonly PluginRecordRow[],
  ts: string,
): { plugins: PluginRow[]; records: PluginRecordRow[] } {
  const bySlug = new Map<string, PluginRow[]>();
  for (const p of plugins) {
    if (p.deletedAt) continue;
    bySlug.set(p.slug, [...(bySlug.get(p.slug) ?? []), p]);
  }
  const outPlugins: PluginRow[] = [];
  const outRecords = new Map<string, PluginRecordRow>();
  const byId = new Map(records.map((r) => [r.id, r]));
  const dirty = { updatedAt: ts, syncedAt: undefined };

  for (const group of bySlug.values()) {
    if (group.length < 2) continue;
    const [keeper, ...losers] = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const loser of losers) {
      outPlugins.push({ ...loser, ...dirty, deletedAt: ts });
      for (const r of records) {
        if (r.pluginId !== loser.id || r.deletedAt) continue;
        if (r.day === undefined) {
          outRecords.set(r.id, { ...r, ...dirty, pluginId: keeper!.id });
          continue;
        }
        const id = dailyRecordId(keeper!.id, r.collection, r.day);
        const current = outRecords.get(id) ?? byId.get(id);
        if (!current || current.deletedAt || current.updatedAt < r.updatedAt) {
          outRecords.set(id, { ...r, ...dirty, id, pluginId: keeper!.id, deletedAt: null });
        }
        outRecords.set(r.id, { ...r, ...dirty, deletedAt: ts });
      }
    }
  }
  return { plugins: outPlugins, records: [...outRecords.values()] };
}
