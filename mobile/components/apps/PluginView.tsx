import {
  addDays,
  fieldLabel,
  fieldOptions,
  formatStat,
  initialRecordData,
  localDayOf,
  recordTitle,
  templateFormat,
  type PluginBlock,
  type PluginCollection,
  type PluginEvaluator,
  type PluginField,
  type PluginManifest,
  type PluginRecord,
  type PluginValue,
  type PluginView as PluginViewSpec,
  type SeriesPoint,
  type Where,
} from '@pomodoso/types/plugins';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors } from '@/constants/theme';

import { BreakdownBars, Button, Chip, DotGrid, DotRing, Legend, progressUnits, SeriesChart, ui, YearGrid } from './primitives';
import { RecordForm, type FieldChoice } from './RecordForm';

// The native counterpart of @pomodoso/ui's PluginView: one view of an app,
// its blocks top to bottom. The logic is the web renderer's, line for line
// where it can be, so an app behaves the same everywhere; only the drawing
// differs. Kept in step with shared/ui/src/plugins/PluginView.tsx: a block
// added there needs its case here.

export interface PluginActions {
  add(collection: string, data: Record<string, unknown>, opts?: { occurredAt?: string | undefined }): void | Promise<unknown>;
  setDay(collection: string, day: string, data: Record<string, unknown>): void | Promise<unknown>;
  update(record: PluginRecord, data: Record<string, unknown>, opts?: { occurredAt?: string | undefined }): void | Promise<unknown>;
  remove(record: PluginRecord): void | Promise<unknown>;
  openUrl(url: string): void;
}

export interface PluginEnv {
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  evaluator: PluginEvaluator;
  today: string;
  now: string;
  timeZone: string;
  weekStart: number;
  /** Signed out: everything shows, nothing writes. */
  readOnly: boolean;
  actions: PluginActions;
  openRecord?: ((viewId: string, recordId: string) => void) | undefined;
  tasks?: { list(): FieldChoice[]; title(id: string): string | undefined } | undefined;
}

type Editing =
  | { mode: 'new'; collection: PluginCollection; initial: Record<string, unknown>; title: string }
  | { mode: 'edit'; collection: PluginCollection; record: PluginRecord }
  | { mode: 'day'; collection: PluginCollection; day: string; initial: Record<string, unknown> };

type TagFilters = Record<string, Record<string, string | null>>;

interface BlockCtx extends PluginEnv {
  collection(key: string): PluginCollection | undefined;
  resolve(v: unknown): unknown;
  stat(v: PluginValue, format?: Parameters<typeof formatStat>[1]): string;
  text(label: string): string;
  tagFilters: TagFilters;
  setTagFilter(collection: string, field: string, tag: string | null): void;
  filtered(collection: string, where?: Parameters<PluginEvaluator['records']>[1]): PluginRecord[];
  edit(e: Editing): void;
  choices(field: PluginField): FieldChoice[] | undefined;
  /** Inner width of a card, for charts and grids. */
  width: number;
}

