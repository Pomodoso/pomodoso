import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

interface TaskItem {
  id: string;
  title: string;
  status: string;
  ticket_id: string | null;
  completed_at: string | null;
  project_name: string | null;
  project_color: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  recurrence: RecurrenceRule | null;
}

interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  weekdays?: number[];
  monthDay?: number;
  yearMonth?: number;
  yearDay?: number;
  time?: string;
  startDate?: string;
  endDate?: string;
}

interface TasksData {
  backlog: TaskItem[];
  recurring: TaskItem[];
  done: TaskItem[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

// Mirrors the extension's formatRecurrenceLabel so the schedule reads the same.
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

function WorkspaceBadge({ task }: { task: TaskItem }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-tert)' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: task.workspace_color, flexShrink: 0 }} />
      {task.workspace_name}
    </span>
  );
}

function TaskRow({ task, showWorkspace, icon, subtitle }: {
  task: TaskItem;
  showWorkspace: boolean;
  icon: string;
  subtitle?: string;
}) {
  const isDone = task.status === 'done' || task.status === 'cancelled';
  return (
    <div className="pomo-priority-item">
      <div className={`pomo-priority-mark ${isDone ? 'done' : ''}`}>
        <i className={`ti ${isDone ? 'ti-check' : icon}`} style={{ fontSize: 11 }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14,
          textDecoration: isDone ? 'line-through' : 'none',
          color: isDone ? 'var(--text-tert)' : 'var(--text)',
        }}>
          {task.ticket_id && <span className="pomo-ticket-pill" style={{ marginRight: 6 }}>{task.ticket_id}</span>}
          {task.title}
        </div>
        {(subtitle || task.project_name) && (
          <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
            {subtitle}
            {subtitle && task.project_name ? ' · ' : ''}
            {task.project_name}
          </div>
        )}
      </div>
      {showWorkspace && <WorkspaceBadge task={task} />}
    </div>
  );
}

function Card({ title, icon, count, children }: { title: string; icon: string; count: number; children: React.ReactNode }) {
  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className={`ti ${icon}`} /> {title}</div>
        {count > 0 && <div className="pomo-card-meta">{count}</div>}
      </div>
      <div className="pomo-priority-list">{children}</div>
    </div>
  );
}

export default function TasksPage({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<TasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showDone, setShowDone] = useState(false);
  const [done, setDone] = useState<TaskItem[] | null>(null);
  const [doneLoading, setDoneLoading] = useState(false);

  const wsParam = workspaceId === 'all' ? '' : `workspace_id=${workspaceId}`;
  const showWorkspace = workspaceId === 'all';

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setShowDone(false);
    setDone(null);
    api
      .get<TasksData>(`/tasks${wsParam ? `?${wsParam}` : ''}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workspaceId]);

  // Done tasks are fetched lazily the first time the filter is turned on.
  const toggleDone = () => {
    const next = !showDone;
    setShowDone(next);
    if (next && done === null && !doneLoading) {
      setDoneLoading(true);
      api
        .get<TasksData>(`/tasks?${wsParam ? `${wsParam}&` : ''}done=true`)
        .then(d => setDone(d.done))
        .catch(() => setDone([]))
        .finally(() => setDoneLoading(false));
    }
  };

  if (loading) {
    return <div style={{ padding: '60px 36px', color: 'var(--text-tert)', fontSize: 13 }}>Loading…</div>;
  }
  if (error || !data) {
    return <div style={{ padding: '60px 36px', color: 'var(--accent)', fontSize: 13 }}>{error ?? 'Failed to load tasks.'}</div>;
  }

  return (
    <>
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">Workspace</div>
          <h1 className="pomo-page-title">Tasks</h1>
        </div>
        <button className={`pomo-btn ${showDone ? 'pomo-btn-primary' : ''}`} onClick={toggleDone}>
          <i className="ti ti-check" /> {showDone ? 'Hide done' : 'Show done'}
        </button>
      </div>

      <Card title="Recurring" icon="ti-repeat" count={data.recurring.length}>
        {data.recurring.length === 0 ? (
          <div className="pomo-empty"><i className="ti ti-repeat" />No recurring tasks.</div>
        ) : (
          data.recurring.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              showWorkspace={showWorkspace}
              icon="ti-repeat"
              subtitle={t.recurrence ? formatRecurrence(t.recurrence) : undefined}
            />
          ))
        )}
      </Card>

      <Card title="Backlog" icon="ti-inbox" count={data.backlog.length}>
        {data.backlog.length === 0 ? (
          <div className="pomo-empty"><i className="ti ti-inbox" />Backlog is empty.</div>
        ) : (
          data.backlog.map(t => (
            <TaskRow key={t.id} task={t} showWorkspace={showWorkspace} icon="ti-point" />
          ))
        )}
      </Card>

      {showDone && (
        <Card title="Done" icon="ti-check" count={done?.length ?? 0}>
          {doneLoading ? (
            <div className="pomo-empty"><i className="ti ti-loader" />Loading…</div>
          ) : !done || done.length === 0 ? (
            <div className="pomo-empty"><i className="ti ti-check" />No completed tasks.</div>
          ) : (
            done.map(t => (
              <TaskRow key={t.id} task={t} showWorkspace={showWorkspace} icon="ti-check" />
            ))
          )}
        </Card>
      )}
    </>
  );
}
