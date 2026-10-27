import { useMemo, useState, type ReactNode } from 'react';

import {
  addDays,
  fieldLabel,
  localDayOf,
  fieldOptions,
  formatStat,
  initialRecordData,
  type PluginBlock,
  type PluginCollection,
  type PluginEvaluator,
  type PluginManifest,
  type PluginRecord,
  type PluginValue,
  type PluginView as PluginViewSpec,
  type SeriesPoint,
} from '@pomodoso/types/plugins';

import { BreakdownBars, Legend, SeriesChart, YearGrid } from './charts.js';
import { RecordForm, chipStyle } from './RecordForm.js';
import { buttonStyle, cardStyle, labelStyle } from './styles.js';

/** Writes a client performs for a plugin. The client applies `rules` and stamps timestamps. */
export interface PluginActions {
  add(collection: string, data: Record<string, unknown>): void;
  setDay(collection: string, day: string, data: Record<string, unknown>): void;
  update(record: PluginRecord, data: Record<string, unknown>): void;
  remove(record: PluginRecord): void;
  openUrl(url: string): void;
}

export interface PluginEnv {
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  evaluator: PluginEvaluator;
  /** Local today, YYYY-MM-DD. */
  today: string;
  /** ISO timestamp, for "time ago". */
  now: string;
  /** IANA timezone, to put events on their local day (same as the evaluator's). */
  timeZone: string;
  weekStart: number;
  /** Signed out: everything shows, nothing writes. */
  readOnly: boolean;
  actions: PluginActions;
}

type Editing =
  | { mode: 'new'; collection: PluginCollection; initial: Record<string, unknown>; title: string }
  | { mode: 'edit'; collection: PluginCollection; record: PluginRecord }
  | { mode: 'day'; collection: PluginCollection; day: string; initial: Record<string, unknown> };

interface TagFilter {
  field: string;
  tag: string | null;
}

interface BlockCtx extends PluginEnv {
  collection(key: string): PluginCollection | undefined;
  /** `$ref` strings resolve; anything else is a literal. */
  resolve(v: unknown): unknown;
  stat(v: PluginValue, format?: Parameters<typeof formatStat>[1]): string;
  /** A label with its `{$ref}` templates filled in. */
  text(label: string): string;
  tagFilters: Record<string, TagFilter>;
  setTagFilter(collection: string, f: TagFilter): void;
  /** Live records of a collection after the view's tag filter. */
  filtered(collection: string, where?: Parameters<PluginEvaluator['records']>[1]): PluginRecord[];
  edit(e: Editing): void;
}

