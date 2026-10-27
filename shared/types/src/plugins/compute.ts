// The computed-value engine: turns a manifest's `computed` entries, `$refs`
// and `{$x}` templates into values over the plugin's records.
//
// Pure and deterministic: "today", the timezone and the install day all come
// in through the context, so every client computes the same numbers and tests
// can pin the clock. Nothing here knows about Dexie, SQLite or React.

import { COMPUTED_OPS, type CollectionKind } from './catalog.ts';
import {
  DEFAULT_SERIES_RANGE,
  addDays,
  localDayOf,
  nextPeriod,
  periodStart,
  periodsBetween,
  resolveRange,
  type DayRange,
} from './dates.ts';
import type { ComputedExpr, PluginCollection, PluginManifest, ValueRef, Where } from './manifest.ts';

/** One stored record, as every client keeps it (`plugin_record`). */
export interface PluginRecord {
  id: string;
  collection: string;
  /** Event collections: when it happened. */
  occurred_at?: string | null | undefined;
  /** Daily collections: the day it belongs to (YYYY-MM-DD). */
  day?: string | null | undefined;
  created_at: string;
  updated_at?: string | undefined;
  deleted_at?: string | null | undefined;
  data: Record<string, unknown>;
}

export interface SeriesPoint {
  /** First day of the bucket (YYYY-MM-DD). */
  start: string;
  value: number | null;
}

export type PluginValue = number | string | boolean | null | string[] | SeriesPoint[];

export interface EvalContext {
  /** Local today, YYYY-MM-DD. */
  today: string;
  /** ISO timestamp for `$now`. */
  now: string;
  /** IANA timezone used to turn timestamps into days. */
  timeZone: string;
  /** 0 = Monday … 6 = Sunday, as in the extension's settings. */
  weekStart: number;
  /** Day the plugin was installed: where `taper` starts and how far back `streak` looks. */
  installedOn: string;
  /** User-set values; missing keys fall back to the setting's default. */
  settings?: Record<string, unknown> | undefined;
  records: readonly PluginRecord[];
  /** Active tab, extension only (`$tab.url`, `$tab.title`). */
  tab?: { url?: string | undefined; title?: string | undefined } | undefined;
}

export interface PluginEvaluator {
  /** A `$ref`, a literal number, or an inline computed value, as of today. */
  value(v: ValueRef): PluginValue;
  /** A named entry of the manifest's `computed`, as of today. */
  computed(name: string): PluginValue;
  /** Live (not deleted) records of a collection matching `where`. */
  records(collection: string, where?: Where): PluginRecord[];
  /** Replaces each `{$name}` with `format(value)`. */
  template(text: string, format?: (v: PluginValue, name: string) => string): string;
}

const TEMPLATE_REF = /\{\$([a-z][a-z0-9_.]*)\}/g;

function defaultFormat(v: PluginValue): string {
  if (v === null) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean).join(', ');
  return String(v);
}

