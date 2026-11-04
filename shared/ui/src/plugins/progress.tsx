import type { ReactNode } from 'react';

// The ring and dots styles of a progress block or Today widget. Both draw
// `units` dots, filled up to the fraction; the last filled one is "now"
// (today, on a calendar) and takes the accent color.

const FILLED = 'var(--color-text)';
const NOW = 'var(--color-accent)';
const EMPTY = 'var(--color-border-strong)';

/** One dot per unit when `max` is a whole number up to `limit`, else `fallback` (a percent's worth each). */
export function progressUnits(max: number | undefined, limit: number, fallback: number): number {
  return max !== undefined && Number.isInteger(max) && max >= 2 && max <= limit ? max : fallback;
}

function filledOf(fraction: number, units: number): number {
  return Math.max(0, Math.min(units, Math.round(Math.max(0, Math.min(1, fraction)) * units)));
}

/** A ring of dots with something in the middle. */
export function DotRing({ fraction, units, size = 120, children }: { fraction: number; units: number; size?: number; children?: ReactNode }) {
  const filled = filledOf(fraction, units);
  const r = size / 2 - 6;
  const dot = Math.max(1.4, Math.min(3.2, (Math.PI * 2 * r) / units / 2.6));
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${Math.round(fraction * 100)}%`} style={{ display: 'block' }}>
        {Array.from({ length: units }, (_, i) => {
          // Clockwise from the top.
          const a = (i / units) * Math.PI * 2 - Math.PI / 2;
          const fill = i < filled - 1 ? FILLED : i === filled - 1 ? NOW : EMPTY;
          return <circle key={i} cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={dot} fill={fill} />;
        })}
      </svg>
      {children ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: size / 5 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A grid of dots, left to right and top to bottom: one per day of a year, say. */
export function DotGrid({ fraction, units }: { fraction: number; units: number }) {
  const filled = filledOf(fraction, units);
  const cols = units > 120 ? 20 : Math.min(units, 10);
  const rows = Math.ceil(units / cols);
  const step = 10;
  return (
    <svg viewBox={`0 0 ${cols * step} ${rows * step}`} width="100%" role="img" aria-label={`${filled} of ${units}`} style={{ display: 'block' }}>
      {Array.from({ length: units }, (_, i) => {
        const fill = i < filled - 1 ? FILLED : i === filled - 1 ? NOW : EMPTY;
        return <circle key={i} cx={(i % cols) * step + step / 2} cy={Math.floor(i / cols) * step + step / 2} r={step * 0.32} fill={fill} />;
      })}
    </svg>
  );
}
