// Carrying stored records over a breaking update, by replaying the new
// version's `migrate` steps. Pure: returns new records and which ones
// changed; the client persists those (bumping updated_at, so sync propagates
// them like any edit).
//
// drop_field leaves stored values in place on purpose. The engine ignores
// keys a version doesn't declare, so nothing shows them, but an export still
// has them and a later version can bring the field back.

import type { PluginRecord } from './compute.ts';
import type { PluginManifest, PluginMigrate } from './manifest.ts';

export interface MigrationResult {
  records: PluginRecord[];
  changedIds: string[];
}

function mapValue(v: unknown, map: Record<string, string>): unknown {
  // Own keys only: an option named "constructor" must not hit Object.prototype.
  const to = (x: string) => (Object.hasOwn(map, x) ? map[x]! : x);
  if (typeof v === 'string') return to(v);
  if (Array.isArray(v)) return [...new Set(v.map((x) => (typeof x === 'string' ? to(x) : x)))];
  return v;
}

/**
 * Replays `migrate` on records of `prev` (the version they were written
 * under). A record that predates a field reads that field's default in
 * `prev`; renames and value maps carry that default along, so an old record
 * keeps meaning what it meant.
 */
export function applyMigration(records: readonly PluginRecord[], migrate: PluginMigrate, prev: PluginManifest): MigrationResult {
  // collection → field → default, kept in step with the renames.
  const defaults = new Map(
    prev.collections.map((c) => [c.key, new Map(c.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default as unknown]))]),
  );
  const defaultsAt: Map<string, unknown>[] = [];
  for (const step of migrate.steps) {
    defaultsAt.push(new Map(defaults.get(collectionOf(step)) ?? []));
    if ('rename_collection' in step) {
      const d = defaults.get(step.rename_collection.from);
      defaults.delete(step.rename_collection.from);
      if (d) defaults.set(step.rename_collection.to, d);
    } else if ('rename_field' in step) {
      const d = defaults.get(step.rename_field.collection);
      if (d?.has(step.rename_field.from)) {
        d.set(step.rename_field.to, d.get(step.rename_field.from));
        d.delete(step.rename_field.from);
      }
    } else if ('drop_field' in step) {
      defaults.get(step.drop_field.collection)?.delete(step.drop_field.field);
    }
  }

  const changed = new Set<string>();
  const out = records.map((r) => {
    let rec = r;
    const touch = (next: PluginRecord) => {
      if (JSON.stringify(next) !== JSON.stringify(rec)) {
        rec = next;
        changed.add(r.id);
      }
    };

    migrate.steps.forEach((step, i) => {
      const fallback = defaultsAt[i]!;
      if ('rename_collection' in step) {
        if (rec.collection === step.rename_collection.from) touch({ ...rec, collection: step.rename_collection.to });
      } else if ('rename_field' in step) {
        const { collection, from, to } = step.rename_field;
        if (rec.collection !== collection) return;
        if (Object.hasOwn(rec.data, from)) {
          const { [from]: value, ...rest } = rec.data;
          touch({ ...rec, data: { ...rest, [to]: value } });
        } else if (fallback.has(from)) {
          touch({ ...rec, data: { ...rec.data, [to]: fallback.get(from) } });
        }
      } else if ('map_values' in step) {
        const { collection, field, map } = step.map_values;
        if (rec.collection !== collection) return;
        if (Object.hasOwn(rec.data, field)) {
          touch({ ...rec, data: { ...rec.data, [field]: mapValue(rec.data[field], map) } });
        } else if (fallback.has(field)) {
          // Stored explicitly only when the map changes the default's meaning.
          const before = fallback.get(field);
          const after = mapValue(before, map);
          if (JSON.stringify(after) !== JSON.stringify(before)) touch({ ...rec, data: { ...rec.data, [field]: after } });
        }
      }
    });
    return rec;
  });
  return { records: out, changedIds: [...changed] };
}

function collectionOf(step: PluginMigrate['steps'][number]): string {
  if ('rename_collection' in step) return step.rename_collection.from;
  if ('rename_field' in step) return step.rename_field.collection;
  if ('map_values' in step) return step.map_values.collection;
  return step.drop_field.collection;
}
