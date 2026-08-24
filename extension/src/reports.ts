import { localDate } from './dates.ts';
import type { MeetingRow, ProjectRow, TaskRow, TimeLogEntry } from './db.ts';

// Spec 6.6, extension reports: Today (logged tickets, pomos, total time,
// completed tasks) and a wider view grouped by project. Kept as pure
// functions over rows the caller already has, so the whole thing is testable
// without Dexie or a rendered popup — the interesting part here is the
// arithmetic, not the fetching.
//
// 'month' is in the range set even though spec 6.6 predates it: the task and
// habit history views both ship it already, and a report offering a narrower
// choice than the views beside it would just read as missing.

export type ReportRange = 'today' | 'week' | 'month';

/** The first day (inclusive, YYYY-MM-DD) a range covers.
 *
 *  Matches what the history views already do rather than inventing a third
 *  reading of the same words: 'week' runs from the most recent configured
 *  week-start day, and 'month' is a rolling 30 days, not a calendar month.
 */
export function rangeStartDate(range: ReportRange, timezone: string, weekStart: number): string {
  if (range === 'today') return localDate(timezone);
  if (range === 'month') return localDate(timezone, -30);
  return weekStartDate(timezone, weekStart);
}

/** YYYY-MM-DD of the most recent `weekStart` day (0=Mon … 6=Sun). */
export function weekStartDate(timezone: string, weekStart: number): string {
  const todayDow = (new Date(localDate(timezone) + 'T12:00:00').getDay() + 6) % 7;
  const daysSince = (todayDow - weekStart + 7) % 7;
  return localDate(timezone, -daysSince);
}

/** The day a task counts as belonging to: when it was last worked on, or
 *  failing any logged time, when it was last touched. */
export function getEffectiveDate(task: { updatedAt: string; timeLogs?: { startedAt: string }[] | undefined }): string {
  if (task.timeLogs && task.timeLogs.length > 0) {
    return task.timeLogs.reduce((max, l) => (l.startedAt > max ? l.startedAt : max), '').slice(0, 10);
  }
  return task.updatedAt.slice(0, 10);
}

export interface ReportLine {
  taskId: string;
  title: string;
  ticketId: string | null;
  status: TaskRow['status'];
  projectId: string | null;
  focusSeconds: number;
  pomos: number;
}

export interface ReportProjectLine {
  projectId: string | null;
  name: string;
  color: string | null;
  focusSeconds: number;
  pomos: number;
}

export interface ReportModel {
  range: ReportRange;
  from: string;
  to: string;
  focusSeconds: number;
  /** Counted from pomodoro-mode time logs, not the live "pomos today"
   *  counter, which only knows about the current day. */
  pomos: number;
  tasksCompleted: number;
  meetingsCount: number;
  meetingSeconds: number;
  byProject: ReportProjectLine[];
  lines: ReportLine[];
}

export interface ReportInput {
  tasks: TaskRow[];
  projects: ProjectRow[];
  meetings: MeetingRow[];
  range: ReportRange;
  from: string;
  to: string;
}

function logsInRange(logs: TimeLogEntry[] | undefined, from: string, to: string): TimeLogEntry[] {
  return (logs ?? []).filter(l => {
    const day = l.startedAt.slice(0, 10);
    return day >= from && day <= to;
  });
}

/** Rolls the raw rows up into everything the report surfaces need.
 *
 *  Only tasks with time logged inside the range appear as lines — a task
 *  touched but never worked on isn't something to report on. Completed tasks
 *  are counted separately for the same reason: finishing a task is worth
 *  reporting even when the work happened earlier.
 */
export function buildReport({ tasks, projects, meetings, range, from, to }: ReportInput): ReportModel {
  const projectById = new Map(projects.map(p => [p.id, p]));

  const lines: ReportLine[] = [];
  for (const t of tasks) {
    const logs = logsInRange(t.timeLogs, from, to);
    if (logs.length === 0) continue;
    lines.push({
      taskId: t.id,
      title: t.title,
      ticketId: t.ticketId,
      status: t.status,
      projectId: t.projectId,
      focusSeconds: logs.reduce((sum, l) => sum + l.durationSeconds, 0),
      pomos: logs.filter(l => l.mode === 'pomodoro').length,
    });
  }
  lines.sort((a, b) => b.focusSeconds - a.focusSeconds);

  const byProjectMap = new Map<string | null, ReportProjectLine>();
  for (const line of lines) {
    const key = line.projectId;
    const existing = byProjectMap.get(key);
    if (existing) {
      existing.focusSeconds += line.focusSeconds;
      existing.pomos += line.pomos;
      continue;
    }
    const project = key ? projectById.get(key) : undefined;
    byProjectMap.set(key, {
      projectId: key,
      name: project?.name ?? 'No project',
      color: project?.color ?? null,
      focusSeconds: line.focusSeconds,
      pomos: line.pomos,
    });
  }
  const byProject = [...byProjectMap.values()].sort((a, b) => b.focusSeconds - a.focusSeconds);

  // A task finished inside the range, whether or not the work was logged
  // there — getEffectiveDate falls back to updatedAt when nothing was.
  const tasksCompleted = tasks.filter(t => {
    if (t.status !== 'done') return false;
    const day = getEffectiveDate(t);
    return day >= from && day <= to;
  }).length;

  const loggedMeetings = meetings.filter(m => {
    if (!m.logged) return false;
    const day = m.time.slice(0, 10);
    return day >= from && day <= to;
  });

  return {
    range,
    from,
    to,
    focusSeconds: lines.reduce((sum, l) => sum + l.focusSeconds, 0),
    pomos: lines.reduce((sum, l) => sum + l.pomos, 0),
    tasksCompleted,
    meetingsCount: loggedMeetings.length,
    meetingSeconds: loggedMeetings.reduce((sum, m) => sum + (m.loggedMinutes ?? 0) * 60, 0),
    byProject,
    lines,
  };
}

/** "1h 25m" / "25m" / "0m" — the same shape the task rows already show. */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
