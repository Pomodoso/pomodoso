// Comparing two versions of a plugin: is the update safe for the records
// people already have?
//
// Additive changes (new optional fields, new options, new views, any wording)
// can install on their own. Breaking ones — anything that leaves stored
// records pointing at a field, option or collection that no longer means the
// same thing — need a new major version and a `migrate` block that accounts
// for every one of them, and the user always confirms. The directory runs
// this on publish; clients run it before offering an update.

import { formatPath, type PluginIssue } from './issues.ts';
import { optionValue } from './check.ts';
import type { MigrateStep, PluginCollection, PluginField, PluginManifest } from './manifest.ts';

export type ChangeKind = 'additive' | 'breaking';

export interface ManifestChange {
  kind: ChangeKind;
  path: string;
  message: string;
}

export interface UpdateReport {
  /** `none` when nothing but the version changed. */
  kind: 'none' | ChangeKind;
  changes: ManifestChange[];
  /** Problems that block publishing this version. Empty = OK to publish. */
  issues: PluginIssue[];
  /** Whether the new version's `migrate` block runs for this update. */
  migrates: boolean;
}

type Semver = [number, number, number];

function semver(v: string): Semver {
  const [a = 0, b = 0, c = 0] = v.split('.').map(Number);
  return [a, b, c];
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const x = semver(a);
  const y = semver(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// ─── Raw diff ────────────────────────────────────────────────────────────────

const isRequired = (f: PluginField) => !f.optional && f.default === undefined;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diffField(path: string, prev: PluginField, next: PluginField, out: ManifestChange[]) {
  if (prev.type !== next.type) {
    out.push({
      kind: 'breaking',
      path,
      message: `field "${next.key}" changed type ${prev.type} → ${next.type}; stored values won't fit. Add a new field instead`,
    });
    return;
  }
  const before = out.length;
  if (!isRequired(prev) && isRequired(next)) {
    out.push({ kind: 'breaking', path, message: `field "${next.key}" became required with no default; existing records have no value` });
  }
  const prevOptions = prev.options?.map(optionValue) ?? [];
  const nextOptions = next.options?.map(optionValue) ?? [];
  for (const o of prevOptions) {
    if (!nextOptions.includes(o)) {
      out.push({ kind: 'breaking', path: `${path}.options`, message: `option "${o}" of "${next.key}" was removed; records may hold it` });
    }
  }
  const added = nextOptions.filter((o) => !prevOptions.includes(o));
  if (added.length > 0) out.push({ kind: 'additive', path: `${path}.options`, message: `new options for "${next.key}": ${added.join(', ')}` });
  // Anything else (label, unit, colors, a new default, becoming optional) only changes presentation.
  if (out.length === before && !same(prev, next)) out.push({ kind: 'additive', path, message: `field "${next.key}" changed` });
}

function diffCollection(path: string, prev: PluginCollection, next: PluginCollection, out: ManifestChange[]) {
  if (prev.kind !== next.kind) {
    out.push({ kind: 'breaking', path: `${path}.kind`, message: `collection "${next.key}" changed kind ${prev.kind} → ${next.kind}` });
  }
  for (const pf of prev.fields) {
    const nf = next.fields.find((f) => f.key === pf.key);
    const at = `${path}.fields.${pf.key}`;
    if (!nf) out.push({ kind: 'breaking', path: at, message: `field "${pf.key}" was removed from "${next.key}"` });
    else diffField(at, pf, nf, out);
  }
  for (const nf of next.fields) {
    if (prev.fields.some((f) => f.key === nf.key)) continue;
    const at = `${path}.fields.${nf.key}`;
    if (isRequired(nf)) {
      out.push({ kind: 'breaking', path: at, message: `new field "${nf.key}" is required with no default; existing records have no value` });
    } else {
      out.push({ kind: 'additive', path: at, message: `new field "${nf.key}"` });
    }
  }
  if (prev.title_field !== next.title_field) out.push({ kind: 'additive', path: `${path}.title_field`, message: 'title field changed' });
}

/** Every difference between two versions, classified. Ignores `version` and `migrate`. */
export function diffManifests(prev: PluginManifest, next: PluginManifest): ManifestChange[] {
  const out: ManifestChange[] = [];

  for (const pc of prev.collections) {
    const nc = next.collections.find((c) => c.key === pc.key);
    const at = `collections.${pc.key}`;
    if (!nc) out.push({ kind: 'breaking', path: at, message: `collection "${pc.key}" was removed` });
    else diffCollection(at, pc, nc, out);
  }
  for (const nc of next.collections) {
    if (!prev.collections.some((c) => c.key === nc.key)) {
      out.push({ kind: 'additive', path: `collections.${nc.key}`, message: `new collection "${nc.key}"` });
    }
  }

  // Everything else only changes how records are shown or computed, never the
  // records themselves.
  const shown = ['name', 'icon', 'description', 'author', 'license', 'settings', 'computed', 'views', 'today', 'hooks', 'rules'] as const;
  for (const k of shown) {
    if (!same(prev[k], next[k])) out.push({ kind: 'additive', path: k, message: `${k} changed` });
  }
  return out;
}

// ─── Migration simulation ────────────────────────────────────────────────────

/**
 * Replays `steps` on the previous version's collections, so what's left
 * breaking after the replay is exactly what the migration doesn't cover.
 */
function simulate(prev: PluginManifest, steps: readonly MigrateStep[], issues: PluginIssue[]): PluginManifest {
  const collections: PluginCollection[] = structuredClone(prev.collections);
  const issue = (i: number, op: string, message: string) => issues.push({ path: formatPath(['migrate', 'steps', i, op]), message });
  const find = (key: string) => collections.find((c) => c.key === key);

  steps.forEach((step, i) => {
    if ('rename_collection' in step) {
      const { from, to } = step.rename_collection;
      const c = find(from);
      if (!c) issue(i, 'rename_collection', `the previous version has no collection "${from}"`);
      else if (find(to)) issue(i, 'rename_collection', `collection "${to}" already exists; renaming onto it would mix two collections`);
      else c.key = to;
    } else if ('rename_field' in step) {
      const { collection, from, to } = step.rename_field;
      const fields = find(collection)?.fields;
      const f = fields?.find((x) => x.key === from);
      if (!f) issue(i, 'rename_field', `the previous version has no field "${from}" in "${collection}"`);
      else if (fields!.some((x) => x.key === to)) issue(i, 'rename_field', `field "${to}" already exists in "${collection}"; renaming onto it would overwrite its values`);
      else f.key = to;
    } else if ('map_values' in step) {
      const { collection, field, map } = step.map_values;
      const f = find(collection)?.fields.find((x) => x.key === field);
      if (!f?.options) {
        issue(i, 'map_values', `the previous version has no select field "${field}" in "${collection}"`);
        return;
      }
      const values = f.options.map(optionValue);
      for (const from of Object.keys(map)) {
        if (!values.includes(from)) issue(i, 'map_values', `the previous version of "${field}" has no option "${from}"`);
      }
      const kept = f.options.filter((o) => !Object.hasOwn(map, optionValue(o)));
      const targets = Object.values(map).filter((v) => !kept.some((o) => optionValue(o) === v));
      f.options = [...kept, ...new Set(targets)];
    } else {
      const { collection, field } = step.drop_field;
      const c = find(collection);
      if (!c?.fields.some((x) => x.key === field)) issue(i, 'drop_field', `the previous version has no field "${field}" in "${collection}"`);
      else c.fields = c.fields.filter((x) => x.key !== field);
    }
  });
  return { ...prev, collections };
}

// ─── The update check ───────────────────────────────────────────────────────

export function checkUpdate(prev: PluginManifest, next: PluginManifest): UpdateReport {
  const issues: PluginIssue[] = [];
  const changes = diffManifests(prev, next);
  const breaking = changes.filter((c) => c.kind === 'breaking');
  const kind: UpdateReport['kind'] = breaking.length > 0 ? 'breaking' : changes.length > 0 ? 'additive' : 'none';

  if (prev.id !== next.id) issues.push({ path: 'id', message: `id changed "${prev.id}" → "${next.id}"; an update must keep the id` });
  if (compareVersions(next.version, prev.version) <= 0) {
    issues.push({ path: 'version', message: `version must go up from ${prev.version}` });
  }

  const prevMajor = semver(prev.version)[0];
  const nextMajor = semver(next.version)[0];
  const migrates = next.migrate !== undefined && next.migrate.from === `${prevMajor}.x` && nextMajor > prevMajor;

  if (kind === 'breaking') {
    if (nextMajor <= prevMajor) {
      issues.push({ path: 'version', message: `breaking changes need a new major version: ${prevMajor + 1}.0.0` });
    }
    if (!migrates) {
      issues.push({
        path: 'migrate',
        message: `breaking changes need a migrate block from "${prevMajor}.x": ${breaking.map((b) => b.message).join('; ')}`,
      });
    }
  }

  // Whatever the diff says, steps that will run are validated: an additive
  // update can still carry a migration that moves values away from a field.
  if (migrates) {
    const simulated = simulate(prev, next.migrate!.steps, issues);
    for (const left of diffManifests(simulated, next).filter((c) => c.kind === 'breaking')) {
      issues.push({ path: left.path, message: `not covered by migrate: ${left.message}` });
    }
    for (const nc of next.collections) {
      const pc = prev.collections.find((c) => c.key === nc.key);
      const sc = simulated.collections.find((c) => c.key === nc.key);
      for (const nf of nc.fields) {
        if (pc?.fields.some((f) => f.key === nf.key) && !sc?.fields.some((f) => f.key === nf.key)) {
          issues.push({
            path: `collections.${nc.key}.fields.${nf.key}`,
            message: `migrate moves or drops "${nf.key}", but this version still declares it; its saved values would be lost`,
          });
        }
      }
    }
  }

  return { kind, changes, issues, migrates };
}
