import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { db } from '@/db/client';
import { pomodoroSession, task, timerPrefs } from '@/db/schema';
import { cancelScheduledNotification, scheduleSessionEndNotification } from '@/notifications';

// Device-local timer state (CLAUDE.md rule 8: server-authoritative only when
// sync is enabled — mobile free tier stays local, same as the extension).
// "Mandatory task association" from spec 6.1 is relaxed here — a session can
// start with taskId=null ("unassigned time") — documented deviation, not
// silently dropped.

export type TimerMode = 'pomodoro' | 'stopwatch';
export type SessionKind = 'focus' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'active' | 'paused';

export const FOCUS_DURATION_SECONDS = 25 * 60;
// Matches extension's DEFAULT_TIMER_SETTINGS (shared/types/src/types/index.ts)
// — global defaults, not per-workspace despite spec 6.1's wording; the
// extension itself only ever reads/writes these as a single flat settings
// row, no workspace scoping exists in its actual implementation either.
export const SHORT_BREAK_DURATION_SECONDS = 5 * 60;
export const LONG_BREAK_DURATION_SECONDS = 15 * 60;
export const LONG_BREAK_EVERY = 4;

export interface TimerDisplay {
  status: TimerStatus;
  mode: TimerMode;
  kind: SessionKind | null; // null while idle
  taskTitle: string | null;
  ticketRef: string | null;
  elapsedSeconds: number;
  remainingSeconds: number | null; // null for stopwatch
  progress: number; // 0..1, meaningful for pomodoro only
  pomosToday: number;
}

// Extension offers a break after a completed focus pomo, and the next focus
// after a completed break, always as a manual "Start / Skip" choice — it
// also silently auto-starts after a snooze-able countdown
// (background.ts:588,606,245-263), which we deliberately don't replicate:
// iOS can't reliably run that countdown while backgrounded, and silently
// starting a tracked session the user never tapped is worse than just
// waiting for them to act on the notification/banner.
export interface PendingBreak {
  taskTitle: string | null;
  kind: 'short_break' | 'long_break';
  durationSeconds: number;
}

