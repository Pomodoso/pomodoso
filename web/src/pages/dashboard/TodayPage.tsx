import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface TodayTask {
  id: string;
  title: string;
  status: string;
  is_priority: boolean;
  completed_at: string | null;
  project_id: string | null;
  project_name: string | null;
  project_color: string | null;
  workspace_id: string;
  workspace_name: string;
  workspace_color: string;
  ticket_id: string | null;
  position: number;
}

interface TodayMeeting {
  id: string;
  title: string;
  time: string;
  duration_minutes: number;
  logged_minutes: number | null;
  logged: boolean;
  track_mode: string; // 'always' | 'once' | 'off'
  project_name: string | null;
  project_color: string | null;
  calendar_name: string | null;
  calendar_color: string | null;
}

interface WorkLogTask {
  task_id: string | null;
  task_title: string;
  ticket_id: string | null;
  pomos: number;
  duration_seconds: number;
  is_active: boolean;
}

interface WorkLogProject {
  project_id: string | null;
  project_name: string;
  project_color: string;
  total_seconds: number;
  tasks: WorkLogTask[];
}

interface HabitLog {
  value: number;
  done: boolean;
  completed_at: string | null;
}

interface TodayHabit {
  id: string;
  name: string;
  icon: string;
  kind: string;
  target_count: number | null;
  unit: string | null;
  unit_amount: number | null;
  time_unit: boolean;
  log: HabitLog | null;
}

interface ActiveSession {
  id: string;
  task_id: string | null;
  task_title: string | null;
  project_name: string | null;
  ticket_id: string | null;
  mode: string;
  started_at: string;
  planned_duration_seconds: number | null;
  actual_duration_seconds: number;
  pomo_index: number;
}

interface TodayStats {
  pomos_today: number;
  seconds_today: number;
  pomos_this_week: number;
  tickets_this_week: number;
  tasks_done_today: number;
}

