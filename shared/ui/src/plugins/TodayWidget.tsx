import type { ReactNode } from 'react';

import {
  fieldOptions,
  formatStat,
  initialRecordData,
  templateFormat,
  type PluginEvaluator,
  type PluginManifest,
  type PluginRecord,
  type PluginValue,
} from '@pomodoso/types/plugins';

import { useState } from 'react';

import { PluginIcon } from './PluginIcon.js';
import { YearGrid } from './charts.js';
import { latestToday, progressStyleOf } from './PluginView.js';
import { DotGrid, DotRing, progressUnits } from './progress.js';
import { chipStyle } from './RecordForm.js';
import { cardStyle, labelStyle } from './styles.js';

export interface TodayWidgetProps {
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  evaluator: PluginEvaluator;
  /** Local today, YYYY-MM-DD. */
  today: string;
  /** ISO timestamp, for "time ago". */
  now: string;
  /** IANA timezone, to find today's events (same as the evaluator's). */
  timeZone: string;
  /** First day of the week (0 = Monday), for the year grid. */
  weekStart: number;
  readOnly: boolean;
  add(collection: string, data: Record<string, unknown>): void | Promise<unknown>;
  /** Deletes a record: the mini-counter's − (`subtract: true`). */
  remove(record: PluginRecord): void | Promise<unknown>;
  /** Saves a record's data (the `record` widget's field). */
  update(record: PluginRecord, data: Record<string, unknown>): void | Promise<unknown>;
  setDay(collection: string, day: string, data: Record<string, unknown>): void | Promise<unknown>;
  /** Opens the app's own screen. */
  onOpen(): void;
}

/**
 * A plugin's compact card on Today: one number and its action (or a few
 * numbers, `stats`, across the whole row), sized for half a popup column.
 * Which one comes from the file's `today.widget`.
 */
