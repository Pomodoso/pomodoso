import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { db } from '@/db/client';
import { pomodoroSession, task, timerPrefs } from '@/db/schema';
import { cancelScheduledNotification, dismissDeliveredSessionAlerts, scheduleSessionEndNotification } from '@/notifications';
import { uid } from '@/utils/id';
import { endPomodoroActivity, syncPomodoroActivity } from '@/utils/liveActivity';
import { endPomodoroNotification, syncPomodoroNotification } from '@/utils/ongoingNotification';
import { playSound } from '@/utils/sounds';
import { triggerSync } from '@/utils/sync';
import { secondsBetween } from '@/utils/time';

import { useSettings } from './useSettings';
import { useWorkspace } from './useWorkspace';

// Device-local timer state (CLAUDE.md rule 8: server-authoritative only when
// sync is enabled — mobile free tier stays local, same as the extension).
// "Mandatory task association" from spec 6.1 is relaxed here — a session can
// start with taskId=null ("unassigned time") — documented deviation, not
// silently dropped.

export type TimerMode = 'pomodoro' | 'stopwatch';
export type SessionKind = 'focus' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'active' | 'paused';

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
  focusSeconds: number; // from settings — for the idle-state preview ring
  dailyGoal: number; // from settings — "Pomo X of {dailyGoal} today"
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
  // Tracks which completed session's prompt has already been auto-started,
  // so the effect below fires once per session rather than re-triggering on
  // every render while pendingBreak/pendingNextFocus are non-null.
  const autoStartedForRef = useRef<string | null>(null);
  const { workspaceId, scopeId } = useWorkspace();
  // Scoped to the active workspace, matching extension's `inWs` (App.tsx).
  // Unscoped, the daily pomo count and today's focus total summed every
  // workspace at once, and `active` could resolve to a session belonging to
  // one the user isn't looking at.
  const { data: sessions } = useLiveQuery(
    db
      .select()
      .from(pomodoroSession)
      .where(scopeId === null ? isNull(pomodoroSession.deletedAt) : and(isNull(pomodoroSession.deletedAt), eq(pomodoroSession.workspaceId, scopeId)))
      .orderBy(desc(pomodoroSession.startedAt)),
    [scopeId],
  );
  const { data: prefsRows } = useLiveQuery(db.select().from(timerPrefs));
  const { data: tasks } = useLiveQuery(
    db.select().from(task).where(scopeId === null ? isNull(task.deletedAt) : and(isNull(task.deletedAt), eq(task.workspaceId, scopeId))),
    [scopeId],
  );
  const taskById = new Map((tasks ?? []).map(t => [t.id, t]));
  const { settings } = useSettings();

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

  // Live Activity (Lock Screen / Dynamic Island) reconciliation — one
  // effect deriving "what should be showing" from the active session row
  // and syncing to it, rather than separate start/update/end calls
  // scattered across startSession/pauseSession/resumeSession/stopSession
  // below (see utils/liveActivity.ts's comment for why). Home and Tasks
  // each mount their own useTimer() instance, so this can fire from more
  // than one place when both happen to be mounted — harmless, since
  // syncPomodoroActivity just reconciles to the same target state either
  // way, not a toggle/mutation that could race destructively.
  useEffect(() => {
    if (!active) {
      endPomodoroActivity();
      endPomodoroNotification();
      return;
    }
    const presentation = {
      mode: active.mode as TimerMode,
      kind: active.kind,
      taskTitle: activeTask?.title ?? null,
      startedAtMs: new Date(active.startedAt).getTime(),
      plannedDurationSeconds: active.plannedDurationSeconds,
      pausedAtMs: active.status === 'paused' && active.pausedAt ? new Date(active.pausedAt).getTime() : null,
    };
    syncPomodoroActivity(active.id, presentation);
    // Android's equivalent surface. Each is a no-op on the other platform, so
    // both can be driven from this one reconciliation without branching here.
    syncPomodoroNotification(active.id, presentation);
  }, [active?.id, active?.status, active?.startedAt, active?.pausedAt, active?.kind, active?.mode, active?.plannedDurationSeconds, activeTask?.title]);

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
      const result = db
        .update(pomodoroSession)
        .set({ status: 'completed', endedAt: deadline, updatedAt: nowIso() })
        .where(and(eq(pomodoroSession.id, active.id), eq(pomodoroSession.status, 'active')))
        .run();
      // Only when THIS call actually won the write (see the status guard
      // above) — otherwise a second reconciliation racing the first would
      // play the sound twice for one real completion.
      if (result.changes > 0) {
        playSound(active.kind === 'focus' ? 'pomo-done' : 'break-done', settings.soundSettings);
        triggerSync();
      }
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

  // Extension's TodayFooter (HomeState.tsx) sums ALL timeLogs for today
  // regardless of mode (pomodoro or stopwatch aren't distinguished in the
  // tracked-time total, only in the separate pomo count above) — matched
  // here. kind='focus' still excludes breaks, same as pomosToday. Unlike
  // pomosToday, this deliberately includes 'interrupted' too — a stopwatch
  // session always ends via manual Stop (stopSession sets 'interrupted',
  // never 'completed', since there's no natural deadline to reconcile
  // against), and a focus session stopped early still logged real time
  // (spec 6.1: "marked interrupted with actual accumulated time"). Only
  // pomosToday needs the strict completed-only gate, since it's counting
  // whole finished pomodoros, not time spent.
  const trackedSecondsToday = (sessions ?? [])
    .filter(
      s =>
        s.kind === 'focus' &&
        (s.status === 'completed' || s.status === 'interrupted') &&
        s.endedAt &&
        new Date(s.startedAt).toLocaleDateString('en-CA') === today,
    )
    .reduce((sum, s) => sum + secondsBetween(s.startedAt, s.endedAt!), 0);
  const trackedMinutesToday = Math.floor(trackedSecondsToday / 60);

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
      // Deliberately NOT `pomosToday` — that's live and reflects the current
      // wall-clock day. If a completed session sits unresolved across local
      // midnight (banner ignored, app reopened the next day), pomosToday
      // would reset to 0 and silently turn a due long break into a short
      // one. Instead, freeze the ordinal to the session's own day: "this was
      // the Nth focus pomo completed on the day IT finished", computed once
      // from durable history, not from whatever day it happens to be now.
      const sessionDay = new Date(mostRecentUnresolved.startedAt).toLocaleDateString('en-CA');
      const ordinalThatDay = (sessions ?? []).filter(
        s =>
          s.mode === 'pomodoro' &&
          s.kind === 'focus' &&
          s.status === 'completed' &&
          new Date(s.startedAt).toLocaleDateString('en-CA') === sessionDay &&
          s.startedAt <= mostRecentUnresolved.startedAt,
      ).length;
      const isLongBreak = ordinalThatDay > 0 && ordinalThatDay % settings.longBreakEvery === 0;
      pendingBreak = {
        taskTitle,
        kind: isLongBreak ? 'long_break' : 'short_break',
        durationSeconds: isLongBreak ? settings.longBreakSeconds : settings.shortBreakSeconds,
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
      remainingSeconds: settings.focusSeconds,
      progress: 0,
      pomosToday,
      focusSeconds: settings.focusSeconds,
      dailyGoal: settings.dailyGoal,
    };
  } else {
    const elapsed = secondsBetween(active.startedAt, active.status === 'paused' && active.pausedAt ? active.pausedAt : nowIso());
    const remaining = active.plannedDurationSeconds != null ? Math.max(0, active.plannedDurationSeconds - elapsed) : null;
    display = {
      status: active.status as 'active' | 'paused',
      // Narrowed like `status` above: startSession only ever inserts
      // 'pomodoro'/'stopwatch' — 'manual' entries (useTasks.ts's
      // addManualTime) are always written directly as status='completed',
      // so an active/paused row can never actually be mode='manual'.
      mode: active.mode as TimerMode,
      kind: active.kind,
      taskTitle: activeTask?.title ?? null,
      ticketRef: activeTask?.ticketRef ?? null,
      elapsedSeconds: elapsed,
      remainingSeconds: remaining,
      progress: active.plannedDurationSeconds ? Math.min(1, elapsed / active.plannedDurationSeconds) : 0,
      pomosToday,
      focusSeconds: settings.focusSeconds,
      dailyGoal: settings.dailyGoal,
    };
  }

  // Starting anything new, or explicitly skipping/dismissing a banner,
  // implicitly resolves EVERY dangling prompt — not just the one the current
  // action is "about". Without this, bypassing a banner (e.g. tapping play
  // on a different task from the Tasks tab instead of reacting to Home's
  // break offer) leaves the older session's prompt unresolved; once the
  // newer session's own prompt gets handled, the stale older banner would
  // otherwise resurface for a session nobody cares about anymore.
  function resolveAllPendingPrompts(): void {
    db.update(pomodoroSession)
      .set({ promptResolved: true, updatedAt: nowIso() })
      .where(and(eq(pomodoroSession.status, 'completed'), eq(pomodoroSession.promptResolved, false)))
      .run();
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
      const plannedDurationSeconds = mode === 'pomodoro' ? settings.focusSeconds : null;
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
      // many screens/instances raced to get here. deleted_at IS NULL matters
      // now that removeTask soft-deletes rather than hard-deletes a task's
      // sessions (Fase B): an active/paused session tombstoned that way
      // still has its original status, and without this filter it would
      // silently block every future start forever — invisible in the UI
      // (which filters deletedAt like everywhere else) with no way to
      // recover (Greptile P1). The task-existence check closes a second,
      // narrower race the same fix missed: notification scheduling above is
      // async, so a task can be deleted while it's in flight — without this,
      // the INSERT would still land, creating a live session pointing at a
      // tombstoned task (title/ticket resolving to null everywhere it's
      // read). Checked atomically in the same statement, not as a separate
      // await after scheduling, for the same reason the "another session
      // running" check is inline here rather than a prior read.
      const result = db.run(sql`
        INSERT INTO pomodoro_session (id, workspace_id, mode, kind, task_id, planned_duration_seconds, started_at, status, notification_id, updated_at)
        SELECT ${uid()}, ${workspaceId}, ${mode}, 'focus', ${taskId}, ${plannedDurationSeconds}, ${startedAt}, 'active', ${notificationId}, ${startedAt}
        WHERE NOT EXISTS (SELECT 1 FROM pomodoro_session WHERE status IN ('active', 'paused') AND deleted_at IS NULL)
          AND (${taskId} IS NULL OR EXISTS (SELECT 1 FROM task WHERE id = ${taskId} AND deleted_at IS NULL))
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
      resolveAllPendingPrompts(); // starting something new supersedes any dangling banner
      void dismissDeliveredSessionAlerts(); // and supersedes the previous session's shade banner too
      setIdleMode(mode); // spec 6.1: "updated on every session start" — only once we know this call won
      // Matches extension's App.tsx: only pomodoro starts get a sound
      // (stopwatch doesn't), same event as a follow-up focus after a break.
      if (mode === 'pomodoro') playSound('focus-start', settings.soundSettings);
      // No triggerSync() here — an 'active' session is never itself pushed
      // (only completed focus sessions are, per push()'s filter); that
      // happens at the completion effect above. Firing it here would just
      // reset the shared debounce window for nothing new to send.
    } finally {
      isMutatingRef.current = false;
    }
  }

  // Shared by startBreak/startNextFocus: both insert a new active session
  // (atomically guarded the same way as startSession) and, only once that
  // insert actually wins, sweep every dangling prompt — so a lost race
  // doesn't silently dismiss a banner with nothing started in its place.
  async function startFollowUpSession(kind: SessionKind, taskId: string | null, durationSeconds: number): Promise<void> {
    if (active || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const startedAt = nowIso();
      const taskTitle = taskId ? (taskById.get(taskId)?.title ?? null) : null;
      const copy = notificationCopyFor(kind, taskTitle);
      const notificationId = await tryScheduleNotification(new Date(Date.now() + durationSeconds * 1000), copy.title, copy.body);
      // Same two guards as startSession (see its comment): no other live
      // session, and — since notification scheduling above is async — the
      // task hasn't been deleted while this was in flight.
      const result = db.run(sql`
        INSERT INTO pomodoro_session (id, workspace_id, mode, kind, task_id, planned_duration_seconds, started_at, status, notification_id, updated_at)
        SELECT ${uid()}, ${workspaceId}, 'pomodoro', ${kind}, ${taskId}, ${durationSeconds}, ${startedAt}, 'active', ${notificationId}, ${startedAt}
        WHERE NOT EXISTS (SELECT 1 FROM pomodoro_session WHERE status IN ('active', 'paused') AND deleted_at IS NULL)
          AND (${taskId} IS NULL OR EXISTS (SELECT 1 FROM task WHERE id = ${taskId} AND deleted_at IS NULL))
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
      resolveAllPendingPrompts();
      void dismissDeliveredSessionAlerts(); // see startSession
      // Matches background.ts: 'break-start' when the follow-up is a break,
      // 'focus-start' when it's the next pomodoro after one.
      playSound(kind === 'focus' ? 'focus-start' : 'break-start', settings.soundSettings);
      // No triggerSync() — same reasoning as startSession.
    } finally {
      isMutatingRef.current = false;
    }
  }

  function startBreak(): void {
    if (!mostRecentUnresolved || !pendingBreak) return;
    void startFollowUpSession(pendingBreak.kind, mostRecentUnresolved.taskId, pendingBreak.durationSeconds);
  }

  function skipBreak(): void {
    if (!mostRecentUnresolved) return;
    resolveAllPendingPrompts();
  }

  function startNextFocus(): void {
    if (!mostRecentUnresolved || !pendingNextFocus) return;
    void startFollowUpSession('focus', mostRecentUnresolved.taskId, settings.focusSeconds);
  }

  function dismissBreakDone(): void {
    if (!mostRecentUnresolved) return;
    resolveAllPendingPrompts();
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
        .set({ status: 'paused', pausedAt: nowIso(), notificationId: cancelled ? null : active.notificationId, updatedAt: nowIso() })
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
        .set({ status: 'active', startedAt: shiftedStartedAt, pausedAt: null, notificationId, updatedAt: nowIso() })
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

  // Ports the extension's attachTask/detachTask (background.ts): the pomodoro
  // itself keeps running untouched — same row, same startedAt, same scheduled
  // end notification — and only the task association changes.
  //
  // The stretch worked on the outgoing task is banked as its own completed
  // session row. That is what the extension puts on the wire for a timeLogs
  // entry (kind='focus', status='completed', started_at + duration), so a
  // segment made here round-trips into that client's timeLogs unchanged.
  //
  // Always mode='manual', never the live session's mode. The pomodoro tally
  // — both per-task and "Pomo N of 12" — counts mode='pomodoro' AND
  // status='completed', so inheriting 'pomodoro' here would score a
  // thirty-second fragment as a whole finished pomodoro. 'manual' is exactly
  // what the schema reserves for "a retroactive time-log entry with no live
  // timer lifecycle", which a banked partial stretch is; it still counts
  // toward the task's seconds. The live session keeps its own mode and is
  // still the one that can complete.
  function bankCurrentSegment(now: string): void {
    if (!active?.taskId) return;
    const segmentStart = active.taskSegmentStartedAt ?? active.startedAt;
    if (secondsBetween(segmentStart, now) <= 0) return;
    db.insert(pomodoroSession)
      .values({
        id: uid(),
        workspaceId: active.workspaceId,
        mode: 'manual',
        kind: 'focus',
        taskId: active.taskId,
        plannedDurationSeconds: null,
        startedAt: segmentStart,
        taskSegmentStartedAt: null,
        pausedAt: null,
        endedAt: now,
        status: 'completed',
        notificationId: null,
        // Already finished — a banked segment has no prompt to offer.
        promptResolved: true,
        updatedAt: now,
      })
      .run();
  }

  /** Detaches the current task, leaving the pomodoro running untouched. */
  async function detachTask(): Promise<void> {
    if (!active || active.status !== 'active' || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const now = nowIso();
      bankCurrentSegment(now);
      db.update(pomodoroSession)
        .set({ taskId: null, taskSegmentStartedAt: null, updatedAt: now })
        .where(eq(pomodoroSession.id, active.id))
        .run();
      triggerSync();
    } finally {
      isMutatingRef.current = false;
    }
  }

  /** Points the running pomodoro at a different task, banking the time spent
   *  on the previous one. Also the way to attach a task to a session started
   *  without one. */
  async function attachTask(taskId: string): Promise<void> {
    if (!active || active.status !== 'active' || isMutatingRef.current) return;
    if (active.taskId === taskId) return;
    isMutatingRef.current = true;
    try {
      const now = nowIso();
      bankCurrentSegment(now);
      db.update(pomodoroSession)
        // taskSegmentStartedAt, not startedAt: the time before this moment
        // belongs to whatever was attached before, and has just been banked.
        .set({ taskId, taskSegmentStartedAt: now, updatedAt: now })
        .where(eq(pomodoroSession.id, active.id))
        .run();
      triggerSync();
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function stopSession(): Promise<void> {
    if (!active || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const cancelled = await cancelScheduledNotification(active.notificationId);
      // Stopping from a paused state: no time has elapsed since pausedAt —
      // using nowIso() here would count the paused interval itself as
      // tracked/focus time in every downstream aggregation that computes
      // duration from (startedAt, endedAt).
      const endedAt = active.status === 'paused' && active.pausedAt ? active.pausedAt : nowIso();
      db.update(pomodoroSession)
        .set({ status: 'interrupted', endedAt, notificationId: cancelled ? null : active.notificationId, updatedAt: nowIso() })
        .where(and(eq(pomodoroSession.id, active.id), inArray(pomodoroSession.status, ['active', 'paused'])))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  // Auto-start the next phase the moment its prompt appears, rather than
  // waiting for a tap on the BreakBanner — the banner still renders (as a
  // brief "starting..." acknowledgement) but no longer requires the user to
  // act on it. JS can't run while the app is backgrounded, so a session
  // ending off-screen still needs the app reopened before this can fire;
  // what this removes is the SECOND action (tapping the banner) once it's
  // open, which was the actual friction reported in testing.
  useEffect(() => {
    if (!mostRecentUnresolved || autoStartedForRef.current === mostRecentUnresolved.id) return;
    autoStartedForRef.current = mostRecentUnresolved.id;
    if (pendingBreak) startBreak();
    else if (pendingNextFocus) startNextFocus();
  }, [mostRecentUnresolved, pendingBreak, pendingNextFocus]);

  return {
    display,
    idleMode,
    setIdleMode,
    trackedMinutesToday,
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
    attachTask,
    detachTask,
  };
}
