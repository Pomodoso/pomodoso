import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────
// Only the slice of TodayResponse (today.rs) this page actually renders —
// calls the same GET /today endpoint once per date rather than adding a new
// backend aggregate route, since a week view is 7 cheap reads, not a
// high-traffic path worth its own query.

interface WeekDayResponse {
  priorities: unknown[];
  tasks: unknown[];
  stats: {
    pomos_today: number;
    seconds_today: number;
    tasks_done_today: number;
  };
}

interface WeekDay {
  date: string;
  dayName: string;
  dayNum: number;
  isToday: boolean;
  pomos: number;
  seconds: number;
  tasksDone: number;
  tasksTotal: number;
}

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

// Monday-start week, matching the product's weekStart=0=Monday convention
// used elsewhere (extension/mobile habit-week strips).
function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
  d.setDate(d.getDate() - dow);
  return d.toLocaleDateString('en-CA');
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function WeekPage({ workspaceId }: { workspaceId: string }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(todayDate()));
  const [days, setDays] = useState<WeekDay[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const wsParam = workspaceId === 'all' ? '' : `workspace_id=${workspaceId}&`;
    const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const today = todayDate();

    Promise.all(dates.map(date => api.get<WeekDayResponse>(`/today?${wsParam}date=${date}&tz=${tz}`)))
      .then(results => {
        setDays(
          results.map((d, i) => {
            const date = dates[i];
            const dow = new Date(`${date}T00:00:00`);
            return {
              date,
              dayName: dow.toLocaleDateString('en-US', { weekday: 'short' }),
              dayNum: dow.getDate(),
              isToday: date === today,
              pomos: d.stats.pomos_today,
              seconds: d.stats.seconds_today,
              tasksDone: d.stats.tasks_done_today,
              tasksTotal: d.priorities.length + d.tasks.length,
            };
          }),
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workspaceId, weekStart]);

  return (
    <>
      <div className="pomo-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="pomo-btn pomo-btn-icon" aria-label="Previous week" onClick={() => setWeekStart(w => addDays(w, -7))}>
              <i className="ti ti-chevron-left" />
            </button>
            <button className="pomo-btn pomo-btn-icon" aria-label="Next week" onClick={() => setWeekStart(w => addDays(w, 7))}>
              <i className="ti ti-chevron-right" />
            </button>
          </div>
          <div>
            <div className="pomo-eyebrow">
              Week
              {weekStart !== startOfWeek(todayDate()) && (
                <button className="pomo-link-btn" style={{ marginLeft: 8 }} onClick={() => setWeekStart(startOfWeek(todayDate()))}>
                  Jump to this week
                </button>
              )}
            </div>
            <h1 className="pomo-page-title">{weekRangeLabel(weekStart)}</h1>
          </div>
        </div>
        <Link to="/dashboard" className="pomo-btn">
          <i className="ti ti-calendar-event" /> Day view
        </Link>
      </div>

      {loading ? (
        <div style={{ padding: '60px 36px', color: 'var(--text-tert)', fontSize: 13 }}>Loading…</div>
      ) : error || !days ? (
        <div style={{ padding: '60px 36px', color: 'var(--accent)', fontSize: 13 }}>{error ?? 'Failed to load week data.'}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {days.map(day => (
            <div
              key={day.date}
              className="pomo-card"
              style={day.isToday ? { borderColor: 'var(--accent)', background: 'var(--accent-soft, rgba(200,85,61,0.05))' } : undefined}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {day.dayName}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', margin: '2px 0 12px' }}>{day.dayNum}</div>
              <div style={{ fontSize: 12, color: 'var(--text-sec)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><i className="ti ti-checkbox" style={{ marginRight: 5, color: 'var(--text-tert)' }} />{day.tasksDone}/{day.tasksTotal} tasks</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11 }}>🍅</span>{day.pomos} pomos</div>
                <div><i className="ti ti-clock" style={{ marginRight: 5, color: 'var(--text-tert)' }} />{fmtDuration(day.seconds)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