export interface PendingNextFocus {
  taskTitle: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function secondsBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function notificationCopyFor(kind: SessionKind, taskTitle: string | null): { title: string; body: string } {
  if (kind === 'focus') {
    return {
      title: 'Pomodoro complete',
      body: taskTitle ? `Focus session on "${taskTitle}" is done.` : 'Focus session is done.',
    };
  }
  const label = kind === 'long_break' ? 'Long break' : 'Short break';
  return { title: `${label} complete`, body: 'Ready for the next pomodoro?' };
}

export function useTimer() {
  const [, forceTick] = useState(0);
  // `active` is a snapshot from the last render — two taps landing before the
  // live query re-renders would both see the same snapshot (e.g. both see no
  // active session and both insert one). This ref is set synchronously
  // before any `await`, so a second concurrent call bails out immediately
  // regardless of React's render timing.
  const isMutatingRef = useRef(false);
  const { data: sessions } = useLiveQuery(db.select().from(pomodoroSession).orderBy(desc(pomodoroSession.startedAt)));
  const { data: prefsRows } = useLiveQuery(db.select().from(timerPrefs));
  const { data: tasks } = useLiveQuery(db.select().from(task));
  const taskById = new Map((tasks ?? []).map(t => [t.id, t]));

  // spec 6.1: "the mode used is the one currently selected on the toggle" —
  // shared (and persisted) across Home and Tasks, not a per-screen choice.
  const idleMode: TimerMode = prefsRows?.[0]?.lastMode ?? 'pomodoro';

  function setIdleMode(mode: TimerMode): void {
    db.update(timerPrefs).set({ lastMode: mode }).where(eq(timerPrefs.id, 'singleton')).run();
  }

  const active = (sessions ?? []).find(s => s.status === 'active' || s.status === 'paused');
  const isRunning = active?.status === 'active';
  const activeTask = active?.taskId ? taskById.get(active.taskId) : undefined;

  // Live-update the display every second while a pomodoro/stopwatch is
  // actually counting (not while paused/idle — no point burning battery).
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => forceTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Reaching the end naturally (app stayed foregrounded) transitions the
  // session to completed — the notification itself already fired via the OS
  // regardless of foreground state, this just updates the stored status so
  // "pomos today" and the UI reflect it without waiting for a manual Stop.
  // Applies to focus AND break sessions alike — both are mode='pomodoro'
  // with a planned duration, this check doesn't need to know which.
  useEffect(() => {
    if (!active || active.status !== 'active' || active.mode !== 'pomodoro' || !active.plannedDurationSeconds) return;
    const elapsed = secondsBetween(active.startedAt, nowIso());
    if (elapsed >= active.plannedDurationSeconds) {
      // The scheduled deadline, not "whenever this reconciliation happened to
      // run" — if the app was backgrounded past the deadline, nowIso() here
      // would inflate the recorded session duration by however long the app
      // was away.
      const deadline = new Date(new Date(active.startedAt).getTime() + active.plannedDurationSeconds * 1000).toISOString();
      // Guard on status too, not just id — if a manual pause/stop already
      // landed between the elapsed check above and this write, this would
      // otherwise overwrite that newer state back to "completed".
      db.update(pomodoroSession)
        .set({ status: 'completed', endedAt: deadline })
        .where(and(eq(pomodoroSession.id, active.id), eq(pomodoroSession.status, 'active')))
        .run();
    }
  });

  const today = new Date().toLocaleDateString('en-CA');
  // Only kind='focus' counts — spec 6.1: "'Pomos today' counter only counts
  // mode=pomodoro AND kind=focus AND status=completed", breaks don't
  // contribute even though they're also mode='pomodoro'.
  const pomosToday = (sessions ?? []).filter(
    s =>
      s.mode === 'pomodoro' &&
      s.kind === 'focus' &&
      s.status === 'completed' &&
      new Date(s.startedAt).toLocaleDateString('en-CA') === today,
  ).length;

  // The most recently completed session (if any) whose post-session prompt
  // hasn't been resolved yet — at most one of pendingBreak/pendingNextFocus
  // is ever set, whichever this turns out to be. Deriving from real
  // `completed && !promptResolved` DB state (rather than a separate
  // in-memory "stage") means this survives the app being killed and
  // reopened, unlike the extension's chrome.storage-backed TimerState.
  const mostRecentUnresolved = (sessions ?? []).find(s => s.status === 'completed' && !s.promptResolved);

  let pendingBreak: PendingBreak | null = null;
  let pendingNextFocus: PendingNextFocus | null = null;
  if (mostRecentUnresolved && !active) {
    const taskTitle = mostRecentUnresolved.taskId ? (taskById.get(mostRecentUnresolved.taskId)?.title ?? null) : null;
    if (mostRecentUnresolved.kind === 'focus') {
      const isLongBreak = pomosToday > 0 && pomosToday % LONG_BREAK_EVERY === 0;
      pendingBreak = {
        taskTitle,
        kind: isLongBreak ? 'long_break' : 'short_break',
        durationSeconds: isLongBreak ? LONG_BREAK_DURATION_SECONDS : SHORT_BREAK_DURATION_SECONDS,
      };
    } else {
      pendingNextFocus = { taskTitle };
    }
  }

  let display: TimerDisplay;
  if (!active) {
    display = {
      status: 'idle',
      mode: idleMode,
      kind: null,
      taskTitle: null,
      ticketRef: null,
      elapsedSeconds: 0,
      remainingSeconds: FOCUS_DURATION_SECONDS,
      progress: 0,
      pomosToday,
    };
  } else {
    const elapsed = secondsBetween(active.startedAt, active.status === 'paused' && active.pausedAt ? active.pausedAt : nowIso());
    const remaining = active.plannedDurationSeconds != null ? Math.max(0, active.plannedDurationSeconds - elapsed) : null;
    display = {
      status: active.status as 'active' | 'paused',
      mode: active.mode,
      kind: active.kind,
      taskTitle: activeTask?.title ?? null,
      ticketRef: activeTask?.ticketRef ?? null,
      elapsedSeconds: elapsed,
      remainingSeconds: remaining,
      progress: active.plannedDurationSeconds ? Math.min(1, elapsed / active.plannedDurationSeconds) : 0,
      pomosToday,
    };
  }

  // Scheduling can fail (permission denied, OS error) — that shouldn't block
  // the actual state transition, just mean the session runs without a
  // background-completion notification.
  async function tryScheduleNotification(endsAt: Date, title: string, body: string): Promise<string | null> {
    try {
      return await scheduleSessionEndNotification(endsAt, title, body);
    } catch (err) {
      console.warn('Failed to schedule session-end notification', err);
      return null;
    }
  }

  async function startSession(mode: TimerMode, taskId: string | null): Promise<void> {
    if (active || isMutatingRef.current) return; // fast path: same-instance rapid taps bail here
    isMutatingRef.current = true;
    try {
      const plannedDurationSeconds = mode === 'pomodoro' ? FOCUS_DURATION_SECONDS : null;
      const startedAt = nowIso();
      const taskTitle = taskId ? (taskById.get(taskId)?.title ?? null) : null;
      let notificationId: string | null = null;
      if (mode === 'pomodoro' && plannedDurationSeconds) {
        const copy = notificationCopyFor('focus', taskTitle);
        notificationId = await tryScheduleNotification(new Date(Date.now() + plannedDurationSeconds * 1000), copy.title, copy.body);
      }
      // The isMutatingRef guard above is per-hook-instance — Home and Tasks
      // each mount their own useTimer(), so it can't stop one screen's start
      // from racing another's. The real guard is this: INSERT ... SELECT ...
      // WHERE NOT EXISTS, a single atomic SQLite statement, so only one
      // concurrent start can ever actually insert a row regardless of how
      // many screens/instances raced to get here.
      const result = db.run(sql`
        INSERT INTO pomodoro_session (id, mode, kind, task_id, planned_duration_seconds, started_at, status, notification_id)
        SELECT ${uid()}, ${mode}, 'focus', ${taskId}, ${plannedDurationSeconds}, ${startedAt}, 'active', ${notificationId}
        WHERE NOT EXISTS (SELECT 1 FROM pomodoro_session WHERE status IN ('active', 'paused'))
      `);
      if (result.changes === 0) {
        // Lost the race — another instance's start already landed. Don't
        // leave this call's notification orphaned, and don't persist its
        // mode as the shared preference (a losing call's mode shouldn't
        // override whatever the winning session actually started with).
        if (notificationId) {
          const cancelled = await cancelScheduledNotification(notificationId);
          if (!cancelled) {
            console.warn('Orphaned notification from a lost session-start race could not be cancelled:', notificationId);
          }
        }
        return;
      }
      setIdleMode(mode); // spec 6.1: "updated on every session start" — only once we know this call won
    } finally {
      isMutatingRef.current = false;
    }
  }

  // Shared by startBreak/startNextFocus: both insert a new active session
  // (atomically guarded the same way as startSession) and, only once that
  // insert actually wins, mark the just-completed session's prompt resolved
  // — so a lost race doesn't silently dismiss the banner with nothing
  // started in its place.
  async function startFollowUpSession(kind: SessionKind, taskId: string | null, durationSeconds: number, resolveSessionId: string): Promise<void> {
    if (active || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const startedAt = nowIso();
      const taskTitle = taskId ? (taskById.get(taskId)?.title ?? null) : null;
      const copy = notificationCopyFor(kind, taskTitle);
      const notificationId = await tryScheduleNotification(new Date(Date.now() + durationSeconds * 1000), copy.title, copy.body);
      const result = db.run(sql`
        INSERT INTO pomodoro_session (id, mode, kind, task_id, planned_duration_seconds, started_at, status, notification_id)
        SELECT ${uid()}, 'pomodoro', ${kind}, ${taskId}, ${durationSeconds}, ${startedAt}, 'active', ${notificationId}
        WHERE NOT EXISTS (SELECT 1 FROM pomodoro_session WHERE status IN ('active', 'paused'))
      `);
      if (result.changes === 0) {
        if (notificationId) {
          const cancelled = await cancelScheduledNotification(notificationId);
          if (!cancelled) {
            console.warn('Orphaned notification from a lost follow-up-start race could not be cancelled:', notificationId);
          }
        }
        return;
      }
      db.update(pomodoroSession).set({ promptResolved: true }).where(eq(pomodoroSession.id, resolveSessionId)).run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  function startBreak(): void {
    if (!mostRecentUnresolved || !pendingBreak) return;
    void startFollowUpSession(pendingBreak.kind, mostRecentUnresolved.taskId, pendingBreak.durationSeconds, mostRecentUnresolved.id);
  }

  function skipBreak(): void {
    if (!mostRecentUnresolved) return;
    db.update(pomodoroSession).set({ promptResolved: true }).where(eq(pomodoroSession.id, mostRecentUnresolved.id)).run();
  }

  function startNextFocus(): void {
    if (!mostRecentUnresolved || !pendingNextFocus) return;
    void startFollowUpSession('focus', mostRecentUnresolved.taskId, FOCUS_DURATION_SECONDS, mostRecentUnresolved.id);
  }

  function dismissBreakDone(): void {
    if (!mostRecentUnresolved) return;
    db.update(pomodoroSession).set({ promptResolved: true }).where(eq(pomodoroSession.id, mostRecentUnresolved.id)).run();
  }

  async function pauseSession(): Promise<void> {
    if (!active || active.status !== 'active' || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const cancelled = await cancelScheduledNotification(active.notificationId);
      db.update(pomodoroSession)
        // If cancellation failed, keep the id around instead of discarding
        // it — nulling it here would permanently lose the only reference to
        // a notification that's still actually scheduled.
        .set({ status: 'paused', pausedAt: nowIso(), notificationId: cancelled ? null : active.notificationId })
        // Guard on status too, not just id — a stale pause landing after the
        // session already completed/was stopped elsewhere shouldn't
        // resurrect it as "paused".
        .where(and(eq(pomodoroSession.id, active.id), eq(pomodoroSession.status, 'active')))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function resumeSession(): Promise<void> {
    if (!active || active.status !== 'paused' || !active.pausedAt || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      // If pausing earlier failed to cancel the old notification, its id is
      // still stored here — try once more before scheduling a replacement,
      // so a transient failure back at pause time doesn't leave two live
      // notifications for what's conceptually one session. NOTE (documented
      // limitation): if this second attempt also fails, the old notification
      // is overwritten and lost here anyway (a single notificationId column
      // can't track two in-flight ids) — accepted residual risk, same
      // category as the midnight-attribution note below: needs a schema
      // change (a list, not a single id) to close properly, low real-world
      // odds (would need cancellation to fail twice in a row).
      if (active.notificationId) {
        await cancelScheduledNotification(active.notificationId);
      }

      // NOTE (documented limitation): shifting startedAt to keep elapsed-time
      // math simple means a session paused before local midnight and resumed
      // after it gets attributed to the day it resumed on, not the day it
      // started — pomosToday/streaks would count it on the wrong day. Narrow
      // edge case (pause spanning exactly midnight); fixing it properly needs
      // a separate day-attribution field decoupled from startedAt, which is
      // schema scope beyond this spike.
      const pauseDurationMs = Date.now() - new Date(active.pausedAt).getTime();
      const shiftedStartedAt = new Date(new Date(active.startedAt).getTime() + pauseDurationMs).toISOString();

      let notificationId: string | null = null;
      if (active.mode === 'pomodoro' && active.plannedDurationSeconds) {
        const endsAt = new Date(new Date(shiftedStartedAt).getTime() + active.plannedDurationSeconds * 1000);
        const copy = notificationCopyFor(active.kind, activeTask?.title ?? null);
        notificationId = await tryScheduleNotification(endsAt, copy.title, copy.body);
      }

      const result = db
        .update(pomodoroSession)
        .set({ status: 'active', startedAt: shiftedStartedAt, pausedAt: null, notificationId })
        .where(and(eq(pomodoroSession.id, active.id), eq(pomodoroSession.status, 'paused')))
        .run();
      if (result.changes === 0 && notificationId) {
        // Lost the race (another instance already resumed/stopped this
        // session) — don't leave the notification we just scheduled orphaned.
        const cancelled = await cancelScheduledNotification(notificationId);
        if (!cancelled) {
          console.warn('Orphaned notification from a lost resume race could not be cancelled:', notificationId);
        }
      }
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function stopSession(): Promise<void> {
    if (!active || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const cancelled = await cancelScheduledNotification(active.notificationId);
      db.update(pomodoroSession)
        .set({ status: 'interrupted', endedAt: nowIso(), notificationId: cancelled ? null : active.notificationId })
        .where(and(eq(pomodoroSession.id, active.id), inArray(pomodoroSession.status, ['active', 'paused'])))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  return {
    display,
    idleMode,
    setIdleMode,
    pendingBreak,
    pendingNextFocus,
    startSession,
    startBreak,
    skipBreak,
    startNextFocus,
    dismissBreakDone,
    pauseSession,
    resumeSession,
    stopSession,
  };
}