export function TodayWidget(props: TodayWidgetProps) {
  const { manifest, evaluator, now } = props;
  const w = manifest.today?.widget;
  if (!w) return null;
  const label = evaluator.template(w.label, templateFormat(manifest, now));

  switch (w.type) {
    case 'mini-counter': {
      const v = num(evaluator.value(w.value)) ?? 0;
      const max = w.max === undefined ? undefined : num(evaluator.value(w.max));
      const over = max !== undefined && v > max;
      const c = manifest.collections.find((x) => x.key === w.adds);
      const last = c && w.subtract ? latestToday(evaluator.records(c.key), props.today, props.timeZone) : undefined;
      return (
        <Card {...props} label={label}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 18, fontWeight: 700, color: over ? 'var(--color-accent)' : 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
              {formatStat(v, 'number', now)}
              {max !== undefined ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}> / {formatStat(max, 'number', now)}</span> : null}
            </span>
            {c && w.subtract ? (
              <button
                type="button"
                aria-label={`Remove the last one from ${label}`}
                title="Remove the last one from today"
                disabled={props.readOnly || !last}
                onClick={(e) => {
                  e.stopPropagation();
                  if (last) void props.remove(last);
                }}
                style={{ width: 28, height: 28, borderRadius: 99, border: '1px solid var(--color-border-strong)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 16, fontWeight: 700, cursor: last ? 'pointer' : 'default', flexShrink: 0, opacity: props.readOnly || !last ? 0.4 : 1 }}
              >
                −
              </button>
            ) : null}
            {c ? (
              <button
                type="button"
                aria-label={`Add to ${label}`}
                disabled={props.readOnly}
                onClick={(e) => {
                  e.stopPropagation();
                  void props.add(c.key, initialRecordData(c));
                }}
                style={{ width: 28, height: 28, borderRadius: 99, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', flexShrink: 0, opacity: props.readOnly ? 0.5 : 1 }}
              >
                +
              </button>
            ) : null}
          </div>
          {max !== undefined && max > 0 ? (
            <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: over ? 'var(--color-accent)' : 'var(--color-success)' }} />
            </div>
          ) : null}
        </Card>
      );
    }

    case 'select-today':
      return <SelectToday {...props} widget={w} label={label} />;

    case 'record':
      return <RecordCard {...props} widget={w} label={label} />;

    case 'count-badge':
    case 'stat': {
      const v = evaluator.value(w.value);
      return (
        <Card {...props} label={label}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            {formatStat(v, w.type === 'stat' ? w.format : 'number', now)}
          </div>
        </Card>
      );
    }

    case 'progress': {
      const v = num(evaluator.value(w.value)) ?? 0;
      const max = w.max === undefined ? 1 : num(evaluator.value(w.max));
      const fraction = max && max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
      const style = progressStyleOf(typeof w.style === 'string' && w.style.startsWith('$') ? evaluator.value(w.style) : w.style);
      // `share` is the value as a share of max: 158 of 365 reads 43.3%.
      const shown = w.format === 'share' && max ? formatStat(v / max, 'share', now) : formatStat(v, w.format ?? 'number', now);
      const caption = w.caption !== undefined ? evaluator.template(w.caption, templateFormat(manifest, now)) : null;
      if (style === 'ring') {
        return (
          <Card {...props} label={label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DotRing fraction={fraction} units={progressUnits(max, 120, 60)} size={64}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>{shown}</span>
              </DotRing>
              {caption ? <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{caption}</span> : null}
            </div>
          </Card>
        );
      }
      return (
        // Dots need the width: one per day of a year is 365 of them.
        <Card {...props} label={label} wide={style === 'dots'}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{shown}</span>
            {caption ? <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caption}</span> : null}
          </div>
          {style === 'dots' ? (
            <DotGrid fraction={fraction} units={progressUnits(max, 400, 100)} />
          ) : (
            <div style={{ height: 6, background: 'var(--color-border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fraction * 100}%`, background: 'var(--color-accent)' }} />
            </div>
          )}
        </Card>
      );
    }

    case 'stats': {
      const fmt = templateFormat(manifest, now);
      return (
        // Two per row, each number centered over its label: four fit half a row.
        <Card {...props} label={label}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(2, w.items.length)}, minmax(0, 1fr))`, gap: '6px 4px' }}>
            {w.items.map((it, i) => (
              <div key={i} style={{ minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{formatStat(evaluator.value(it.value), it.format ?? 'number', now)}</div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{evaluator.template(it.label, fmt)}</div>
              </div>
            ))}
          </div>
        </Card>
      );
    }
  }
}

type RecordSpec = Extract<NonNullable<PluginManifest['today']>['widget'], { type: 'record' }>;

/**
 * The latest item matching `where` (the book being read), with its number
 * `field` (the page) edited right here: typed, saved on Enter or on leaving
 * the box. Against `max` (its pages) it gets a bar.
 */
function RecordCard(props: TodayWidgetProps & { widget: RecordSpec; label: string }) {
  const { manifest, evaluator, widget: w, label, now } = props;
  const c = manifest.collections.find((x) => x.key === w.collection);
  const rows = c ? evaluator.records(c.key, w.where) : [];
  // The one touched last: the book you're on.
  const rec = rows.reduce<PluginRecord | undefined>((a, r) => (!a || (r.updated_at ?? r.created_at) > (a.updated_at ?? a.created_at) ? r : a), undefined);
  const caption = w.caption !== undefined ? evaluator.template(w.caption, templateFormat(manifest, now)) : null;
  const value = rec ? num(rec.data[w.field] as PluginValue) : undefined;
  const max = rec && w.max ? num(rec.data[w.max] as PluginValue) : undefined;
  const field = c?.fields.find((f) => f.key === w.field);
  return (
    <Card {...props} label={label}>
      {rec ? (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {String(rec.data[w.title] ?? 'Untitled')}
            {rows.length > 1 ? <span style={{ fontWeight: 400, color: 'var(--color-text-faint)' }}> +{rows.length - 1}</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span>{field?.label ?? w.field}</span>
            <NumberInput
              key={`${rec.id}:${value ?? ''}`}
              value={value}
              min={field?.min}
              max={field?.max ?? max}
              disabled={props.readOnly}
              onSave={(v) => void props.update(rec, { ...rec.data, [w.field]: v })}
            />
            {max !== undefined ? <span>/ {formatStat(max, 'number', now)}</span> : null}
          </div>
          {max !== undefined && max > 0 ? (
            <div style={{ height: 4, background: 'var(--color-border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, ((value ?? 0) / max) * 100))}%`, background: 'var(--color-accent)' }} />
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>Nothing here yet.</div>
      )}
      {caption ? <div style={{ fontSize: 10, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{caption}</div> : null}
    </Card>
  );
}

/** A small number box that saves on Enter or blur, not on every keystroke. */
function NumberInput({ value, min, max, disabled, onSave }: { value: number | undefined; min?: number | undefined; max?: number | undefined; disabled: boolean; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const save = () => {
    const v = text.trim() === '' ? null : Number(text);
    if (v !== null && !Number.isFinite(v)) return;
    if ((v ?? undefined) !== value) onSave(v);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      value={text}
      min={min}
      max={max}
      disabled={disabled}
      aria-label="Value"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      style={{ width: 52, padding: '2px 4px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', textAlign: 'center', color: 'var(--color-text)', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
    />
  );
}

type SelectTodaySpec = Extract<NonNullable<PluginManifest['today']>['widget'], { type: 'select-today' }>;

/**
 * Today's option chips. With `after: year-grid`, once today is set the card
 * shows the year in pixels instead, and "Change" brings the chips back.
 */
function SelectToday(props: TodayWidgetProps & { widget: SelectTodaySpec; label: string }) {
  const { manifest, evaluator, widget: w, label } = props;
  const [changing, setChanging] = useState(false);
  const c = manifest.collections.find((x) => x.key === w.collection);
  const field = c?.fields.find((f) => f.key === w.field);
  if (!c || !field) return null;
  const options = fieldOptions(c.key, field, props.settings);
  const records = evaluator.records(c.key);
  const current = records.find((r) => r.day === props.today)?.data[field.key];
  const chosen = options.find((o) => o.value === current);

  if (w.after === 'year-grid' && chosen && !changing) {
    const colors = new Map(options.map((o) => [o.value, o.color]));
    const byDay = new Map(records.flatMap((r) => (r.day ? [[r.day, r.data[field.key]] as const] : [])));
    return (
      <Card {...props} label={label} wide>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-text)' }}>
          {chosen.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: chosen.color }} /> : null}
          <span style={{ fontWeight: 600 }}>{chosen.label}</span>
          <button
            type="button"
            disabled={props.readOnly}
            onClick={(e) => {
              e.stopPropagation();
              setChanging(true);
            }}
            style={{ marginLeft: 'auto', border: 'none', background: 'none', padding: 0, fontSize: 10, fontFamily: 'inherit', color: 'var(--color-text-muted)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            Change
          </button>
        </div>
        <YearGrid
          year={Number(props.today.slice(0, 4))}
          weekStart={props.weekStart}
          today={props.today}
          colorOf={(day) => {
            const v = byDay.get(day);
            return v === undefined ? undefined : colors.get(String(v)) ?? 'var(--color-accent)';
          }}
        />
      </Card>
    );
  }

  return (
    <Card {...props} label={label}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={props.readOnly}
            title={o.label}
            onClick={(e) => {
              e.stopPropagation();
              setChanging(false);
              void props.setDay(c.key, props.today, { [field.key]: o.value });
            }}
            style={{ ...chipStyle(current === o.value, o.color), padding: '2px 7px', fontSize: 10 }}
          >
            {o.color ? <span style={{ width: 7, height: 7, borderRadius: 2, background: o.color, marginRight: 4 }} /> : null}
            {o.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

function num(v: PluginValue): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function Card({ manifest, label, onOpen, children, wide = false }: TodayWidgetProps & { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card itself: Enter on its + or a chip does that control's action.
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen();
      }}
      style={{ ...cardStyle, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...(wide ? { gridColumn: '1 / -1' } : {}) }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <PluginIcon icon={manifest.icon} name={manifest.name} size={18} />
        <span style={{ ...labelStyle, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}