/** Renders one view of a plugin: its blocks, top to bottom. */
export function PluginView({ env, view }: { env: PluginEnv; view: PluginViewSpec }) {
  const [tagFilters, setTagFilters] = useState<Record<string, TagFilter>>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const collections = useMemo(() => new Map(env.manifest.collections.map((c) => [c.key, c])), [env.manifest]);

  const ctx: BlockCtx = {
    ...env,
    collection: (key) => collections.get(key),
    resolve: (v) => (typeof v === 'string' && v.startsWith('$') ? env.evaluator.value(v) : v),
    stat: (v, format) => formatStat(v, format, env.now),
    text: (label) => env.evaluator.template(label, (v) => formatStat(v, undefined, env.now)),
    tagFilters,
    setTagFilter: (c, f) => setTagFilters((s) => ({ ...s, [c]: f })),
    filtered: (c, where) => {
      const rows = env.evaluator.records(c, where);
      const f = tagFilters[c];
      if (!f?.tag) return rows;
      const c2 = collections.get(c);
      return rows.filter((r) => valuesOf(c2 ? recordValue(c2, r, f.field) : r.data[f.field]).includes(f.tag!));
    },
    edit: (e) => {
      if (!env.readOnly) setEditing(e);
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {view.blocks.map((b, i) => (
        <Block key={i} block={b} ctx={ctx} />
      ))}
      {editing ? <EditSheet editing={editing} ctx={ctx} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** A record's field, or the field's default when the record predates it (as the evaluator reads it). */
function recordValue(c: PluginCollection, r: PluginRecord, key: string): unknown {
  if (key === 'created_at') return r.created_at;
  if (key === 'occurred_at') return r.occurred_at ?? undefined;
  if (key === 'day') return r.day ?? undefined;
  const v = r.data[key];
  return v !== undefined ? v : c.fields.find((f) => f.key === key)?.default;
}

/** A tag-like value as a list: tags and multiselects are lists, a select is one string. */
function valuesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' && v !== '' ? [v] : [];
}

/**
 * A full-form save of a daily record: fields left empty go as null, so the
 * merge in setDay clears them instead of keeping the old value.
 */
function fullDay(c: PluginCollection, data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(c.fields.map((f) => [f.key, data[f.key] ?? null]));
}

function resolveMap(ctx: BlockCtx, map: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const r = ctx.resolve(v);
    if (r !== null && r !== undefined) out[k] = r;
  }
  return out;
}

function Block({ block: b, ctx }: { block: PluginBlock; ctx: BlockCtx }): ReactNode {
  switch (b.type) {
    case 'counter-button': {
      const c = ctx.collection(b.adds);
      if (!c) return null;
      const initial = initialRecordData(c, resolveMap(ctx, b.set));
      return (
        <button
          type="button"
          disabled={ctx.readOnly}
          onClick={() => (b.details === 'form' ? ctx.edit({ mode: 'new', collection: c, initial, title: ctx.text(b.label) }) : ctx.actions.add(c.key, initial))}
          style={{ ...buttonStyle('primary'), padding: '12px', fontSize: 14, opacity: ctx.readOnly ? 0.5 : 1 }}
        >
          + {ctx.text(b.label)}
        </button>
      );
    }

    case 'add-button': {
      const c = ctx.collection(b.adds);
      if (!c) return null;
      return (
        <button
          type="button"
          disabled={ctx.readOnly}
          onClick={() => ctx.edit({ mode: 'new', collection: c, initial: initialRecordData(c, resolveMap(ctx, b.prefill)), title: ctx.text(b.label) })}
          style={{ ...buttonStyle('secondary'), opacity: ctx.readOnly ? 0.5 : 1 }}
        >
          + {ctx.text(b.label)}
        </button>
      );
    }

    case 'form':
      return <InlineForm collectionKey={b.collection} ctx={ctx} />;

    case 'stat':
      return (
        <div style={cardStyle}>
          <div style={labelStyle}>{ctx.text(b.label)}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginTop: 2 }}>{ctx.stat(ctx.evaluator.value(b.value), b.format)}</div>
        </div>
      );

    case 'stat-row':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${b.items.length}, 1fr)`, gap: 6 }}>
          {b.items.map((it, i) => (
            <div key={i} style={{ ...cardStyle, padding: '8px 10px' }}>
              <div style={{ ...labelStyle, fontSize: 10 }}>{ctx.text(it.label)}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', marginTop: 2 }}>{ctx.stat(ctx.evaluator.value(it.value), it.format)}</div>
            </div>
          ))}
        </div>
      );

    case 'progress': {
      const v = num(ctx.evaluator.value(b.value)) ?? 0;
      const max = num(ctx.evaluator.value(b.max));
      const pct = max && max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : v > 0 ? 100 : 0;
      const over = max !== undefined && v > max;
      const reached = max !== undefined && v >= max;
      const color = b.invert ? (over ? 'var(--color-accent)' : 'var(--color-success)') : reached ? 'var(--color-success)' : 'var(--color-accent)';
      return (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={labelStyle}>{b.label !== undefined ? ctx.text(b.label) : b.invert ? 'Today' : 'Progress'}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: over && b.invert ? 'var(--color-accent)' : 'var(--color-text)' }}>
              {ctx.stat(v)} <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>/ {max === undefined ? '—' : ctx.stat(max)}</span>
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.2s' }} />
          </div>
        </div>
      );
    }

    case 'chart': {
      const series = ctx.evaluator.value(b.series);
      const reference = b.reference === undefined ? undefined : num(ctx.evaluator.value(b.reference));
      return (
        <div style={cardStyle}>
          {b.label ? <div style={{ ...labelStyle, marginBottom: 6 }}>{ctx.text(b.label)}</div> : null}
          <SeriesChart
            kind={b.kind}
            group={'group' in b.series && b.series.group ? b.series.group : 'day'}
            series={Array.isArray(series) ? (series as SeriesPoint[]) : []}
            reference={reference}
          />
        </div>
      );
    }

    case 'list':
      return <ListBlock block={b} ctx={ctx} />;

    case 'tag-filter': {
      const c = ctx.collection(b.collection);
      if (!c) return null;
      const all = new Set<string>();
      for (const r of ctx.evaluator.records(b.collection)) for (const t of valuesOf(recordValue(c, r, b.field))) all.add(t);
      if (all.size === 0) return null;
      const current = ctx.tagFilters[b.collection]?.tag ?? null;
      const pick = (tag: string | null) => ctx.setTagFilter(b.collection, { field: b.field, tag });
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <button type="button" onClick={() => pick(null)} style={chipStyle(current === null)}>All</button>
          {[...all].sort().map((t) => (
            <button key={t} type="button" onClick={() => pick(current === t ? null : t)} style={chipStyle(current === t)}>
              {t}
            </button>
          ))}
        </div>
      );
    }

    case 'board':
      return <BoardBlock block={b} ctx={ctx} />;

    case 'year-grid': {
      const c = ctx.collection(b.collection);
      if (!c) return null;
      const field = b.color_by ? c.fields.find((f) => f.key === b.color_by) : undefined;
      const options = field ? fieldOptions(c.key, field, ctx.settings) : [];
      const colors = new Map(options.map((o) => [o.value, o.color]));
      // Daily records carry their day; events land on the local day they happened.
      const dayOfRecord = (r: PluginRecord) => (c.kind === 'daily' ? r.day : r.occurred_at ? localDayOf(r.occurred_at, ctx.timeZone) : undefined);
      const byDay = new Map<string, PluginRecord>();
      for (const r of ctx.evaluator.records(c.key)) {
        const d = dayOfRecord(r);
        if (d) byDay.set(d, r);
      }
      const year = Number(ctx.today.slice(0, 4));
      return (
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 6 }}>{year}</div>
          <YearGrid
            year={year}
            weekStart={ctx.weekStart}
            today={ctx.today}
            colorOf={(day) => {
              const r = byDay.get(day);
              if (!r) return undefined;
              if (!b.color_by) return 'var(--color-accent)';
              return colors.get(String(recordValue(c, r, b.color_by))) ?? 'var(--color-accent)';
            }}
            onPick={
              c.kind === 'daily' && !ctx.readOnly
                ? (day) => ctx.edit({ mode: 'day', collection: c, day, initial: initialRecordData(c, byDay.get(day)?.data) })
                : undefined
            }
          />
          {b.legend && options.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Legend options={options} />
            </div>
          ) : null}
        </div>
      );
    }

    case 'day-picker':
      return <DayPicker block={b} ctx={ctx} />;

    case 'breakdown': {
      const c = ctx.collection(b.collection);
      const field = c?.fields.find((f) => f.key === b.field);
      if (!c || !field) return null;
      // Tags declare no options: the bars are the tags the records use.
      const options =
        field.type === 'tags'
          ? [...new Set(ctx.evaluator.records(c.key).flatMap((r) => valuesOf(recordValue(c, r, field.key))))].sort().map((t) => ({ value: t, label: t }))
          : fieldOptions(c.key, field, ctx.settings);
      const rows = options.map((option) => ({
        option,
        count: num(ctx.evaluator.value({ count: c.key, where: { [field.key]: option.value }, ...(b.range ? { range: b.range } : {}) })) ?? 0,
      }));
      return (
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>{fieldLabel(field)}</div>
          <BreakdownBars rows={rows} />
        </div>
      );
    }

    case 'text':
      return (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap' }}>
          {ctx.evaluator.template(b.text, (v) => ctx.stat(v))}
        </p>
      );
  }
}

function num(v: PluginValue): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ─── Blocks with state ───────────────────────────────────────────────────────

function InlineForm({ collectionKey, ctx }: { collectionKey: string; ctx: BlockCtx }) {
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);
  const c = ctx.collection(collectionKey);
  if (!c) return null;
  // A daily form edits today's record, so it starts from what's saved.
  const todays = c.kind === 'daily' ? ctx.evaluator.records(c.key).find((r) => r.day === ctx.today) : undefined;
  return (
    <div style={cardStyle}>
      <RecordForm
        key={`${round}:${todays?.id ?? ''}`}
        collection={c}
        settings={ctx.settings}
        initial={initialRecordData(c, todays?.data)}
        submitLabel={saved ? 'Saved ✓' : 'Save'}
        disabled={ctx.readOnly}
        onSubmit={(data) => {
          if (c.kind === 'daily') ctx.actions.setDay(c.key, ctx.today, fullDay(c, data));
          else ctx.actions.add(c.key, data);
          setRound((n) => n + 1);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      />
    </div>
  );
}

/** A record's field as short text: option labels for selects, joined tags, formatted numbers. */
function displayValue(ctx: BlockCtx, c: PluginCollection, key: string, r: PluginRecord): string {
  const f = c.fields.find((x) => x.key === key);
  const v = recordValue(c, r, key);
  if (v === undefined || v === null || v === '') return '';
  if (f && (f.type === 'select' || f.type === 'multiselect')) {
    const labels = new Map(fieldOptions(c.key, f, ctx.settings).map((o) => [o.value, o.label]));
    return (Array.isArray(v) ? v : [v]).map((x) => labels.get(String(x)) ?? String(x)).join(', ');
  }
  if (f?.type === 'rating' && typeof v === 'number') return '★'.repeat(Math.max(0, Math.min(10, Math.round(v))));
  if (f?.type === 'duration') return ctx.stat(v as PluginValue, 'duration');
  if (f?.type === 'date') return ctx.stat(v as PluginValue, 'date');
  if (f?.type === 'boolean') return v ? fieldLabel(f) : '';
  return ctx.stat(v as PluginValue);
}

function sortRecords(c: PluginCollection, rows: PluginRecord[], sort: { field: string; order?: 'asc' | 'desc' | undefined } | undefined): PluginRecord[] {
  const field = sort?.field ?? 'created_at';
  const dir = (sort?.order ?? (sort ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const key = (r: PluginRecord): string | number => {
    const v = recordValue(c, r, field);
    return typeof v === 'number' ? v : typeof v === 'string' ? v.toLowerCase() : '';
  };
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

function ListBlock({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'list' }>; ctx: BlockCtx }) {
  const c = ctx.collection(b.collection);
  if (!c) return null;
  const rows = sortRecords(c, ctx.filtered(c.key, b.filter), b.sort);
  if (rows.length === 0) return <Empty>Nothing here yet.</Empty>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }}>
      {rows.map((r, i) => {
        const url = b.open ? recordValue(c, r, b.open) : undefined;
        const primary = displayValue(ctx, c, b.primary, r) || 'Untitled';
        const secondary = (b.secondary ?? []).map((k) => displayValue(ctx, c, k, r)).filter(Boolean).join(' · ');
        return (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderTop: i === 0 ? 'none' : '1px solid var(--color-border)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {typeof url === 'string' && url ? (
                <a
                  href={url}
                  onClick={(e) => {
                    e.preventDefault();
                    ctx.actions.openUrl(url);
                  }}
                  style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={url}
                >
                  {primary}
                </a>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</div>
              )}
              {secondary ? <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 1 }}>{secondary}</div> : null}
            </div>
            {b.swipe && !ctx.readOnly ? (
              <button type="button" onClick={() => ctx.actions.update(r, { ...r.data, ...resolveMap(ctx, b.swipe!.set) })} style={{ ...chipStyle(false), flexShrink: 0 }}>
                {b.swipe.label !== undefined ? ctx.text(b.swipe.label) : 'Done'}
              </button>
            ) : null}
            {!ctx.readOnly ? <EditButton onClick={() => ctx.edit({ mode: 'edit', collection: c, record: r })} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function BoardBlock({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'board' }>; ctx: BlockCtx }) {
  const c = ctx.collection(b.collection);
  const groupField = c?.fields.find((f) => f.key === b.group_by);
  if (!c || !groupField) return null;
  const rows = sortRecords(c, ctx.filtered(c.key), undefined);
  const groups = fieldOptions(c.key, groupField, ctx.settings);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {groups.map((g) => {
        const cards = rows.filter((r) => recordValue(c, r, groupField.key) === g.value);
        return (
          <section key={g.value}>
            <div style={{ ...labelStyle, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              {g.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color }} /> : null}
              {g.label}
              <span style={{ color: 'var(--color-text-faint)', fontWeight: 400 }}>{cards.length}</span>
            </div>
            {cards.length === 0 ? null : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cards.map((r) => {
                  const image = b.card.image ? recordValue(c, r, b.card.image) : undefined;
                  const subtitle = b.card.subtitle ? displayValue(ctx, c, b.card.subtitle, r) : '';
                  const badge = b.card.badge ? displayValue(ctx, c, b.card.badge, r) : '';
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => ctx.edit({ mode: 'edit', collection: c, record: r })}
                      style={{ ...cardStyle, padding: '6px 8px', display: 'flex', gap: 8, alignItems: 'center', textAlign: 'left', cursor: ctx.readOnly ? 'default' : 'pointer', fontFamily: 'inherit' }}
                    >
                      {typeof image === 'string' && /^https:\/\//.test(image) ? (
                        <img src={image} alt="" referrerPolicy="no-referrer" style={{ width: 26, height: 38, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                      ) : null}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayValue(ctx, c, b.card.title, r) || 'Untitled'}
                        </span>
                        {subtitle ? <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-faint)' }}>{subtitle}</span> : null}
                      </span>
                      {badge ? <span style={{ fontSize: 10, color: 'var(--color-warning)', flexShrink: 0 }}>{badge}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
      {rows.length === 0 ? <Empty>Nothing here yet.</Empty> : null}
    </div>
  );
}

function DayPicker({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'day-picker' }>; ctx: BlockCtx }) {
  const [day, setDay] = useState(ctx.today);
  const c = ctx.collection(b.collection);
  const field = c?.fields.find((f) => f.key === b.field);
  if (!c || !field) return null;
  const current = ctx.evaluator.records(c.key).find((r) => r.day === day)?.data[field.key];
  const label = day === ctx.today ? 'Today' : day === addDays(ctx.today, -1) ? 'Yesterday' : ctx.stat(day, 'date');
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <button type="button" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} style={buttonStyle('ghost')}>‹</button>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
        <button type="button" aria-label="Next day" disabled={day >= ctx.today} onClick={() => setDay(addDays(day, 1))} style={{ ...buttonStyle('ghost'), opacity: day >= ctx.today ? 0.3 : 1 }}>›</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
        {fieldOptions(c.key, field, ctx.settings).map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={ctx.readOnly}
            onClick={() => ctx.actions.setDay(c.key, day, { [field.key]: o.value })}
            style={{ ...chipStyle(current === o.value, o.color), opacity: ctx.readOnly ? 0.6 : 1 }}
          >
            {o.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: o.color, marginRight: 5 }} /> : null}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Editing ─────────────────────────────────────────────────────────────────

function EditSheet({ editing, ctx, onClose }: { editing: Editing; ctx: BlockCtx; onClose: () => void }) {
  const c = editing.collection;
  const title = editing.mode === 'new' ? editing.title : editing.mode === 'day' ? ctx.stat(editing.day, 'date') : 'Edit';
  const initial = editing.mode === 'edit' ? editing.record.data : editing.initial;
  return (
    <div
      role="dialog"
      aria-label={title}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', padding: '14px', width: '100%', maxHeight: '85%', overflowY: 'auto', boxSizing: 'border-box' }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>{title}</div>
        <RecordForm
          collection={c}
          settings={ctx.settings}
          initial={initial}
          submitLabel={editing.mode === 'new' ? 'Add' : 'Save'}
          disabled={ctx.readOnly}
          onCancel={onClose}
          onDelete={
            editing.mode === 'edit'
              ? () => {
                  ctx.actions.remove(editing.record);
                  onClose();
                }
              : undefined
          }
          onSubmit={(data) => {
            if (editing.mode === 'edit') ctx.actions.update(editing.record, data);
            else if (editing.mode === 'day') ctx.actions.setDay(c.key, editing.day, fullDay(c, data));
            else if (c.kind === 'daily') ctx.actions.setDay(c.key, ctx.today, fullDay(c, data));
            else ctx.actions.add(c.key, data);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Edit" onClick={onClick} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', padding: 2, flexShrink: 0 }}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 2.5l2.5 2.5L6 12.5H3.5V10z" />
      </svg>
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center', padding: '12px 0' }}>{children}</div>;
}
