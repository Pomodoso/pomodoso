// What every client needs to show and edit a plugin, beyond computing values:
// a field's effective options, a record's starting data, what a write still
// lacks, the `rules` applied on a write, and how a stat reads on screen.
//
// Kept here, not in a client, so the extension, web and mobile agree on
// labels, defaults and rule behavior.

import type { StatFormat } from './catalog.ts';
import { createEvaluator, type EvalContext, type PluginValue } from './compute.ts';
import type { PluginCollection, PluginField, PluginManifest, SelectOption } from './manifest.ts';

export interface PluginOption {
  value: string;
  label: string;
  color?: string | undefined;
}

/** `after_meal` → `After meal`. The label a key gets when the file names none. */
export function humanize(key: string): string {
  const s = key.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function normalizeOption(o: SelectOption): PluginOption {
  return typeof o === 'string' ? { value: o, label: humanize(o) } : { value: o.value, label: o.label ?? humanize(o.value), color: o.color };
}

export function fieldLabel(f: PluginField): string {
  return f.label ?? humanize(f.key);
}

/**
 * Where a `user_editable` field's options live in `plugin.settings`. Setting
 * keys are lower_snake_case, so this one (with `:` and `.`) can't clash with
 * a setting the file declares — and it survives updates of the file.
 */
export function optionsSettingKey(collection: string, field: string): string {
  return `options:${collection}.${field}`;
}

function isOptionList(v: unknown): v is PluginOption[] {
  return Array.isArray(v) && v.length > 0 && v.every((o) => o !== null && typeof o === 'object' && typeof (o as PluginOption).value === 'string' && typeof (o as PluginOption).label === 'string');
}

/** A select field's options: the user's, when the field is `user_editable` and they set some, else the file's. */
export function fieldOptions(collection: string, field: PluginField, settings: Record<string, unknown> | undefined): PluginOption[] {
  if (field.user_editable) {
    const own = settings?.[optionsSettingKey(collection, field.key)];
    if (isOptionList(own)) return own;
  }
  return (field.options ?? []).map(normalizeOption);
}

// ─── Records ─────────────────────────────────────────────────────────────────

/** Starting data for a new record: each field's default, then `set` on top. */
export function initialRecordData(c: PluginCollection, set: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of c.fields) {
    if (f.default !== undefined) data[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  }
  return { ...data, ...set };
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/** Required fields still empty in `data`, in file order. */
export function missingFields(c: PluginCollection, data: Record<string, unknown>): PluginField[] {
  return c.fields.filter((f) => !f.optional && isEmpty(data[f.key]));
}

type RuleContext = Omit<EvalContext, 'records'>;

/**
 * Applies the manifest's `rules` to a record being written. A rule fires when
 * the record starts matching its `when` — on create, or when an edit makes it
 * match — so marking a book read stamps `finished_on` once, and editing the
 * book later doesn't move the date. `only_if_empty` leaves set fields alone.
 */
export function applyRules(
  manifest: PluginManifest,
  collection: string,
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  ctx: RuleContext,
): Record<string, unknown> {
  const rules = (manifest.rules ?? []).filter((r) => r.collection === collection);
  if (rules.length === 0) return next;

  const ts = ctx.now;
  const record = (data: Record<string, unknown>) => ({ id: 'r', collection, created_at: ts, occurred_at: ts, day: ctx.today, data });
  const nextEval = createEvaluator(manifest, { ...ctx, records: [record(next)] });
  const prevEval = prev ? createEvaluator(manifest, { ...ctx, records: [record(prev)] }) : undefined;

  const out = { ...next };
  for (const rule of rules) {
    if (nextEval.records(collection, rule.when).length === 0) continue;
    if (prevEval && prevEval.records(collection, rule.when).length > 0) continue;
    for (const [key, v] of Object.entries(rule.set)) {
      if (rule.only_if_empty && !isEmpty(out[key])) continue;
      out[key] = typeof v === 'string' && v.startsWith('$') ? nextEval.value(v) : v;
    }
  }
  return out;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `95` minutes → `1h 35m`. Duration fields hold minutes. */
export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}

/**
 * How a value reads in a stat. `now` is an ISO timestamp, passed in so the
 * output is deterministic. Missing values read `—`.
 */
export function formatStat(v: PluginValue, format: StatFormat = 'number', now: string): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';

  switch (format) {
    case 'number':
      return typeof v === 'number' ? formatNumber(v) : v;
    case 'percent': {
      if (typeof v !== 'number') return v;
      const pct = Math.round(v * 100);
      return `${pct > 0 ? '+' : ''}${pct}%`;
    }
    case 'days':
      return typeof v === 'number' ? plural(v, 'day', 'days') : v;
    case 'duration':
      return typeof v === 'number' ? formatMinutes(v) : v;
    case 'date': {
      if (typeof v !== 'string') return formatNumber(v);
      const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
      return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: v.length === 10 ? 'UTC' : undefined });
    }
    case 'time_ago': {
      if (typeof v !== 'string') return formatNumber(v);
      const then = new Date(v.length === 10 ? `${v}T00:00:00Z` : v).getTime();
      if (Number.isNaN(then)) return v;
      const min = Math.floor((new Date(now).getTime() - then) / 60_000);
      if (min < 1) return 'just now';
      if (min < 60) return `${min}m ago`;
      if (min < 60 * 24) return `${formatMinutes(min)} ago`;
      return `${plural(Math.floor(min / (60 * 24)), 'day', 'days')} ago`;
    }
  }
}
