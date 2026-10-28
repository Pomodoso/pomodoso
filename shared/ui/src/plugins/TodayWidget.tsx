import type { ReactNode } from 'react';

import {
  fieldOptions,
  formatStat,
  initialRecordData,
  type PluginEvaluator,
  type PluginManifest,
  type PluginValue,
} from '@pomodoso/types/plugins';

import { PluginIcon } from './PluginIcon.js';
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
  readOnly: boolean;
  add(collection: string, data: Record<string, unknown>): void | Promise<unknown>;
  setDay(collection: string, day: string, data: Record<string, unknown>): void | Promise<unknown>;
  /** Opens the app's own screen. */
  onOpen(): void;
}

/**
 * A plugin's compact card on Today: one number and at most one action, sized
 * for half a popup column. Which one comes from the file's `today.widget`.
 */
export function TodayWidget(props: TodayWidgetProps) {
  const { manifest, evaluator, now } = props;
  const w = manifest.today?.widget;
  if (!w) return null;
  const label = evaluator.template(w.label, (v) => formatStat(v, undefined, now));

  switch (w.type) {
    case 'mini-counter': {
      const v = num(evaluator.value(w.value)) ?? 0;
      const max = w.max === undefined ? undefined : num(evaluator.value(w.max));
      const over = max !== undefined && v > max;
      const c = manifest.collections.find((x) => x.key === w.adds);
      return (
        <Card {...props} label={label}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: 18, fontWeight: 700, color: over ? 'var(--color-accent)' : 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
              {formatStat(v, 'number', now)}
              {max !== undefined ? <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}> / {formatStat(max, 'number', now)}</span> : null}
            </span>
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

    case 'select-today': {
      const c = manifest.collections.find((x) => x.key === w.collection);
      const field = c?.fields.find((f) => f.key === w.field);
      if (!c || !field) return null;
      const current = evaluator.records(c.key).find((r) => r.day === props.today)?.data[field.key];
      return (
        <Card {...props} label={label}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {fieldOptions(c.key, field, props.settings).map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={props.readOnly}
                title={o.label}
                onClick={(e) => {
                  e.stopPropagation();
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
  }
}

function num(v: PluginValue): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function Card({ manifest, label, onOpen, children }: TodayWidgetProps & { label: string; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card itself: Enter on its + or a chip does that control's action.
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen();
      }}
      style={{ ...cardStyle, padding: '8px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <PluginIcon icon={manifest.icon} name={manifest.name} size={18} />
        <span style={{ ...labelStyle, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
      {children}
    </div>
  );
}
