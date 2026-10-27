import type { PluginOption, SeriesPoint } from '@pomodoso/types/plugins';

import { EMPTY_FILL, NEUTRAL_FILL } from './styles.js';

const W = 320;
const H = 90;
const PAD_BOTTOM = 14;

function shortLabel(start: string, n: number): string {
  // Day buckets read as the day of month, month buckets as the month.
  const d = new Date(`${start}T00:00:00Z`);
  if (n > 16) return '';
  return d.toLocaleDateString('en', start.endsWith('-01') && n <= 12 ? { month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
}

/** A bar or line chart of a grouped series, with an optional horizontal reference (a limit or goal). */
export function SeriesChart({ kind, series, reference }: { kind: 'bar' | 'line'; series: SeriesPoint[]; reference?: number | null | undefined }) {
  const values = series.map((p) => p.value ?? 0);
  const top = Math.max(1, ...values, reference ?? 0);
  const plotH = H - PAD_BOTTOM;
  const slot = series.length > 0 ? W / series.length : W;
  const y = (v: number) => plotH - (v / top) * (plotH - 4);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${kind} chart`} style={{ display: 'block' }}>
      {kind === 'bar'
        ? series.map((p, i) => {
            const v = p.value ?? 0;
            const over = reference != null && v > reference;
            return (
              <rect
                key={p.start}
                x={i * slot + slot * 0.15}
                width={slot * 0.7}
                y={y(v)}
                height={Math.max(v > 0 ? 1.5 : 0, plotH - y(v))}
                rx={1.5}
                fill={over ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                opacity={over ? 1 : 0.55}
              >
                <title>{`${p.start}: ${p.value ?? '—'}`}</title>
              </rect>
            );
          })
        : (
          <polyline
            fill="none"
            stroke={NEUTRAL_FILL}
            strokeWidth={1.75}
            strokeLinejoin="round"
            points={series.map((p, i) => `${i * slot + slot / 2},${y(p.value ?? 0)}`).join(' ')}
          />
        )}
      {reference != null ? (
        <line x1={0} x2={W} y1={y(reference)} y2={y(reference)} stroke="var(--color-text-faint)" strokeDasharray="3 3" strokeWidth={1} />
      ) : null}
      <line x1={0} x2={W} y1={plotH} y2={plotH} stroke="var(--color-border)" strokeWidth={1} />
      {series.map((p, i) =>
        i % Math.ceil(series.length / 8) === 0 ? (
          <text key={p.start} x={i * slot + slot / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--color-text-faint)">
            {shortLabel(p.start, series.length) || p.start.slice(5)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

const CELL = 5;
const GAP = 1;

/**
 * Every day of `year` as a cell, weeks as columns (Monday first, like a
 * GitHub contribution grid). `colorOf` returns a day's color or undefined.
 */
export function YearGrid({ year, weekStart, colorOf, today, onPick }: {
  year: number;
  weekStart: number;
  colorOf: (day: string) => string | undefined;
  today: string;
  onPick?: ((day: string) => void) | undefined;
}) {
  const first = Date.UTC(year, 0, 1);
  const days = Math.round((Date.UTC(year + 1, 0, 1) - first) / 86_400_000);
  // Row of Jan 1: 0 = Monday in the extension's convention, shifted by weekStart.
  const jsDay = new Date(first).getUTCDay();
  const offset = (((jsDay + 6) % 7) - weekStart + 7) % 7;
  const cols = Math.ceil((days + offset) / 7);

  const cells = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
    const slot = i + offset;
    const future = day > today;
    cells.push(
      <rect
        key={day}
        x={Math.floor(slot / 7) * (CELL + GAP)}
        y={(slot % 7) * (CELL + GAP)}
        width={CELL}
        height={CELL}
        rx={1}
        fill={colorOf(day) ?? EMPTY_FILL}
        opacity={future ? 0.35 : 1}
        stroke={day === today ? 'var(--color-text)' : 'none'}
        strokeWidth={day === today ? 0.8 : 0}
        style={onPick && !future ? { cursor: 'pointer' } : undefined}
        onClick={onPick && !future ? () => onPick(day) : undefined}
      >
        <title>{day}</title>
      </rect>,
    );
  }
  const width = cols * (CELL + GAP);
  return (
    <svg viewBox={`0 0 ${width} ${7 * (CELL + GAP)}`} width="100%" role="img" aria-label={`Year ${year}`} style={{ display: 'block' }}>
      {cells}
    </svg>
  );
}

export function Legend({ options }: { options: PluginOption[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
      {options.map((o) => (
        <span key={o.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-text-muted)' }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: o.color ?? NEUTRAL_FILL }} />
          {o.label}
        </span>
      ))}
    </div>
  );
}

/** Horizontal bars: how many records carry each option. */
export function BreakdownBars({ rows }: { rows: { option: PluginOption; count: number }[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {rows.map(({ option, count }) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={option.value} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 54px', alignItems: 'center', gap: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
            <span style={{ height: 6, background: EMPTY_FILL, borderRadius: 99, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: option.color ?? NEUTRAL_FILL }} />
            </span>
            <span style={{ color: 'var(--color-text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {count} · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