interface TodayData {
  workspace: { id: string; name: string; color: string };
  date: string;
  active_session: ActiveSession | null;
  priorities: TodayTask[];
  tasks: TodayTask[];
  work_log: WorkLogProject[];
  habits: TodayHabit[];
  meetings: TodayMeeting[];
  stats: TodayStats;
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

function fmtTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Time-unit habits store value/goal in seconds; show mm:ss (h:mm:ss for >= 1h).
function fmtHabitTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function todayDate(): string {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}

function habitIconClass(icon: string): string {
  const map: Record<string, string> = {
    water: 'ti-glass-full',
    fitness: 'ti-barbell',
    book: 'ti-book-2',
    sleep: 'ti-moon',
    run: 'ti-run',
    meditate: 'ti-yin-yang',
    journal: 'ti-notebook',
  };
  return map[icon] ?? 'ti-check';
}

function habitIconColor(icon: string): string {
  const map: Record<string, string> = {
    water: 'var(--info)',
    fitness: 'var(--text-sec)',
    book: 'var(--warning)',
    sleep: '#7B5DB4',
    run: 'var(--success)',
    meditate: 'var(--accent)',
    journal: 'var(--text-sec)',
  };
  return map[icon] ?? 'var(--text-sec)';
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PomoBar({ session }: { session: ActiveSession }) {
  const [elapsed, setElapsed] = useState(session.actual_duration_seconds);
  const planned = session.planned_duration_seconds ?? 25 * 60;

  useEffect(() => {
    const interval = setInterval(() => {
      const start = new Date(session.started_at).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.started_at]);

  const progress = Math.min(elapsed / planned, 1);
  const circumference = 2 * Math.PI * 24;
  const remaining = Math.max(planned - elapsed, 0);

  return (
    <div className="pomo-bar">
      <div className="pomo-mini-ring">
        <svg viewBox="0 0 56 56" width="56" height="56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="var(--border)" strokeWidth="3" />
          <circle
            cx="28" cy="28" r="24"
            fill="none" stroke="var(--accent)" strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
          />
        </svg>
        <div className="pomo-mini-ring-text">{fmtTimer(remaining)}</div>
      </div>
      <div>
        <div className="pomo-bar-eyebrow">
          Focus · pomo {session.pomo_index}
        </div>
        <div className="pomo-bar-task">{session.task_title ?? 'Focus session'}</div>
        <div className="pomo-bar-meta">
          {session.ticket_id && <span className="pomo-ticket-pill">{session.ticket_id}</span>}
          {session.project_name && (
            <span style={{ color: 'var(--text-tert)' }}>{session.project_name}</span>
          )}
          <span>{fmtDuration(elapsed)} so far</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button className="pomo-btn" style={{ width: 34, height: 34, padding: 0, justifyContent: 'center' }}>
          <i className="ti ti-player-pause-filled" style={{ fontSize: 15 }} />
        </button>
      </div>
    </div>
  );
}

function WorkspaceBadge({ task }: { task: TodayTask }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, color: 'var(--text-tert)',
      background: 'var(--bg-darker)', padding: '1px 6px',
      borderRadius: 3, border: '1px solid var(--border)', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: task.workspace_color, flexShrink: 0 }} />
      {task.workspace_name}
    </span>
  );
}

function TaskRow({ task, index, showWorkspace }: { task: TodayTask; index: number; showWorkspace: boolean }) {
  return (
    <div className="pomo-priority-item" key={task.id}>
      <div className={`pomo-priority-mark ${task.status === 'done' ? 'done' : ''}`}>
        {task.status === 'done'
          ? <i className="ti ti-check" style={{ fontSize: 12 }} />
          : task.is_priority ? index + 1 : <i className="ti ti-point" style={{ fontSize: 10 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14,
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
          color: task.status === 'done' ? 'var(--text-tert)' : 'var(--text)',
        }}>
          {task.ticket_id && <span className="pomo-ticket-pill" style={{ marginRight: 6 }}>{task.ticket_id}</span>}
          {task.title}
        </div>
        {task.project_name && (
          <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
            {task.project_name}
          </div>
        )}
      </div>
      {showWorkspace && <WorkspaceBadge task={task} />}
      {task.status === 'in_progress' && (
        <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Active
        </span>
      )}
    </div>
  );
}

function TodayTasksCard({ priorities, tasks, showWorkspace }: { priorities: TodayTask[]; tasks: TodayTask[]; showWorkspace: boolean }) {
  const allTasks = [...priorities, ...tasks];
  const doneCount = allTasks.filter(t => t.status === 'done').length;

  if (allTasks.length === 0) {
    return (
      <div className="pomo-card">
        <div className="pomo-card-header">
          <div className="pomo-card-title"><i className="ti ti-target" /> Today's tasks</div>
        </div>
        <div className="pomo-empty">
          <i className="ti ti-clipboard" />
          No tasks for today.<br />Open the extension to add tasks.
        </div>
      </div>
    );
  }

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-target" /> Today's tasks</div>
        {doneCount > 0 && (
          <div className="pomo-card-meta">{doneCount} / {allTasks.length} done</div>
        )}
      </div>
      <div className="pomo-priority-list">
        {priorities.map((task, i) => (
          <TaskRow key={task.id} task={task} index={i} showWorkspace={showWorkspace} />
        ))}
        {priorities.length > 0 && tasks.length > 0 && (
          <div style={{ height: 1, background: 'var(--border)', margin: '8px 0' }} />
        )}
        {tasks.map((task, i) => (
          <TaskRow key={task.id} task={task} index={i} showWorkspace={showWorkspace} />
        ))}
      </div>
    </div>
  );
}

function WorkLogCard({ workLog }: { workLog: WorkLogProject[] }) {
  const totalSeconds = workLog.reduce((s, p) => s + p.total_seconds, 0);
  const totalPomos = workLog.reduce((s, p) => s + p.tasks.reduce((ts, t) => ts + t.pomos, 0), 0);

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-clock-record" /> Work log</div>
        {totalSeconds > 0 && (
          <div className="pomo-card-meta">
            {totalPomos}p · {fmtDuration(totalSeconds)}
          </div>
        )}
      </div>

      {workLog.length === 0 ? (
        <div className="pomo-empty">
          <i className="ti ti-clock-off" />
          No focus sessions yet today.<br />
          Start a pomodoro in the extension to track time.
        </div>
      ) : (
        workLog.map((proj) => (
          <div className="pomo-project-group" key={proj.project_id ?? 'none'}>
            <div className="pomo-project-header">
              <span
                className="pomo-project-dot"
                style={{ background: proj.project_color }}
              />
              {proj.project_name}
              <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
                {fmtDuration(proj.total_seconds)}
              </span>
            </div>
            {proj.tasks.map((task) => (
              <div
                key={task.task_id ?? task.task_title}
                className={`pomo-work-row ${task.is_active ? 'active' : ''}`}
              >
                <span style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  {task.ticket_id && <span className="pomo-ticket-pill">{task.ticket_id}</span>}
                  {task.task_title}
                </span>
                <span className="pomo-time-pill">
                  {task.pomos}p · {fmtDuration(task.duration_seconds)}
                </span>
                <span className={task.is_active ? 'pomo-status-pill pomo-status-active' : 'pomo-status-pill pomo-status-done'}>
                  {task.is_active ? 'Active' : 'Done'}
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function fmtMeetingTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function meetingBadge(mode: string): React.CSSProperties {
  const accent = mode === 'once';
  return {
    fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
    color: accent ? 'var(--accent)' : 'var(--text-tert)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap', flexShrink: 0,
  };
}

function MeetingRow({ m }: { m: TodayMeeting }) {
  return (
    <div className="pomo-task-row" style={{ opacity: m.track_mode === 'off' ? 0.55 : 1 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-sec)', minWidth: 46 }}>
        {fmtMeetingTime(m.time)}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {m.title || 'Meeting'}
        {m.calendar_name && (
          <span style={{
            marginLeft: 6, fontSize: 10, color: 'var(--text-sec)', whiteSpace: 'nowrap',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px',
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
              background: m.calendar_color || 'var(--text-tert)',
            }} />
            {m.calendar_name}
          </span>
        )}
        {m.project_name && (
          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-tert)' }}>· {m.project_name}</span>
        )}
      </span>
      {m.track_mode === 'always' && <span style={meetingBadge('always')}>Always</span>}
      {m.track_mode === 'once' && <span style={meetingBadge('once')}>Today</span>}
      {m.logged && m.logged_minutes != null && m.logged_minutes > 0 && (
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          ✓ {m.logged_minutes}m
        </span>
      )}
      <span className="pomo-time-pill">{m.duration_minutes}m</span>
    </div>
  );
}

function MeetingsCard({ meetings }: { meetings: TodayMeeting[] }) {
  const [showAll, setShowAll] = useState(false);
  if (meetings.length === 0) return null;

  // Default to the meetings you're tracking today (Always + Today); the rest of
  // the day's calendar is behind "See all".
  const tracked = meetings.filter(m => m.track_mode !== 'off');
  const untracked = meetings.filter(m => m.track_mode === 'off');
  const shown = showAll ? meetings : tracked;

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-calendar-event" /> Meetings</div>
        <div className="pomo-card-meta">{meetings.length}</div>
      </div>
      {shown.length === 0 ? (
        <div className="pomo-empty" style={{ padding: '12px 0' }}>
          <span style={{ color: 'var(--text-tert)', fontSize: 12 }}>No meetings tracked for today.</span>
        </div>
      ) : (
        shown.map(m => <MeetingRow key={m.id} m={m} />)
      )}
      {untracked.length > 0 && (
        <button
          onClick={() => setShowAll(v => !v)}
          style={{
            width: '100%', marginTop: 6, padding: '6px 0', background: 'none', border: 'none',
            cursor: 'pointer', fontSize: 11, color: 'var(--text-tert)', textAlign: 'center',
          }}
        >
          {showAll ? 'Show tracked only' : `See all (${untracked.length} more on your calendar)`}
        </button>
      )}
    </div>
  );
}

function TimeCard({ workLog }: { workLog: WorkLogProject[] }) {
  const total = workLog.reduce((s, p) => s + p.total_seconds, 0);
  if (total === 0) return null;

  // Assign consistent colors per project
  const projectColors = [
    'var(--accent)', 'var(--success)', '#7B5DB4', 'var(--info)',
    'var(--warning)', '#E67E22', '#2ECC71',
  ];

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-clock-hour-4" /> Today's time</div>
        <div className="pomo-card-meta" style={{ fontFamily: 'var(--font-mono)' }}>
          {fmtDuration(total)}
        </div>
      </div>
      <div className="pomo-time-bar">
        {workLog.map((proj, i) => (
          <div
            key={proj.project_id ?? 'none'}
            style={{
              flex: proj.total_seconds,
              background: projectColors[i % projectColors.length],
            }}
          />
        ))}
      </div>
      <div className="pomo-time-legend">
        {workLog.map((proj, i) => (
          <div className="pomo-time-legend-row" key={proj.project_id ?? 'none'}>
            <span className="pomo-time-legend-name">
              <span
                className="pomo-time-legend-dot"
                style={{ background: projectColors[i % projectColors.length] }}
              />
              {proj.project_name}
            </span>
            <span className="pomo-time-legend-val">{fmtDuration(proj.total_seconds)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HabitsCard({ habits, date }: { habits: TodayHabit[]; date: string }) {
  if (habits.length === 0) return null;

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-heart-rate-monitor" /> Habits</div>
      </div>
      {habits.map((habit) => (
        <div className="pomo-habit-row" key={habit.id}>
          <span className="pomo-habit-name">
            <i
              className={`ti ${habitIconClass(habit.icon)}`}
              style={{ color: habitIconColor(habit.icon) }}
            />
            {habit.name}
          </span>

          {habit.kind === 'counter' && habit.target_count ? (() => {
            // Match the extension: show value/target (+ unit) instead of one dot
            // per unit — a goal of 20 rendered 20 dots, which is the "wrong
            // quantity" the dots showed.
            const value = habit.log?.value ?? 0;
            const target = habit.target_count;
            const done = value >= target;
            const display = habit.time_unit
              ? `${fmtHabitTime(value)}/${fmtHabitTime(target)}`
              : habit.unit && habit.unit_amount
                ? `${value * habit.unit_amount}/${target * habit.unit_amount} ${habit.unit}`
                : habit.unit
                  ? `${value}/${target} ${habit.unit}`
                  : `${value}/${target}`;
            return (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: done ? 'var(--success)' : 'var(--text-sec)' }}>
                {display}
              </span>
            );
          })() : (
            <div
              className={`pomo-switch ${habit.log?.done ? 'on' : ''}`}
              title={date}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function StatsCard({ stats }: { stats: TodayStats }) {
  return (
    <div className="pomo-card">
      <div className="pomo-stats-grid">
        <div className="pomo-stat">
          <div className="pomo-stat-value">{stats.tasks_done_today}</div>
          <div className="pomo-stat-label">tasks done today</div>
        </div>
        <div className="pomo-stat">
          <div className="pomo-stat-value">{stats.pomos_this_week}</div>
          <div className="pomo-stat-label">pomos this week</div>
        </div>
        {stats.tickets_this_week > 0 && (
          <div className="pomo-stat">
            <div className="pomo-stat-value">{stats.tickets_this_week}</div>
            <div className="pomo-stat-label">tickets this week</div>
          </div>
        )}
        {stats.pomos_today > 0 && (
          <>
            <div className="pomo-stat">
              <div className="pomo-stat-value">{stats.pomos_today}</div>
              <div className="pomo-stat-label">pomos today</div>
            </div>
            <div className="pomo-stat">
              <div className="pomo-stat-value">{fmtDuration(stats.seconds_today)}</div>
              <div className="pomo-stat-label">focus time today</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Daily report ──────────────────────────────────────────────────────────────

function buildReport(data: TodayData, dateStr: string): string {
  const lines: string[] = [];
  lines.push(`# Daily report — ${dateStr}`);
  lines.push('');

  const allTasks = [...data.priorities, ...data.tasks];
  const done = allTasks.filter(t => t.status === 'done');
  const pending = allTasks.filter(t => t.status !== 'done');

  if (done.length > 0) {
    lines.push('## Done');
    for (const t of done) {
      const ticket = t.ticket_id ? `[${t.ticket_id}] ` : '';
      const proj = t.project_name ? ` _(${t.project_name})_` : '';
      lines.push(`- [x] ${ticket}${t.title}${proj}`);
    }
    lines.push('');
  }

  if (pending.length > 0) {
    lines.push('## In progress / pending');
    for (const t of pending) {
      const ticket = t.ticket_id ? `[${t.ticket_id}] ` : '';
      const proj = t.project_name ? ` _(${t.project_name})_` : '';
      lines.push(`- [ ] ${ticket}${t.title}${proj}${t.status === 'in_progress' ? ' — active' : ''}`);
    }
    lines.push('');
  }

  if (data.work_log.length > 0) {
    const total = data.work_log.reduce((s, p) => s + p.total_seconds, 0);
    lines.push(`## Time tracked — ${fmtDuration(total)}`);
    for (const proj of data.work_log) {
      lines.push(`- **${proj.project_name}** — ${fmtDuration(proj.total_seconds)}`);
      for (const t of proj.tasks) {
        const ticket = t.ticket_id ? `[${t.ticket_id}] ` : '';
        lines.push(`  - ${ticket}${t.task_title} — ${t.pomos}p · ${fmtDuration(t.duration_seconds)}`);
      }
    }
    lines.push('');
  }

  const loggedHabits = data.habits.filter(h => h.log && (h.log.done || h.log.value > 0));
  if (loggedHabits.length > 0) {
    lines.push('## Habits');
    for (const h of loggedHabits) {
      const detail = h.kind === 'counter' && h.target_count ? ` (${h.log!.value}/${h.target_count})` : '';
      lines.push(`- ✓ ${h.name}${detail}`);
    }
    lines.push('');
  }

  lines.push('## Stats');
  lines.push(`- Pomos today: ${data.stats.pomos_today} · ${fmtDuration(data.stats.seconds_today)}`);
  lines.push(`- Tasks done today: ${data.stats.tasks_done_today}`);
  lines.push(`- Pomos this week: ${data.stats.pomos_this_week}`);
  if (data.stats.tickets_this_week > 0) lines.push(`- Tickets this week: ${data.stats.tickets_this_week}`);

  return lines.join('\n');
}

function ReportModal({ data, dateStr, onClose }: { data: TodayData; dateStr: string; onClose: () => void }) {
  const report = buildReport(data, dateStr);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const download = () => {
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pomodoso-report-${data.date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, width: 'min(640px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            <i className="ti ti-file-text" style={{ marginRight: 6 }} />
            Daily report
          </span>
          <button
            onClick={onClose}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tert)', fontSize: 16 }}
            title="Close"
          >
            <i className="ti ti-x" />
          </button>
        </div>
        <textarea
          readOnly
          value={report}
          style={{
            flex: 1, minHeight: 320, resize: 'none', border: 'none', outline: 'none',
            padding: '14px 18px', fontFamily: 'var(--font-mono)', fontSize: 12.5,
            lineHeight: 1.55, color: 'var(--text)', background: 'var(--bg-darker)',
          }}
        />
        <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--border)', justifyContent: 'flex-end' }}>
          <button className="pomo-btn" onClick={download}>
            <i className="ti ti-download" /> Download .md
          </button>
          <button className="pomo-btn" onClick={copy}>
            <i className={`ti ${copied ? 'ti-check' : 'ti-copy'}`} /> {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function TodayPage({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const date = todayDate();

  useEffect(() => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // 'all' → omit workspace_id; the backend aggregates every workspace
    const wsParam = workspaceId === 'all' ? '' : `workspace_id=${workspaceId}&`;
    api
      .get<TodayData>(`/today?${wsParam}date=${date}&tz=${tz}`)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workspaceId, date]);

  if (loading) {
    return (
      <div style={{ padding: '60px 36px', color: 'var(--text-tert)', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '60px 36px', color: 'var(--accent)', fontSize: 13 }}>
        {error ?? "Failed to load today’s data."}
      </div>
    );
  }

  const now = new Date();
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Workspace badge only makes sense when looking across workspaces.
  const showWorkspace = workspaceId === 'all';

  return (
    <>
      {/* Page header */}
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">{dayName}</div>
          <h1 className="pomo-page-title">{dateStr}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="pomo-btn">
            <i className="ti ti-calendar" /> Week view
          </button>
          <button className="pomo-btn pomo-btn-primary" onClick={() => setShowReport(true)}>
            <i className="ti ti-file-export" /> Generate report
          </button>
        </div>
      </div>

      {showReport && <ReportModal data={data} dateStr={`${dayName}, ${dateStr}`} onClose={() => setShowReport(false)} />}

      {/* Active pomodoro bar */}
      {data.active_session && <PomoBar session={data.active_session} />}

      {/* Main grid */}
      <div className="pomo-grid">
        <div className="pomo-left-col">
          <TodayTasksCard priorities={data.priorities} tasks={data.tasks} showWorkspace={showWorkspace} />
          <WorkLogCard workLog={data.work_log} />
        </div>

        <div className="pomo-right-col">
          <MeetingsCard meetings={data.meetings} />
          <TimeCard workLog={data.work_log} />
          <HabitsCard habits={data.habits} date={date} />
          <StatsCard stats={data.stats} />
        </div>
      </div>
    </>
  );
}
