import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HabitHistoryDay {
  date: string;
  value: number;
  done: boolean;
}

interface HabitHistoryResponse {
  year: number;
  days: HabitHistoryDay[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

// Mon-start weeks covering the full calendar year, padded at both ends so
// every week has 7 days — matches the Mon-start convention used elsewhere
// (History's month grid, Week view).
function buildYearWeeks(year: number): string[][] {
  const jan1 = new Date(year, 0, 1);
  const startDow = (jan1.getDay() + 6) % 7;
  const dec31 = new Date(year, 11, 31);
  const endDow = (dec31.getDay() + 6) % 7;

  const start = new Date(year, 0, 1 - startDow);
  const end = new Date(year, 11, 31 + (6 - endDow));

  const weeks: string[][] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(toDateStr(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// One label per column, placed on the first week that contains a new month.
function monthLabelsForWeeks(weeks: string[][], year: number): (string | null)[] {
  let lastMonth = -1;
  return weeks.map(week => {
    const firstInYear = week.find(d => new Date(`${d}T00:00:00`).getFullYear() === year);
    if (!firstInYear) return null;
    const month = new Date(`${firstInYear}T00:00:00`).getMonth();
    if (month === lastMonth) return null;
    lastMonth = month;
    return MONTH_LABELS[month];
  });
}

// 6 non-empty levels (0 = nothing logged) — "muy poco" through "muchísimo" —
// plus a distinct top shade for days that exceeded the goal, so over-achieving
// reads as brighter than merely meeting it.
const OPACITY_STEPS = [0.14, 0.28, 0.42, 0.58, 0.74, 0.88, 1];
function intensityOpacity(ratio: number): number {
  if (ratio <= 0) return 0;
  const step = ratio >= 1 ? OPACITY_STEPS.length - 1 : Math.min(Math.floor(ratio * (OPACITY_STEPS.length - 1)), OPACITY_STEPS.length - 2);
  return OPACITY_STEPS[step];
}

// completed_at isn't a reliable "done" signal for counter habits — logs can
// have value >= target and still lack it (same class of gap as tasks'
// completed_at earlier). Derive intensity from value vs. target instead;
// completed_at is only meaningful for boolean habits, which have no partial
// state to derive from.
function dayRatio(day: HabitHistoryDay | undefined, kind: 'boolean' | 'counter', targetCount: number | null, maxValue: number): number {
  if (!day) return 0;
  if (kind === 'boolean') return day.done ? 1 : 0;
  const target = targetCount && targetCount > 0 ? targetCount : maxValue;
  return target > 0 ? day.value / target : 0;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function HabitHeatmap({ habitId, kind, targetCount, minYear }: {
  habitId: string;
  kind: 'boolean' | 'counter';
  targetCount: number | null;
  minYear: number;
}) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [data, setData] = useState<HabitHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    api
      .get<HabitHistoryResponse>(`/habits/${habitId}/history?year=${year}`)
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [habitId, year]);

  const dayMap = useMemo(() => {
    const map = new Map<string, HabitHistoryDay>();
    data?.days.forEach(d => map.set(d.date, d));
    return map;
  }, [data]);

  const maxValue = useMemo(() => Math.max(1, ...(data?.days.map(d => d.value) ?? [0])), [data]);

  const weeks = useMemo(() => buildYearWeeks(year), [year]);
  const monthLabels = useMemo(() => monthLabelsForWeeks(weeks, year), [weeks, year]);
  const totalCompleted = data?.days.filter(d => dayRatio(d, kind, targetCount, maxValue) >= 1).length ?? 0;

  const years: number[] = [];
  for (let y = currentYear; y >= minYear; y--) years.push(y);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <div style={{ fontSize: 11, color: error ? 'var(--accent)' : 'var(--text-tert)', marginBottom: 6 }}>
          {loading ? 'Loading…' : error ? 'Failed to load' : `${totalCompleted} completions in ${year}`}
        </div>
        <div style={{ display: 'inline-block' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks.length}, 11px)`, gap: 3, marginBottom: 3, marginLeft: 14 }}>
            {monthLabels.map((label, i) => (
              <div key={i} style={{ fontSize: 9, color: 'var(--text-tert)', gridColumn: i + 1 }}>
                {label ?? ''}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 11px)', gap: 3, fontSize: 9, color: 'var(--text-tert)', lineHeight: '11px' }}>
              <div />
              <div>Mon</div>
              <div />
              <div>Wed</div>
              <div />
              <div>Fri</div>
              <div />
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${weeks.length}, 11px)`,
              gridTemplateRows: 'repeat(7, 11px)',
              gridAutoFlow: 'column',
              gap: 3,
            }}>
              {weeks.map((week, wi) =>
                week.map((date, di) => {
                  const inYear = new Date(`${date}T00:00:00`).getFullYear() === year;
                  const day = dayMap.get(date);
                  const ratio = dayRatio(day, kind, targetCount, maxValue);
                  const opacity = intensityOpacity(ratio);
                  return (
                    <div
                      key={`${wi}-${di}`}
                      title={inYear ? `${date}${day ? (kind === 'counter' ? ` — ${day.value}` : day.done ? ' — done' : '') : ''}` : undefined}
                      style={{
                        width: 11,
                        height: 11,
                        borderRadius: 2,
                        visibility: inYear ? 'visible' : 'hidden',
                        background: opacity <= 0 ? 'var(--border)' : 'var(--accent)',
                        opacity: opacity <= 0 ? 1 : opacity,
                      }}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {years.map(y => (
          <button
            key={y}
            onClick={() => setYear(y)}
            className="pomo-btn"
            style={{
              fontSize: 11,
              padding: '4px 10px',
              justifyContent: 'center',
              ...(y === year ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
            }}
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}
