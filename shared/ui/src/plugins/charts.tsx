import type { PluginOption, SeriesPoint } from '@pomodoso/types/plugins';

import { EMPTY_FILL, NEUTRAL_FILL } from './styles.js';

const W = 320;
const H = 90;
const PAD_BOTTOM = 14;

/** A bucket's axis label, the same kind for the whole series: day number, or month for monthly buckets. */
function shortLabel(start: string, group: 'day' | 'week' | 'month'): string {
  const d = new Date(`${start}T00:00:00Z`);
  return d.toLocaleDateString('en', group === 'month' ? { month: 'short', timeZone: 'UTC' } : { day: 'numeric', timeZone: 'UTC' });
}

/**
 * A bar or line chart of a grouped series, with an optional horizontal
 * reference (a limit or goal). Values may be negative: bars grow from the
 * zero line. Missing values (null) leave a gap instead of reading as zero.
 */
export function SeriesChart({ kind, group, series, reference }: {
  kind: 'bar' | 'line';
  group: 'day' | 'week' | 'month';
  series: SeriesPoint[];
  reference?: number | null | undefined;
}) {
  const values = series.flatMap((p) => (p.value === null ? [] : [p.value]));
  const bounds = reference != null ? [...values, reference] : values;
  const top = Math.max(1, ...bounds);
  const bottom = Math.min(0, ...bounds);
  const plotH = H - PAD_BOTTOM;
  const slot = series.length > 0 ? W / series.length : W;
  const y = (v: number) => plotH - ((v - bottom) / (top - bottom)) * (plotH - 4);
  const zero = y(0);

  // Line segments between gaps.
  const segments: [number, number][][] = [[]];
  series.forEach((p, i) => {
    if (p.value === null) segments.push([]);
    else segments[segments.length - 1]!.push([i * slot + slot / 2, y(p.value)]);
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${kind} chart`} style={{ display: 'block' }}>
      {kind === 'bar'
        ? series.map((p, i) => {
            if (p.value === null) return null;
            const v = p.value;
            const over = reference != null && v > reference;
            return (
              <rect
                key={p.start}
                x={i * slot + slot * 0.15}
                width={slot * 0.7}
                y={Math.min(y(v), zero)}
                height={Math.max(v !== 0 ? 1.5 : 0, Math.abs(zero - y(v)))}
                rx={1.5}
                fill={over ? 'var(--color-accent)' : 'var(--color-text-muted)'}
                opacity={over ? 1 : 0.55}
              >
                <title>{`${p.start}: ${v}`}</title>
              </rect>
            );
          })
        : segments
            .filter((pts) => pts.length > 0)
            .map((pts, k) =>
              pts.length === 1 ? (
                <circle key={k} cx={pts[0]![0]} cy={pts[0]![1]} r={1.75} fill={NEUTRAL_FILL} />
              ) : (
                <polyline key={k} fill="none" stroke={NEUTRAL_FILL} strokeWidth={1.75} strokeLinejoin="round" points={pts.map(([x, py]) => `${x},${py}`).join(' ')} />
              ),
            )}
      {reference != null ? (
        <line x1={0} x2={W} y1={y(reference)} y2={y(reference)} stroke="var(--color-text-faint)" strokeDasharray="3 3" strokeWidth={1} />
      ) : null}
      <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--color-border)" strokeWidth={1} />
      {series.map((p, i) =>
        i % Math.ceil(series.length / 8) === 0 ? (
          <text key={p.start} x={i * slot + slot / 2} y={H - 2} textAnchor="middle" fontSize={8} fill="var(--color-text-faint)">
            {shortLabel(p.start, group)}
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