export function PluginView({ env: outer, view, record }: { env: PluginEnv; view: PluginViewSpec; record?: string | undefined }): React.JSX.Element {
  const [tagFilters, setTagFilters] = useState<TagFilters>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const { width: screen } = useWindowDimensions();
  const collections = useMemo(() => new Map(outer.manifest.collections.map(c => [c.key, c])), [outer.manifest]);
  const evaluator = useMemo(() => (record ? outer.evaluator.forRecord(record) : outer.evaluator), [outer.evaluator, record]);
  const env: PluginEnv = { ...outer, evaluator };

  const ctx: BlockCtx = {
    ...env,
    // Screen padding (20 each side) and card padding (14 each side).
    width: Math.max(160, screen - 40 - 28),
    collection: key => collections.get(key),
    resolve: v => (typeof v === 'string' && v.startsWith('$') ? env.evaluator.value(v) : v),
    stat: (v, format) => formatStat(v, format, env.now),
    text: label => env.evaluator.template(label, templateFormat(env.manifest, env.now)),
    tagFilters,
    setTagFilter: (c, field, tag) => setTagFilters(s => ({ ...s, [c]: { ...s[c], [field]: tag } })),
    filtered: (c, where) => {
      const rows = env.evaluator.records(c, where);
      const spec = collections.get(c);
      const active = Object.entries(tagFilters[c] ?? {}).filter((e): e is [string, string] => e[1] !== null);
      if (!spec || active.length === 0) return rows;
      return rows.filter(r => active.every(([field, tag]) => valuesOf(recordValue(spec, r, field)).includes(tag)));
    },
    edit: e => {
      if (!env.readOnly) setEditing(e);
    },
    choices: f => {
      if (f.type === 'task') return env.tasks?.list();
      if (f.type !== 'ref' || !f.collection) return [];
      return env.evaluator.records(f.collection).map(r => ({ value: r.id, label: recordTitle(env.manifest, r) }));
    },
  };

  return (
    <View style={{ gap: 12 }}>
      {view.blocks.map((b, i) => (
        <Block key={i} block={b} ctx={ctx} />
      ))}
      <EditSheet editing={editing} ctx={ctx} onClose={() => setEditing(null)} />
    </View>
  );
}

function recordValue(c: PluginCollection, r: PluginRecord, key: string): unknown {
  if (key === 'created_at') return r.created_at;
  if (key === 'updated_at') return r.updated_at;
  if (key === 'occurred_at' && c.kind === 'event') return r.occurred_at ?? undefined;
  if (key === 'day' && c.kind === 'daily') return r.day ?? undefined;
  const v = r.data[key];
  return v !== undefined ? v : c.fields.find(f => f.key === key)?.default;
}

function valuesOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' && v !== '' ? [v] : [];
}

function fullDay(c: PluginCollection, data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(c.fields.map(f => [f.key, data[f.key] ?? null]));
}

function resolveMap(ctx: BlockCtx, map: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map ?? {})) {
    const r = ctx.resolve(v);
    if (r !== null && r !== undefined) out[k] = r;
  }
  return out;
}

function num(v: PluginValue): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function progressStyleOf(v: unknown): 'bar' | 'ring' | 'dots' {
  return v === 'ring' || v === 'dots' ? v : 'bar';
}

export function latestToday(records: readonly PluginRecord[], today: string, timeZone: string): PluginRecord | undefined {
  let best: PluginRecord | undefined;
  for (const r of records) {
    if (!r.occurred_at || localDayOf(r.occurred_at, timeZone) !== today) continue;
    if (!best || r.occurred_at > best.occurred_at!) best = r;
  }
  return best;
}

