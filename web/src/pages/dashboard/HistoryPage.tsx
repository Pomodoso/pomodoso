import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────
// Mirrors backend/src/routes/history.rs's HistoryResponse.

interface HistoryTask {
  id: string;
  title: string;
  project_name: string | null;
  project_color: string | null;
}

interface HistoryDay {
  date: string;
  pomos: number;
  seconds: number;
  tasks_done: HistoryTask[];
}

interface HistoryResponse {
  from: string;
  to: string;
  days: HistoryDay[];
}

type ViewMode = 'week' | 'month';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

// Monday-start week, matching the product's weekStart=0=Monday convention.
function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
  d.setDate(d.getDate() - dow);
  return d.toLocaleDateString('en-CA');
}

function startOfMonth(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA');
}

function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).toLocaleDateString('en-CA');
}

function endOfMonth(monthStart: string): string {
  const d = new Date(`${monthStart}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-CA');
}

function weekRangeLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${addDays(weekStart, 6)}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = sameMonth
    ? end.toLocaleDateString('en-US', { day: 'numeric' })
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${startStr} – ${endStr}, ${end.getFullYear()}`;
}

function monthLabel(monthStart: string): string {
  return new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Full Mon-Sun weeks covering the month, so the grid has no ragged edges.
function buildMonthGrid(monthStart: string): string[] {
  const dow = (new Date(`${monthStart}T00:00:00`).getDay() + 6) % 7;
  let cursor = addDays(monthStart, -dow);
  const monthEnd = endOfMonth(monthStart);
  const days: string[] = [];
  while (cursor <= monthEnd || days.length % 7 !== 0) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Day detail panel ────────────────────────────────────────────────────────

function DayDetail({ date, day }: { date: string; day: HistoryDay | undefined }) {
  const label = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const pomos = day?.pomos ?? 0;
  const seconds = day?.seconds ?? 0;
  const tasks = day?.tasks_done ?? [];

  return (
    <div className="pomo-card" style={{ marginTop: 16 }}>
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-calendar-event" /> {label}</div>
        {(pomos > 0 || seconds > 0) && (
          <div className="pomo-card-meta">{pomos}p · {fmtDuration(seconds)}</div>
        )}
      </div>
      {tasks.length === 0 ? (
        <div className="pomo-empty">
          <i className="ti ti-clipboard-off" />
          No tasks completed this day.
        </div>
      ) : (
        <div className="pomo-priority-list">
          {tasks.map(t => (
            <div className="pomo-priority-item" key={t.id}>
              <div className="pomo-priority-mark done"><i className="ti ti-check" style={{ fontSize: 12 }} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: 'var(--text)' }}>{t.title}</div>
                {t.project_name && (
                  <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.project_color ?? 'var(--text-tert)' }} />
                    {t.project_name}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage({ workspaceId }: { workspaceId: string }) {
  const [view, setView] = useState<ViewMode>('week');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayDate()));
  const [monthStart, setMonthStart] = useState(() => startOfMonth(todayDate()));
  const [selectedDate, setSelectedDate] = useState(() => todayDate());
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthGrid = useMemo(() => buildMonthGrid(monthStart), [monthStart]);
  const from = view === 'week' ? weekStart : monthGrid[0];
  const to = view === 'week' ? addDays(weekStart, 6) : monthGrid[monthGrid.length - 1];

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const wsParam = workspaceId === 'all' ? '' : `workspace_id=${workspaceId}&`;

    api
      .get<HistoryResponse>(`/history?${wsParam}from=${from}&to=${to}&tz=${tz}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workspaceId, from, to]);

  const dayByDate = useMemo(() => {
    const map = new Map<string, HistoryDay>();
    data?.days.forEach(d => map.set(d.date, d));
    return map;
  }, [data]);

  const today = todayDate();
  const jumpToToday = () => {
    setWeekStart(startOfWeek(today));
    setMonthStart(startOfMonth(today));
    setSelectedDate(today);
  };
  const isCurrentRange = view === 'week' ? weekStart === startOfWeek(today) : monthStart === startOfMonth(today);

  return (
    <>
      <div className="pomo-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              className="pomo-btn pomo-btn-icon"
              aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
              onClick={() => (view === 'week' ? setWeekStart(w => addDays(w, -7)) : setMonthStart(m => addMonths(m, -1)))}
            >
              <i className="ti ti-chevron-left" />
            </button>
            <button
              className="pomo-btn pomo-btn-icon"
              aria-label={view === 'week' ? 'Next week' : 'Next month'}
              onClick={() => (view === 'week' ? setWeekStart(w => addDays(w, 7)) : setMonthStart(m => addMonths(m, 1)))}
            >
              <i className="ti ti-chevron-right" />
            </button>
          </div>
          <div>
            <div className="pomo-eyebrow">
              History
              {!isCurrentRange && (
                <button className="pomo-link-btn" style={{ marginLeft: 8 }} onClick={jumpToToday}>
                  Jump to today
                </button>
              )}
            </div>
            <h1 className="pomo-page-title">{view === 'week' ? weekRangeLabel(weekStart) : monthLabel(monthStart)}</h1>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="pomo-btn"
            style={view === 'week' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => setView('week')}
          >
            Week
          </button>
          <button
            className="pomo-btn"
            style={view === 'month' ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
            onClick={() => setView('month')}
          >
            Month
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div style={{ padding: '60px 36px', color: 'var(--text-tert)', fontSize: 13 }}>Loading…</div>
      ) : error ? (
        <div style={{ padding: '60px 36px', color: 'var(--accent)', fontSize: 13 }}>{error}</div>
      ) : view === 'week' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map(date => {
            const day = dayByDate.get(date);
            const dow = new Date(`${date}T00:00:00`);
            const isToday = date === today;
            const isSelected = date === selectedDate;
            return (
              <div
                key={date}
                className="pomo-card"
                onClick={() => setSelectedDate(date)}
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent)' : isToday ? 'var(--accent)' : undefined,
                  background: isSelected ? 'var(--accent-soft, rgba(200,85,61,0.08))' : undefined,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {dow.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '2px 0 12px' }}>{dow.getDate()}</div>
                <div style={{ fontSize: 12, color: 'var(--text-sec)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div><i className="ti ti-checkbox" style={{ marginRight: 5, color: 'var(--text-tert)' }} />{day?.tasks_done.length ?? 0} done</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11 }}>🍅</span>{day?.pomos ?? 0} pomos</div>
                  <div><i className="ti ti-clock" style={{ marginRight: 5, color: 'var(--text-tert)' }} />{fmtDuration(day?.seconds ?? 0)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {DOW_LABELS.map(label => (
              <div key={label} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'center', padding: '2px 0' }}>
                {label}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {monthGrid.map(date => {
              const day = dayByDate.get(date);
              const inMonth = date >= monthStart && date <= endOfMonth(monthStart);
              const isToday = date === today;
              const isSelected = date === selectedDate;
              const hasActivity = (day?.pomos ?? 0) > 0 || (day?.tasks_done.length ?? 0) > 0;
              return (
                <div
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className="pomo-card"
                  style={{
                    cursor: 'pointer',
                    padding: 8,
                    minHeight: 64,
                    opacity: inMonth ? 1 : 0.4,
                    borderColor: isSelected ? 'var(--accent)' : isToday ? 'var(--accent)' : undefined,
                    background: isSelected ? 'var(--accent-soft, rgba(200,85,61,0.08))' : undefined,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--accent)' : 'var(--text)' }}>
                    {new Date(`${date}T00:00:00`).getDate()}
                  </div>
                  {hasActivity && (
                    <div style={{ fontSize: 10, color: 'var(--text-tert)', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {(day?.pomos ?? 0) > 0 && <div>🍅 {day?.pomos}</div>}
                      {(day?.tasks_done.length ?? 0) > 0 && <div><i className="ti ti-checkbox" /> {day?.tasks_done.length}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <DayDetail date={selectedDate} day={dayByDate.get(selectedDate)} />
    </>
  );
}
