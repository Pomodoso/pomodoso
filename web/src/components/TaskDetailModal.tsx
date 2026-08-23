import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────
// Mirrors backend/src/routes/today.rs's TaskDetail.

interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  weekdays?: number[];
  monthDay?: number;
  yearMonth?: number;
  yearDay?: number;
  time?: string;
}

interface TaskSession {
  id: string;
  mode: string;
  started_at: string;
  actual_duration_seconds: number;
  status: string;
}

interface TaskDetail {
  id: string;
  title: string;
  status: string;
  notes: string;
  ticket_id: string | null;
  is_priority: boolean;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  recurrence: RecurrenceRule | null;
  completed_dates: string[];
  total_pomos: number;
  total_seconds: number;
  sessions: TaskSession[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

// Mirrors TasksPage's formatRecurrence so the schedule reads the same everywhere.
function formatRecurrence(rule: RecurrenceRule): string {
  const n = Math.max(1, Math.floor(rule.interval ?? 1));
  const time = rule.time ? ` at ${rule.time}` : ' · All day';
  switch (rule.freq) {
    case 'daily':
      return (n > 1 ? `Every ${n} days` : 'Every day') + time;
    case 'weekly': {
      const days = (rule.weekdays ?? []).map(d => DAY_NAMES[d] ?? '').filter(Boolean).join(', ');
      if (n > 1) return `Every ${n} weeks${days ? ' on ' + days : ''}${time}`;
      return `Every ${days || 'week'}${time}`;
    }
    case 'monthly':
      return (n > 1
        ? `Every ${n} months on the ${ordinal(rule.monthDay ?? 1)}`
        : `Every ${ordinal(rule.monthDay ?? 1)} of the month`) + time;
    case 'yearly': {
      const month = MONTH_NAMES[(rule.yearMonth ?? 1) - 1] ?? '';
      return (n > 1
        ? `Every ${n} years on ${month} ${rule.yearDay ?? 1}`
        : `Every ${month} ${rule.yearDay ?? 1}`) + time;
    }
  }
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const STATUS_LABELS: Record<string, string> = {
  todo: 'Todo', in_progress: 'In progress', done: 'Done', delayed: 'Delayed', cancelled: 'Cancelled',
};
const STATUS_COLORS: Record<string, string> = {
  todo: 'var(--text-tert)', in_progress: 'var(--accent)', done: 'var(--success)',
  delayed: '#7B5DB4', cancelled: 'var(--text-tert)',
};

// ─── Component ─────────────────────────────────────────────────────────────────

export function TaskDetailModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .get<TaskDetail>(`/tasks/${taskId}`)
      .then(setTask)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="pomo-modal-overlay" onClick={onClose}>
      <div className="pomo-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ minWidth: 0 }}>
            {task?.ticket_id && <span className="pomo-ticket-pill" style={{ marginRight: 8 }}>{task.ticket_id}</span>}
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>{task?.title ?? 'Task'}</span>
          </div>
          <button className="pomo-btn pomo-btn-icon" aria-label="Close" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {loading ? (
            <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
          ) : error || !task ? (
            <div style={{ color: 'var(--accent)', fontSize: 13, padding: '8px 0' }}>{error ?? 'Task not found.'}</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                  color: STATUS_COLORS[task.status] ?? 'var(--text-tert)',
                  border: `1px solid ${STATUS_COLORS[task.status] ?? 'var(--border)'}`,
                  borderRadius: 4, padding: '2px 8px',
                }}>
                  {STATUS_LABELS[task.status] ?? task.status}
                </span>
                {task.is_priority && (
                  <span style={{ fontSize: 11, color: 'var(--text-sec)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                    <i className="ti ti-star" style={{ marginRight: 4 }} />Priority
                  </span>
                )}
                {task.project_name && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-sec)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: task.project_color ?? 'var(--text-tert)' }} />
                    {task.project_name}
                  </span>
                )}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-sec)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: task.workspace_color }} />
                  {task.workspace_name}
                </span>
              </div>

              {task.notes && (
                <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.6, marginBottom: 18, whiteSpace: 'pre-wrap' }}>
                  {task.notes}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Pomos</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{task.total_pomos}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Time logged</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginTop: 2 }}>{fmtDuration(task.total_seconds)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {task.recurrence ? 'Completions' : task.completed_at ? 'Completed' : 'Scheduled'}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginTop: 4 }}>
                    {task.recurrence
                      ? task.completed_dates.length
                      : task.completed_at
                        ? fmtDateTime(task.completed_at)
                        : task.scheduled_for
                          ? new Date(`${task.scheduled_for}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '—'}
                  </div>
                </div>
              </div>

              {task.recurrence && (
                <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ti ti-repeat" style={{ color: 'var(--accent)' }} />
                  {formatRecurrence(task.recurrence)}
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tert)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                  Recent sessions
                </div>
                {task.sessions.length === 0 ? (
                  <div className="pomo-empty" style={{ padding: '16px 0' }}>
                    <i className="ti ti-clock-off" />
                    No focus sessions logged yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {task.sessions.map(s => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ color: 'var(--text-sec)' }}>
                          <i className={`ti ${s.mode === 'pomodoro' ? 'ti-clock' : 'ti-stopwatch'}`} style={{ marginRight: 6, color: 'var(--text-tert)' }} />
                          {fmtDateTime(s.started_at)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmtDuration(s.actual_duration_seconds)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