export function createEvaluator(manifest: PluginManifest, ctx: EvalContext): PluginEvaluator {
  const collections = new Map(manifest.collections.map((c) => [c.key, c]));
  const byCollection = new Map<string, PluginRecord[]>();
  for (const r of ctx.records) {
    if (r.deleted_at) continue;
    const list = byCollection.get(r.collection);
    if (list) list.push(r);
    else byCollection.set(r.collection, [r]);
  }

  // ─── Record helpers ────────────────────────────────────────────────────────

  const dayCache = new WeakMap<PluginRecord, string>();

  /** The timestamp/day a record is ordered and ranged by when no `by` is given. */
  function anchor(r: PluginRecord, kind: CollectionKind): string {
    if (kind === 'event') return r.occurred_at ?? r.created_at;
    if (kind === 'daily') return r.day ?? r.created_at.slice(0, 10);
    return r.created_at;
  }

  /** Built-in date fields of a collection kind; any other key is a declared field (an item may declare `day`). */
  const BUILTIN_DATES: Record<CollectionKind, readonly string[]> = {
    event: ['occurred_at', 'created_at', 'updated_at'],
    item: ['created_at', 'updated_at'],
    daily: ['day', 'created_at', 'updated_at'],
  };

  function dayOf(r: PluginRecord, c: PluginCollection, by?: string): string | undefined {
    if (by !== undefined && !BUILTIN_DATES[c.kind].includes(by)) {
      const v = fieldValue(r, c, by);
      return typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : undefined;
    }
    if (by === undefined) {
      const cached = dayCache.get(r);
      if (cached !== undefined) return cached;
    }
    const raw = by === undefined ? anchor(r, c.kind) : by === 'day' ? r.day : (r[by as 'created_at'] ?? undefined);
    if (raw === null || raw === undefined) return undefined;
    const day = raw.length === 10 ? raw : localDayOf(raw, ctx.timeZone);
    if (by === undefined) dayCache.set(r, day);
    return day;
  }

  /** A field's value on a record; records written before a field existed read its default. */
  function fieldValue(r: PluginRecord, c: PluginCollection, key: string): unknown {
    if (BUILTIN_DATES[c.kind].includes(key)) {
      if (key === 'occurred_at') return r.occurred_at ?? undefined;
      if (key === 'created_at') return r.created_at;
      if (key === 'updated_at') return r.updated_at;
      return r.day ?? undefined;
    }
    const v = r.data[key];
    if (v !== undefined) return v;
    return c.fields.find((f) => f.key === key)?.default;
  }

  function isEmpty(v: unknown): boolean {
    return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  }

  function compare(a: unknown, b: unknown): number | undefined {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    return undefined;
  }

  function matches(r: PluginRecord, c: PluginCollection, where: Where, asOf: string): boolean {
    for (const [key, cond] of Object.entries(where)) {
      const v = fieldValue(r, c, key);
      if (cond !== null && typeof cond === 'object') {
        if (cond.exists !== undefined && cond.exists === isEmpty(v)) return false;
        if (cond.in !== undefined) {
          const options = cond.in.map((x) => resolveLiteral(x, asOf));
          const hit = Array.isArray(v) ? v.some((x) => options.includes(x)) : options.includes(v as never);
          if (!hit) return false;
        }
        const checks: [unknown, (d: number) => boolean][] = [
          [cond.lt, (d) => d < 0],
          [cond.lte, (d) => d <= 0],
          [cond.gt, (d) => d > 0],
          [cond.gte, (d) => d >= 0],
        ];
        for (const [bound, ok] of checks) {
          if (bound === undefined) continue;
          const d = compare(v, resolveLiteral(bound, asOf));
          if (d === undefined || !ok(d)) return false;
        }
      } else {
        const want = resolveLiteral(cond, asOf);
        if (Array.isArray(v) ? !v.includes(want) : v !== want) return false;
      }
    }
    return true;
  }

  function select(collection: string, where: Where | undefined, range: DayRange | undefined, by: string | undefined, asOf: string) {
    const c = collections.get(collection);
    if (!c) return { c: undefined, rows: [] as PluginRecord[] };
    const rows = (byCollection.get(collection) ?? []).filter((r) => {
      if (where && !matches(r, c, where, asOf)) return false;
      if (range) {
        const d = dayOf(r, c, by);
        if (d === undefined || d > range.end || (range.start !== undefined && d < range.start)) return false;
      }
      return true;
    });
    return { c, rows };
  }

  // ─── References ────────────────────────────────────────────────────────────

  const settingDefaults = new Map((manifest.settings ?? []).map((s) => [s.key, s.default]));
  const memo = new Map<string, PluginValue>();
  const inProgress = new Set<string>();

  function resolveRef(ref: string, asOf: string): PluginValue {
    const name = ref.startsWith('$') ? ref.slice(1) : ref;
    if (name === 'today_date') return asOf;
    if (name === 'now') return ctx.now;
    if (name === 'tab.url') return ctx.tab?.url ?? null;
    if (name === 'tab.title') return ctx.tab?.title ?? null;
    if (settingDefaults.has(name)) {
      const v = ctx.settings?.[name] ?? settingDefaults.get(name);
      return v === undefined ? null : (v as PluginValue);
    }
    const expr = manifest.computed?.[name];
    if (expr === undefined) return null;
    const key = `${name}@${asOf}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    // Validation rejects cycles; this only keeps a hand-built manifest from recursing forever.
    if (inProgress.has(key)) return null;
    inProgress.add(key);
    const v = evaluate(expr, asOf);
    inProgress.delete(key);
    memo.set(key, v);
    return v;
  }

  function resolveLiteral(v: unknown, asOf: string): unknown {
    return typeof v === 'string' && v.startsWith('$') ? resolveRef(v, asOf) : v;
  }

  function valueAt(v: ValueRef, asOf: string): PluginValue {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return resolveRef(v, asOf);
    return evaluate(v, asOf);
  }

  function numberAt(v: ValueRef | undefined, asOf: string): number | undefined {
    if (v === undefined) return undefined;
    const x = valueAt(v, asOf);
    return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
  }

  // ─── Operators ─────────────────────────────────────────────────────────────

  function aggregate(op: 'count' | 'sum' | 'avg' | 'min' | 'max', rows: PluginRecord[], c: PluginCollection, field: string | undefined): number | null {
    if (op === 'count') return rows.length;
    const nums = rows.map((r) => fieldValue(r, c, field!)).filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (nums.length === 0) return null;
    if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    // A loop, not Math.min(...nums): spreading a long history can exceed the argument limit.
    return nums.reduce((a, b) => (op === 'min' ? Math.min(a, b) : Math.max(a, b)));
  }

  function evaluate(e: ComputedExpr, asOf: string): PluginValue {
    const op = COMPUTED_OPS.find((o) => o in e)!;
    switch (op) {
      case 'count':
      case 'sum':
      case 'avg':
      case 'min':
      case 'max': {
        const x = e as { where?: Where; range?: string; by?: string; group?: 'day' | 'week' | 'month'; field?: string } & Record<string, unknown>;
        const collection = x[op] as string;
        if (x.group !== undefined) {
          const range = resolveRange(x.range ?? DEFAULT_SERIES_RANGE[x.group], asOf, ctx.weekStart);
          const { c, rows } = select(collection, x.where, range, x.by, asOf);
          if (!c) return [];
          const buckets = new Map<string, PluginRecord[]>();
          for (const r of rows) {
            const start = periodStart(dayOf(r, c, x.by)!, x.group, ctx.weekStart);
            const bucket = buckets.get(start);
            if (bucket) bucket.push(r);
            else buckets.set(start, [r]);
          }
          const first = periodStart(range.start ?? earliestDay(collection, x.by) ?? asOf, x.group, ctx.weekStart);
          const series: SeriesPoint[] = [];
          for (let s = first; s <= range.end; s = nextPeriod(s, x.group)) {
            series.push({ start: s, value: aggregate(op, buckets.get(s) ?? [], c, x.field) });
          }
          return series;
        }
        const range = x.range !== undefined ? resolveRange(x.range, asOf, ctx.weekStart) : undefined;
        const { c, rows } = select(collection, x.where, range, x.by, asOf);
        return c ? aggregate(op, rows, c, x.field) : null;
      }

      case 'last':
      case 'first': {
        const x = e as { where?: Where; field?: string } & Record<string, unknown>;
        const { c, rows } = select(x[op] as string, x.where, { end: asOf }, undefined, asOf);
        if (!c || rows.length === 0) return null;
        // Days compare as text; timestamps as instants, since offsets may differ.
        const time = (r: PluginRecord) => (c.kind === 'daily' ? 0 : Date.parse(anchor(r, c.kind)));
        const before = (a: PluginRecord, b: PluginRecord) =>
          c.kind === 'daily' ? anchor(a, c.kind) < anchor(b, c.kind) : time(a) < time(b);
        let r = rows[0]!;
        // Ties go to the later-stored record for `last`, the earlier one for `first`.
        for (const x of rows) if (op === 'last' ? !before(x, r) : before(x, r)) r = x;
        if (x.field === undefined) return anchor(r, c.kind);
        const v = fieldValue(r, c, x.field);
        return v === undefined ? null : (v as PluginValue);
      }

      case 'streak':
        return streak(e as Extract<ComputedExpr, { streak: string }>, asOf);

      case 'taper': {
        const t = (e as Extract<ComputedExpr, { taper: unknown }>).taper;
        const from = numberAt(t.from, asOf);
        const step = numberAt(t.down_by ?? t.up_by, asOf);
        if (from === undefined || step === undefined) return null;
        const n = Math.max(0, periodsBetween(ctx.installedOn, asOf, t.every, ctx.weekStart));
        let v = t.down_by !== undefined ? from - step * n : from + step * n;
        const min = numberAt(t.min, asOf);
        const max = numberAt(t.max, asOf);
        if (min !== undefined) v = Math.max(min, v);
        if (max !== undefined) v = Math.min(max, v);
        return v;
      }

      case 'delta': {
        const [a, b] = (e as Extract<ComputedExpr, { delta: unknown }>).delta;
        const x = numberAt(a, asOf);
        const y = numberAt(b, asOf);
        if (x === undefined || y === undefined || y === 0) return null;
        return (x - y) / y;
      }
    }
  }

  function earliestDay(collection: string, by: string | undefined): string | undefined {
    const c = collections.get(collection);
    if (!c) return undefined;
    let min: string | undefined;
    for (const r of byCollection.get(collection) ?? []) {
      const d = dayOf(r, c, by);
      if (d !== undefined && (min === undefined || d < min)) min = d;
    }
    return min;
  }

  /**
   * Consecutive days, ending today, whose record count is within
   * [at_least, at_most]. Defaults: at_least 1, or 0 when only at_most is set
   * ("days under the limit"). Bounds are evaluated per day, so a limit that
   * tapers week by week is checked against that week's value.
   *
   * Today counts only once it qualifies, but a today that hasn't reached its
   * minimum yet doesn't break the run — the day isn't over. Going over a
   * maximum does break it: that can't be undone later today.
   * Days before the plugin was installed never count.
   */
  function streak(e: Extract<ComputedExpr, { streak: string }>, asOf: string): number {
    const c = collections.get(e.streak);
    if (!c) return 0;
    const perDay = new Map<string, number>();
    for (const r of byCollection.get(e.streak) ?? []) {
      if (e.where && !matches(r, c, e.where, asOf)) continue;
      const d = dayOf(r, c);
      if (d !== undefined) perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const check = (day: string): 'ok' | 'short' | 'over' => {
      const n = perDay.get(day) ?? 0;
      const atMost = numberAt(e.at_most, day);
      const atLeast = numberAt(e.at_least, day) ?? (e.at_most !== undefined ? 0 : 1);
      if (atMost !== undefined && n > atMost) return 'over';
      return n >= atLeast ? 'ok' : 'short';
    };

    let day = asOf;
    let count = 0;
    const todayState = check(day);
    if (todayState === 'over') return 0;
    if (todayState === 'ok') count = 1;
    day = addDays(day, -1);
    while (day >= ctx.installedOn && check(day) === 'ok') {
      count++;
      day = addDays(day, -1);
    }
    return count;
  }

  // ─── Public surface ────────────────────────────────────────────────────────

  return {
    value: (v) => valueAt(v, ctx.today),
    computed: (name) => resolveRef(name, ctx.today),
    records: (collection, where) => select(collection, where, undefined, undefined, ctx.today).rows,
    template: (text, format = defaultFormat) =>
      text.replace(TEMPLATE_REF, (_, name: string) => format(resolveRef(name, ctx.today), name)),
  };
}
