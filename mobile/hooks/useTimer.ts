import { desc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';

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
      db.update(pomodoroSession)
        .set({ status: 'completed', endedAt: nowIso() })
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

  async function startSession(mode: TimerMode, taskTitle: string | null, ticketRef: string | null): Promise<void> {
    if (active) return; // one session at a time, matches "only one device controls it" simplification
    setIdleMode(mode); // spec 6.1: "updated on every session start"
    const plannedDurationSeconds = mode === 'pomodoro' ? FOCUS_DURATION_SECONDS : null;
    const startedAt = nowIso();
    let notificationId: string | null = null;
    if (mode === 'pomodoro' && plannedDurationSeconds) {
      const endsAt = new Date(Date.now() + plannedDurationSeconds * 1000);
      notificationId = await scheduleSessionEndNotification(
        endsAt,
        'Pomodoro complete',
        taskTitle ? `Focus session on "${taskTitle}" is done.` : 'Focus session is done.',
      );
    }
    db.insert(pomodoroSession)
      .values({
        id: uid(),
        mode,
        kind: 'focus',
        taskTitle,
        ticketRef,
        plannedDurationSeconds,
        startedAt,
        status: 'active',
        notificationId,
      })
      .run();
  }

  async function pauseSession(): Promise<void> {
    if (!active || active.status !== 'active') return;
    await cancelScheduledNotification(active.notificationId);
    db.update(pomodoroSession)
      .set({ status: 'paused', pausedAt: nowIso(), notificationId: null })
      .where(eq(pomodoroSession.id, active.id))
      .run();
  }

  async function resumeSession(): Promise<void> {
    if (!active || active.status !== 'paused' || !active.pausedAt) return;
    const pauseDurationMs = Date.now() - new Date(active.pausedAt).getTime();
    const shiftedStartedAt = new Date(new Date(active.startedAt).getTime() + pauseDurationMs).toISOString();

    let notificationId: string | null = null;
    if (active.mode === 'pomodoro' && active.plannedDurationSeconds) {
      const endsAt = new Date(new Date(shiftedStartedAt).getTime() + active.plannedDurationSeconds * 1000);
      notificationId = await scheduleSessionEndNotification(
        endsAt,
        'Pomodoro complete',
        active.taskTitle ? `Focus session on "${active.taskTitle}" is done.` : 'Focus session is done.',
      );
    }

    db.update(pomodoroSession)
      .set({ status: 'active', startedAt: shiftedStartedAt, pausedAt: null, notificationId })
      .where(eq(pomodoroSession.id, active.id))
      .run();
  }

  async function stopSession(): Promise<void> {
    if (!active) return;
    await cancelScheduledNotification(active.notificationId);
    db.update(pomodoroSession)
      .set({ status: 'interrupted', endedAt: nowIso(), notificationId: null })
      .where(eq(pomodoroSession.id, active.id))
      .run();
  }

  return { display, idleMode, setIdleMode, startSession, pauseSession, resumeSession, stopSession };
}
