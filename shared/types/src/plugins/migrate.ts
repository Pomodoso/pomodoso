// Carrying stored records over a breaking update, by replaying the new
// version's `migrate` steps. Pure: returns new records and which ones
// changed; the client persists those (bumping updated_at, so sync propagates
// them like any edit).
//
// drop_field leaves stored values in place on purpose. The engine ignores
// keys a version doesn't declare, so nothing shows them, but an export still
// has them and a later version can bring the field back.

import type { PluginRecord } from './compute.ts';
import type { PluginMigrate } from './manifest.ts';

export interface MigrationResult {
  records: PluginRecord[];
  changedIds: string[];
}

function mapValue(v: unknown, map: Record<string, string>): unknown {
  if (typeof v === 'string') return map[v] ?? v;
  if (Array.isArray(v)) return [...new Set(v.map((x) => (typeof x === 'string' ? (map[x] ?? x) : x)))];
  return v;
}

export function applyMigration(records: readonly PluginRecord[], migrate: PluginMigrate): MigrationResult {
  const changed = new Set<string>();
  const out = records.map((r) => {
    let rec = r;
    const touch = (next: PluginRecord) => {
      if (JSON.stringify(next) !== JSON.stringify(rec)) {
        rec = next;
        changed.add(r.id);
      }
    };

    for (const step of migrate.steps) {
      if ('rename_collection' in step) {
        if (rec.collection === step.rename_collection.from) touch({ ...rec, collection: step.rename_collection.to });
      } else if ('rename_field' in step) {
        const { collection, from, to } = step.rename_field;
        if (rec.collection === collection && from in rec.data) {
          const { [from]: value, ...rest } = rec.data;
          touch({ ...rec, data: { ...rest, [to]: value } });
        }
      } else if ('map_values' in step) {
        const { collection, field, map } = step.map_values;
        if (rec.collection === collection && field in rec.data) {
          touch({ ...rec, data: { ...rec.data, [field]: mapValue(rec.data[field], map) } });
        }
      }
    }
    return rec;
  });
  return { records: out, changedIds: [...changed] };
}
