import { desc, eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useRef, useState } from 'react';

import { db } from '@/db/client';
import { pomodoroSession, timerPrefs } from '@/db/schema';
import { cancelScheduledNotification, scheduleSessionEndNotification } from '@/notifications';

// Device-local timer state (CLAUDE.md rule 8: server-authoritative only when
// sync is enabled — mobile free tier stays local, same as the extension).
// Mirrors extension/src/db.ts's session model loosely: no task table yet, so
// taskTitle is a plain label, not a real FK (comes with the shared/core
// extraction). "Mandatory task association" from spec 6.1 is relaxed here —
// a session can start with taskTitle=null ("unassigned time") — documented
// deviation, not silently dropped.

export type TimerMode = 'pomodoro' | 'stopwatch';
export type TimerStatus = 'idle' | 'active' | 'paused';

export const FOCUS_DURATION_SECONDS = 25 * 60;

export interface TimerDisplay {
  status: TimerStatus;
  mode: TimerMode;
  taskTitle: string | null;
  ticketRef: string | null;
  elapsedSeconds: number;
  remainingSeconds: number | null; // null for stopwatch
  progress: number; // 0..1, meaningful for pomodoro only
  pomosToday: number;
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
  // spec 6.1: "the mode used is the one currently selected on the toggle" —
  // shared (and persisted) across Home and Tasks, not a per-screen choice.
  const idleMode: TimerMode = prefsRows?.[0]?.lastMode ?? 'pomodoro';

  function setIdleMode(mode: TimerMode): void {
    db.update(timerPrefs).set({ lastMode: mode }).where(eq(timerPrefs.id, 'singleton')).run();
  }

  const active = (sessions ?? []).find(s => s.status === 'active' || s.status === 'paused');
  const isRunning = active?.status === 'active';

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
  useEffect(() => {
    if (!active || active.status !== 'active' || active.mode !== 'pomodoro' || !active.plannedDurationSeconds) return;
    const elapsed = secondsBetween(active.startedAt, nowIso());
    if (elapsed >= active.plannedDurationSeconds) {
      // The scheduled deadline, not "whenever this reconciliation happened to
      // run" — if the app was backgrounded past the deadline, nowIso() here
      // would inflate the recorded session duration by however long the app
      // was away.
      const deadline = new Date(new Date(active.startedAt).getTime() + active.plannedDurationSeconds * 1000).toISOString();
      db.update(pomodoroSession)
        .set({ status: 'completed', endedAt: deadline })
        .where(eq(pomodoroSession.id, active.id))
        .run();
    }
  });

  const today = new Date().toLocaleDateString('en-CA');
  const pomosToday = (sessions ?? []).filter(
    s =>
      s.mode === 'pomodoro' &&
      s.kind === 'focus' &&
      s.status === 'completed' &&
      new Date(s.startedAt).toLocaleDateString('en-CA') === today,
  ).length;

  let display: TimerDisplay;
  if (!active) {
    display = {
      status: 'idle',
      mode: idleMode,
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
      taskTitle: active.taskTitle,
      ticketRef: active.ticketRef,
      elapsedSeconds: elapsed,
      remainingSeconds: remaining,
      progress: active.plannedDurationSeconds ? Math.min(1, elapsed / active.plannedDurationSeconds) : 0,
      pomosToday,
    };
  }

  // Scheduling can fail (permission denied, OS error) — that shouldn't block
  // the actual state transition, just mean the session runs without a
  // background-completion notification.
  async function tryScheduleNotification(endsAt: Date, taskTitle: string | null): Promise<string | null> {
    try {
      return await scheduleSessionEndNotification(
        endsAt,
        'Pomodoro complete',
        taskTitle ? `Focus session on "${taskTitle}" is done.` : 'Focus session is done.',
      );
    } catch (err) {
      console.warn('Failed to schedule session-end notification', err);
      return null;
    }
  }

  async function startSession(mode: TimerMode, taskTitle: string | null, ticketRef: string | null): Promise<void> {
    if (active || isMutatingRef.current) return; // fast path: same-instance rapid taps bail here
    isMutatingRef.current = true;
    try {
      setIdleMode(mode); // spec 6.1: "updated on every session start"
      const plannedDurationSeconds = mode === 'pomodoro' ? FOCUS_DURATION_SECONDS : null;
      const startedAt = nowIso();
      let notificationId: string | null = null;
      if (mode === 'pomodoro' && plannedDurationSeconds) {
        notificationId = await tryScheduleNotification(new Date(Date.now() + plannedDurationSeconds * 1000), taskTitle);
      }
      // The isMutatingRef guard above is per-hook-instance — Home and Tasks
      // each mount their own useTimer(), so it can't stop one screen's start
      // from racing another's. The real guard is this: INSERT ... SELECT ...
      // WHERE NOT EXISTS, a single atomic SQLite statement, so only one
      // concurrent start can ever actually insert a row regardless of how
      // many screens/instances raced to get here.
      const result = db.run(sql`
        INSERT INTO pomodoro_session (id, mode, kind, task_title, ticket_ref, planned_duration_seconds, started_at, status, notification_id)
        SELECT ${uid()}, ${mode}, 'focus', ${taskTitle}, ${ticketRef}, ${plannedDurationSeconds}, ${startedAt}, 'active', ${notificationId}
        WHERE NOT EXISTS (SELECT 1 FROM pomodoro_session WHERE status IN ('active', 'paused'))
      `);
      if (result.changes === 0) {
        // Lost the race — another instance's start already landed. Don't
        // leave this call's notification orphaned.
        await cancelScheduledNotification(notificationId);
      }
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function pauseSession(): Promise<void> {
    if (!active || active.status !== 'active' || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      await cancelScheduledNotification(active.notificationId);
      db.update(pomodoroSession)
        .set({ status: 'paused', pausedAt: nowIso(), notificationId: null })
        .where(eq(pomodoroSession.id, active.id))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function resumeSession(): Promise<void> {
    if (!active || active.status !== 'paused' || !active.pausedAt || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      const pauseDurationMs = Date.now() - new Date(active.pausedAt).getTime();
      const shiftedStartedAt = new Date(new Date(active.startedAt).getTime() + pauseDurationMs).toISOString();

      let notificationId: string | null = null;
      if (active.mode === 'pomodoro' && active.plannedDurationSeconds) {
        const endsAt = new Date(new Date(shiftedStartedAt).getTime() + active.plannedDurationSeconds * 1000);
        notificationId = await tryScheduleNotification(endsAt, active.taskTitle);
      }

      db.update(pomodoroSession)
        .set({ status: 'active', startedAt: shiftedStartedAt, pausedAt: null, notificationId })
        .where(eq(pomodoroSession.id, active.id))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  async function stopSession(): Promise<void> {
    if (!active || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      await cancelScheduledNotification(active.notificationId);
      db.update(pomodoroSession)
        .set({ status: 'interrupted', endedAt: nowIso(), notificationId: null })
        .where(eq(pomodoroSession.id, active.id))
        .run();
    } finally {
      isMutatingRef.current = false;
    }
  }

  return { display, idleMode, setIdleMode, startSession, pauseSession, resumeSession, stopSession };
}
