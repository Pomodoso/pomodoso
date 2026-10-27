// One plugin's data as a single YAML file: its manifest, the user's settings
// and every record. Without the sync plan this is how a plugin moves to
// another device or survives an uninstall, so the format is shared by every
// client and must stay readable by later versions.

import { parse, stringify } from 'yaml';

import type { PluginRecord } from './compute.ts';
import { dailyRecordId } from './ids.ts';
import { formatPath, type PluginIssue } from './issues.ts';
import type { PluginManifest } from './manifest.ts';
import { validatePluginData } from './parse.ts';
import { z } from './zod.ts';

export const PLUGIN_EXPORT_VERSION = 1;

export interface PluginExport {
  pomodoso_plugin_export: typeof PLUGIN_EXPORT_VERSION;
  exported_at: string;
  plugin: {
    /** Kept so a re-import revives the same install: daily record ids derive from it. */
    id: string;
    manifest: PluginManifest;
    settings: Record<string, unknown>;
    installed_on: string;
  };
  records: PluginRecord[];
}

export type PluginExportResult = { ok: true; value: PluginExport } | { ok: false; issues: PluginIssue[] };

export function serializePluginExport(value: Omit<PluginExport, 'pomodoso_plugin_export'>): string {
  // Tombstones stay out: an export is what the user has, not its history.
  const live = { ...value, records: value.records.filter((r) => !r.deleted_at) };
  return stringify({ pomodoso_plugin_export: PLUGIN_EXPORT_VERSION, ...live }, { lineWidth: 0 });
}

/** A real calendar day: 2026-02-30 has the right shape but doesn't exist. */
const day = z.string().refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'must be a real date like 2026-01-31');
/** An ISO timestamp the date helpers can read. */
const timestamp = z
  .string()
  .refine((v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)), 'must be an ISO timestamp like 2026-01-31T12:00:00Z');

const recordSchema = z.object({
  id: z.string().min(1),
  collection: z.string().min(1),
  occurred_at: timestamp.nullish(),
  day: day.nullish(),
  created_at: timestamp,
  updated_at: timestamp.optional(),
  deleted_at: timestamp.nullish(),
  data: z.record(z.string(), z.unknown()),
});

const envelopeSchema = z.object({
  pomodoso_plugin_export: z.literal(PLUGIN_EXPORT_VERSION),
  exported_at: z.string(),
  plugin: z.object({
    id: z.string().min(1),
    manifest: z.unknown(),
    settings: z.record(z.string(), z.unknown()),
    installed_on: day,
  }),
  records: z.array(recordSchema),
});

export function parsePluginExport(text: string): PluginExportResult {
  let data: unknown;
  try {
    data = parse(text, { maxAliasCount: 50 });
  } catch (err) {
    return { ok: false, issues: [{ path: '', message: `YAML: ${(err as Error).message.split('\n')[0]}` }] };
  }
  const env = envelopeSchema.safeParse(data);
  if (!env.success) {
    return { ok: false, issues: env.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })) };
  }

  const manifest = validatePluginData(env.data.plugin.manifest);
  if (!manifest.ok) {
    return { ok: false, issues: manifest.issues.map((i) => ({ ...i, path: `plugin.manifest${i.path ? `.${i.path}` : ''}` })) };
  }

  const kinds = new Map(manifest.manifest.collections.map((c) => [c.key, c.kind]));
  const issues: PluginIssue[] = [];
  const ids = new Set<string>();
  env.data.records.forEach((r, i) => {
    // Repeated ids would silently collapse into one row on import.
    if (ids.has(r.id)) issues.push({ path: formatPath(['records', i, 'id']), message: `record id "${r.id}" appears twice` });
    ids.add(r.id);
    const kind = kinds.get(r.collection);
    if (!kind) issues.push({ path: formatPath(['records', i, 'collection']), message: `no collection "${r.collection}" in this plugin` });
    else if (kind === 'daily') {
      if (!r.day) issues.push({ path: formatPath(['records', i, 'day']), message: 'daily records need a day' });
      // A daily record's id comes from its plugin, collection and day: one row
      // per day, found again by the next save. This also rules out two records
      // for the same day, since they'd share the id.
      else if (r.id !== dailyRecordId(env.data.plugin.id, r.collection, r.day)) {
        issues.push({ path: formatPath(['records', i, 'id']), message: `a daily record's id must be the one for its day (${r.day}); this one was edited` });
      }
    }
  });
  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      pomodoso_plugin_export: PLUGIN_EXPORT_VERSION,
      exported_at: env.data.exported_at,
      plugin: { id: env.data.plugin.id, manifest: manifest.manifest, settings: env.data.plugin.settings, installed_on: env.data.plugin.installed_on },
      records: env.data.records as PluginRecord[],
    },
  };
}