function Block({ block: b, ctx }: { block: PluginBlock; ctx: BlockCtx }): ReactNode {
  switch (b.type) {
    case 'counter-button': {
      const c = ctx.collection(b.adds);
      if (!c) return null;
      const initial = initialRecordData(c, resolveMap(ctx, b.set));
      const add = (
        <Button
          kind="primary"
          label={`+ ${ctx.text(b.label)}`}
          disabled={ctx.readOnly}
          style={{ flex: 1, paddingVertical: 14 }}
          textStyle={{ fontSize: 16 }}
          onPress={() => (b.details === 'form' ? ctx.edit({ mode: 'new', collection: c, initial, title: ctx.text(b.label) }) : void ctx.actions.add(c.key, initial))}
        />
      );
      if (!b.subtract) return add;
      const last = latestToday(ctx.evaluator.records(c.key), ctx.today, ctx.timeZone);
      return (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {add}
          <Button kind="secondary" label="−" disabled={ctx.readOnly || !last} style={{ paddingHorizontal: 20 }} textStyle={{ fontSize: 18 }} onPress={() => last && void ctx.actions.remove(last)} />
        </View>
      );
    }

    case 'add-button': {
      const c = ctx.collection(b.adds);
      if (!c) return null;
      return (
        <Button
          kind="secondary"
          label={`+ ${ctx.text(b.label)}`}
          disabled={ctx.readOnly}
          onPress={() => ctx.edit({ mode: 'new', collection: c, initial: initialRecordData(c, resolveMap(ctx, b.prefill)), title: ctx.text(b.label) })}
        />
      );
    }

    case 'form':
      return <InlineForm collectionKey={b.collection} ctx={ctx} />;

    case 'stat':
      return (
        <View style={ui.card}>
          <Text style={ui.label}>{ctx.text(b.label)}</Text>
          <Text style={s.big}>{ctx.stat(ctx.evaluator.value(b.value), b.format)}</Text>
        </View>
      );

    case 'stat-row':
      return (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {b.items.map((it, i) => (
            <View key={i} style={[ui.card, { flex: 1, paddingHorizontal: 10, paddingVertical: 10 }]}>
              <Text style={[ui.label, { fontSize: 11 }]} numberOfLines={2}>{ctx.text(it.label)}</Text>
              <Text style={s.medium}>{ctx.stat(ctx.evaluator.value(it.value), it.format)}</Text>
            </View>
          ))}
        </View>
      );

    case 'progress': {
      const v = num(ctx.evaluator.value(b.value)) ?? 0;
      const max = num(ctx.evaluator.value(b.max));
      const pct = max && max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : v > 0 ? 100 : 0;
      const over = max !== undefined && v > max;
      const reached = max !== undefined && v >= max;
      const color = b.invert ? (over ? colors.accent : colors.success) : reached ? colors.success : colors.accent;
      const style = progressStyleOf(ctx.resolve(b.style));
      const alone = b.format === 'share' || b.format === 'percent';
      const label = b.label !== undefined ? ctx.text(b.label) : b.invert ? 'Today' : 'Progress';
      const headline = b.format === 'share' && max ? ctx.stat(v / max, 'share') : ctx.stat(v, b.format);
      const numbers = (
        <Text style={{ fontSize: 15, fontWeight: '700', color: over && b.invert ? colors.accent : colors.text }}>
          {headline}
          {alone ? null : <Text style={{ fontWeight: '400', color: colors.textSecondary }}> / {max === undefined ? '—' : ctx.stat(max, b.format)}</Text>}
        </Text>
      );
      if (style === 'ring') {
        return (
          <View style={[ui.card, { alignItems: 'center', gap: 6 }]}>
            <DotRing fraction={pct / 100} units={progressUnits(max, 120, 60)} size={170}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{alone ? headline : `${Math.round(pct)}%`}</Text>
              <Text style={[ui.label, { fontSize: 11 }]}>{label}</Text>
            </DotRing>
            {alone ? null : numbers}
          </View>
        );
      }
      return (
        <View style={ui.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={ui.label}>{label}</Text>
            {numbers}
          </View>
          {style === 'dots' ? (
            <View style={{ marginTop: 10 }}>
              <DotGrid fraction={pct / 100} units={progressUnits(max, 400, 100)} width={ctx.width} />
            </View>
          ) : (
            <View style={s.track}>
              <View style={{ height: '100%', width: `${pct}%`, backgroundColor: color }} />
            </View>
          )}
        </View>
      );
    }

    case 'chart': {
      const series = ctx.evaluator.value(b.series);
      const reference = b.reference === undefined ? undefined : num(ctx.evaluator.value(b.reference));
      return (
        <View style={ui.card}>
          {b.label ? <Text style={[ui.label, { marginBottom: 6 }]}>{ctx.text(b.label)}</Text> : null}
          <SeriesChart
            kind={b.kind}
            group={'group' in b.series && b.series.group ? b.series.group : 'day'}
            series={Array.isArray(series) ? (series as SeriesPoint[]) : []}
            reference={reference}
            width={ctx.width}
          />
        </View>
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
      const current = ctx.tagFilters[b.collection]?.[b.field] ?? null;
      const pick = (tag: string | null) => ctx.setTagFilter(b.collection, b.field, tag);
      return (
        <View style={s.wrapRow}>
          <Chip label="All" on={current === null} onPress={() => pick(null)} />
          {[...all].sort().map(t => (
            <Chip key={t} label={t} on={current === t} onPress={() => pick(current === t ? null : t)} />
          ))}
        </View>
      );
    }

    case 'board':
      return <BoardBlock block={b} ctx={ctx} />;

    case 'year-grid': {
      const c = ctx.collection(b.collection);
      if (!c) return null;
      const field = b.color_by ? c.fields.find(f => f.key === b.color_by) : undefined;
      const options = field ? fieldOptions(c.key, field, ctx.settings) : [];
      const colorMap = new Map(options.map(o => [o.value, o.color]));
      const dayOfRecord = (r: PluginRecord) => (c.kind === 'daily' ? r.day : r.occurred_at ? localDayOf(r.occurred_at, ctx.timeZone) : undefined);
      const byDay = new Map<string, PluginRecord>();
      for (const r of ctx.evaluator.records(c.key)) {
        const d = dayOfRecord(r);
        if (d) byDay.set(d, r);
      }
      const year = Number(ctx.today.slice(0, 4));
      return (
        <View style={ui.card}>
          <Text style={[ui.label, { marginBottom: 8 }]}>{year}</Text>
          <YearGrid
            year={year}
            weekStart={ctx.weekStart}
            today={ctx.today}
            width={ctx.width}
            colorOf={day => {
              const r = byDay.get(day);
              if (!r) return undefined;
              if (!b.color_by) return colors.accent;
              return colorMap.get(String(recordValue(c, r, b.color_by))) ?? colors.accent;
            }}
            onPick={
              c.kind === 'daily' && !ctx.readOnly
                ? day => ctx.edit({ mode: 'day', collection: c, day, initial: initialRecordData(c, byDay.get(day)?.data) })
                : undefined
            }
          />
          {b.legend && options.length > 0 ? (
            <View style={{ marginTop: 10 }}>
              <Legend options={options} />
            </View>
          ) : null}
        </View>
      );
    }

    case 'day-picker':
      return <DayPicker block={b} ctx={ctx} />;

    case 'breakdown': {
      const c = ctx.collection(b.collection);
      const field = c?.fields.find(f => f.key === b.field);
      if (!c || !field) return null;
      const options =
        field.type === 'tags'
          ? [...new Set(ctx.evaluator.records(c.key).flatMap(r => valuesOf(recordValue(c, r, field.key))))].sort().map(t => ({ value: t, label: t }))
          : fieldOptions(c.key, field, ctx.settings);
      const rows = options.map(option => ({
        option,
        count: num(ctx.evaluator.value({ count: c.key, where: { [field.key]: option.value }, ...(b.range ? { range: b.range } : {}) })) ?? 0,
      }));
      return (
        <View style={ui.card}>
          <Text style={[ui.label, { marginBottom: 10 }]}>{fieldLabel(field)}</Text>
          <BreakdownBars rows={rows} />
        </View>
      );
    }

    case 'text':
      return <Text style={s.text}>{ctx.text(b.text)}</Text>;
  }
}

// ─── Blocks with state ───────────────────────────────────────────────────────

function InlineForm({ collectionKey, ctx }: { collectionKey: string; ctx: BlockCtx }): React.JSX.Element | null {
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState(false);
  const c = ctx.collection(collectionKey);
  if (!c) return null;
  const todays = c.kind === 'daily' ? ctx.evaluator.records(c.key).find(r => r.day === ctx.today) : undefined;
  return (
    <View style={ui.card}>
      <RecordForm
        choices={ctx.choices}
        key={`${round}:${todays?.id ?? ''}:${todays?.updated_at ?? ''}`}
        collection={c}
        settings={ctx.settings}
        initial={initialRecordData(c, todays?.data)}
        submitLabel={saved ? 'Saved ✓' : 'Save'}
        disabled={ctx.readOnly}
        onSubmit={async (data, occurredAt) => {
          if (c.kind === 'daily') await ctx.actions.setDay(c.key, ctx.today, fullDay(c, data));
          else await ctx.actions.add(c.key, data, occurredAt ? { occurredAt } : undefined);
          setRound(n => n + 1);
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      />
    </View>
  );
}

function displayValue(ctx: BlockCtx, c: PluginCollection, key: string, r: PluginRecord): string {
  const f = c.fields.find(x => x.key === key);
  const v = recordValue(c, r, key);
  if (v === undefined || v === null || v === '') return '';
  if (f && (f.type === 'select' || f.type === 'multiselect')) {
    const labels = new Map(fieldOptions(c.key, f, ctx.settings).map(o => [o.value, o.label]));
    return (Array.isArray(v) ? v : [v]).map(x => labels.get(String(x)) ?? String(x)).join(', ');
  }
  if (f?.type === 'rating' && typeof v === 'number') return '★'.repeat(Math.max(0, Math.min(10, Math.round(v))));
  if (f?.type === 'duration') return ctx.stat(v as PluginValue, 'duration');
  if (f?.type === 'date') return ctx.stat(v as PluginValue, 'date');
  if (f?.type === 'boolean') return v ? fieldLabel(f) : '';
  if (f?.type === 'task') return ctx.tasks ? ctx.tasks.title(String(v)) ?? 'Task deleted' : 'Linked task';
  if (f?.type === 'ref') {
    const target = f.collection ? ctx.evaluator.records(f.collection).find(x => x.id === v) : undefined;
    return target ? recordTitle(ctx.manifest, target) : 'Deleted';
  }
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

function ListBlock({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'list' }>; ctx: BlockCtx }): React.JSX.Element | null {
  const c = ctx.collection(b.collection);
  if (!c) return null;
  const rows = sortRecords(c, ctx.filtered(c.key, b.filter), b.sort);
  if (rows.length === 0) return <Text style={ui.empty}>Nothing here yet.</Text>;
  return (
    <View style={s.list}>
      {rows.map((r, i) => {
        const url = b.open ? recordValue(c, r, b.open) : undefined;
        const primary = displayValue(ctx, c, b.primary, r) || 'Untitled';
        const secondary = (b.secondary ?? []).map(k => displayValue(ctx, c, k, r)).filter(Boolean).join(' · ');
        const onTitle =
          typeof url === 'string' && url
            ? () => ctx.actions.openUrl(url)
            : b.opens && ctx.openRecord
              ? () => ctx.openRecord!(b.opens!, r.id)
              : undefined;
        return (
          <View key={r.id} style={[s.listRow, i > 0 && s.listDivider]}>
            <Pressable style={{ flex: 1 }} disabled={!onTitle} onPress={onTitle}>
              <Text style={[s.listTitle, typeof url === 'string' && url ? { color: colors.info } : null]} numberOfLines={1}>
                {primary}
                {b.opens && ctx.openRecord && !(typeof url === 'string' && url) ? <Text style={{ color: colors.textTertiary }}> ›</Text> : null}
              </Text>
              {secondary ? <Text style={s.listMeta} numberOfLines={1}>{secondary}</Text> : null}
            </Pressable>
            {b.swipe && !ctx.readOnly ? (
              <Chip label={b.swipe.label !== undefined ? ctx.text(b.swipe.label) : 'Done'} on={false} onPress={() => void ctx.actions.update(r, { ...r.data, ...resolveMap(ctx, b.swipe!.set) })} />
            ) : null}
            {!ctx.readOnly ? <EditButton onPress={() => ctx.edit({ mode: 'edit', collection: c, record: r })} /> : null}
          </View>
        );
      })}
    </View>
  );
}

function filterFills(ctx: BlockCtx, filter: Where | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (v === null || typeof v === 'object') continue;
    const r = ctx.resolve(v);
    if (r !== null && r !== undefined) out[k] = r;
  }
  return out;
}

/** A board on a phone: the columns stacked, each card with ‹ › to move it to the previous or next column. */
function BoardBlock({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'board' }>; ctx: BlockCtx }): React.JSX.Element | null {
  const c = ctx.collection(b.collection);
  const groupField = c?.fields.find(f => f.key === b.group_by);
  if (!c || !groupField) return null;
  const rows = sortRecords(c, ctx.filtered(c.key, b.filter), undefined);
  const groups = fieldOptions(c.key, groupField, ctx.settings);

  const tap = (r: PluginRecord) => (b.opens && ctx.openRecord ? ctx.openRecord(b.opens, r.id) : ctx.edit({ mode: 'edit', collection: c, record: r }));
  const move = (r: PluginRecord, to: string) => {
    if (recordValue(c, r, groupField.key) !== to) void ctx.actions.update(r, { ...r.data, [groupField.key]: to });
  };
  const addTo = (group: string) =>
    ctx.edit({ mode: 'new', collection: c, title: `Add to ${groups.find(g => g.value === group)?.label ?? group}`, initial: initialRecordData(c, { ...filterFills(ctx, b.filter), [groupField.key]: group }) });

  return (
    <View style={{ gap: 14 }}>
      {groups.map((g, gi) => {
        const cards = rows.filter(r => recordValue(c, r, groupField.key) === g.value);
        return (
          <View key={g.value} style={{ gap: 6 }}>
            <View style={s.groupHeader}>
              {g.color ? <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: g.color }} /> : null}
              <Text style={ui.label}>{g.label}</Text>
              <Text style={{ fontSize: 12, color: colors.textTertiary }}>{cards.length}</Text>
              <View style={{ flex: 1 }} />
              {!ctx.readOnly ? (
                <Pressable onPress={() => addTo(g.value)} hitSlop={8}>
                  <Text style={{ fontSize: 13, color: colors.accent, fontWeight: '600' }}>+ Add</Text>
                </Pressable>
              ) : null}
            </View>
            {cards.map(r => {
              const image = b.card.image ? recordValue(c, r, b.card.image) : undefined;
              const subtitle = b.card.subtitle ? displayValue(ctx, c, b.card.subtitle, r) : '';
              const badge = b.card.badge ? displayValue(ctx, c, b.card.badge, r) : '';
              return (
                <Pressable key={r.id} style={[ui.card, s.boardCard]} onPress={() => tap(r)} disabled={ctx.readOnly && !(b.opens && ctx.openRecord)}>
                  {typeof image === 'string' && /^https:\/\//.test(image) ? <Image source={{ uri: image }} style={s.cover} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={s.listTitle} numberOfLines={2}>{displayValue(ctx, c, b.card.title, r) || 'Untitled'}</Text>
                    {subtitle ? <Text style={s.listMeta}>{subtitle}</Text> : null}
                  </View>
                  {badge ? <Text style={{ fontSize: 12, color: colors.warning }}>{badge}</Text> : null}
                  {!ctx.readOnly ? (
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <MoveButton glyph="‹" to={groups[gi - 1]} onMove={to => move(r, to)} />
                      <MoveButton glyph="›" to={groups[gi + 1]} onMove={to => move(r, to)} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        );
      })}
      {rows.length === 0 ? <Text style={ui.empty}>Nothing here yet.</Text> : null}
    </View>
  );
}

function MoveButton({ glyph, to, onMove }: { glyph: string; to: { value: string; label: string } | undefined; onMove: (to: string) => void }): React.JSX.Element {
  return (
    <Pressable
      disabled={!to}
      onPress={() => to && onMove(to.value)}
      hitSlop={4}
      accessibilityLabel={to ? `Move to ${to.label}` : undefined}
      style={[s.move, !to && { opacity: 0.25 }]}
    >
      <Text style={{ fontSize: 16, color: colors.textSecondary }}>{glyph}</Text>
    </Pressable>
  );
}

function DayPicker({ block: b, ctx }: { block: Extract<PluginBlock, { type: 'day-picker' }>; ctx: BlockCtx }): React.JSX.Element | null {
  const [day, setDay] = useState(ctx.today);
  const c = ctx.collection(b.collection);
  const field = c?.fields.find(f => f.key === b.field);
  if (!c || !field) return null;
  const current = ctx.evaluator.records(c.key).find(r => r.day === day)?.data[field.key];
  const label = day === ctx.today ? 'Today' : day === addDays(ctx.today, -1) ? 'Yesterday' : ctx.stat(day, 'date');
  return (
    <View style={ui.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Button kind="ghost" label="‹" onPress={() => setDay(addDays(day, -1))} />
        <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>{label}</Text>
        <Button kind="ghost" label="›" disabled={day >= ctx.today} onPress={() => setDay(addDays(day, 1))} />
      </View>
      <View style={[s.wrapRow, { justifyContent: 'center' }]}>
        {fieldOptions(c.key, field, ctx.settings).map(o => (
          <Chip key={o.value} label={o.label} color={o.color} on={current === o.value} disabled={ctx.readOnly} onPress={() => void ctx.actions.setDay(c.key, day, { [field.key]: o.value })} />
        ))}
      </View>
    </View>
  );
}

// ─── Editing ─────────────────────────────────────────────────────────────────

function EditSheet({ editing, ctx, onClose }: { editing: Editing | null; ctx: BlockCtx; onClose: () => void }): React.JSX.Element {
  return (
    <Modal visible={editing !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} />
        {editing ? <SheetBody editing={editing} ctx={ctx} onClose={onClose} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SheetBody({ editing, ctx, onClose }: { editing: Editing; ctx: BlockCtx; onClose: () => void }): React.JSX.Element {
  const c = editing.collection;
  const title = editing.mode === 'new' ? editing.title : editing.mode === 'day' ? ctx.stat(editing.day, 'date') : 'Edit';
  const initial = editing.mode === 'edit' ? editing.record.data : editing.initial;
  return (
    <View style={s.sheet}>
      <Text style={s.sheetTitle}>{title}</Text>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <RecordForm
          collection={c}
          settings={ctx.settings}
          choices={ctx.choices}
          initial={initial}
          occurredAt={editing.mode === 'edit' ? editing.record.occurred_at ?? undefined : undefined}
          submitLabel={editing.mode === 'new' ? 'Add' : 'Save'}
          disabled={ctx.readOnly}
          onCancel={onClose}
          onDelete={
            editing.mode === 'edit'
              ? () => {
                  void ctx.actions.remove(editing.record);
                  onClose();
                }
              : undefined
          }
          onSubmit={(data, occurredAt) => {
            const opts = occurredAt ? { occurredAt } : undefined;
            if (editing.mode === 'edit') void ctx.actions.update(editing.record, data, opts);
            else if (editing.mode === 'day') void ctx.actions.setDay(c.key, editing.day, fullDay(c, data));
            else if (c.kind === 'daily') void ctx.actions.setDay(c.key, ctx.today, fullDay(c, data));
            else void ctx.actions.add(c.key, data, opts);
            onClose();
          }}
        />
      </ScrollView>
    </View>
  );
}

function EditButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Edit" style={{ padding: 4 }}>
      <Text style={{ fontSize: 15, color: colors.textTertiary }}>✎</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 2 },
  medium: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  track: { height: 7, backgroundColor: colors.border, borderRadius: 99, marginTop: 8, overflow: 'hidden' },
  text: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 11 },
  listDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  listTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  listMeta: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  boardCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  cover: { width: 30, height: 44, borderRadius: 3 },
  move: { width: 28, height: 28, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '85%' },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 14 },
});
