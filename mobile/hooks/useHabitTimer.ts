import { commitHabitTimer, fmtHabitTime, habitTimerElapsed, habitTimerGoalDue, startHabitTimerState, type HabitTimerState } from '@pomodoso/types';
import { and, eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { db } from '@/db/client';
import { habitHistory, habits, settings } from '@/db/schema';
import { cancelScheduledNotification, scheduleSessionEndNotification } from '@/notifications';
import { habitLogId } from '@/utils/id';
import { playSound } from '@/utils/sounds';
import { triggerSync } from '@/utils/sync';

import { useSettings } from './useSettings';

// The clock on timer habits (mobile's side of the extension's habitTimer.ts):
// ▶ runs a stopwatch that adds to the habit's count for the day it started.
//
// The running state is a device-local setting (kept out of backups and never
// synced). The goal moment is a scheduled notification, and the time is
// committed (marking the habit done) by whichever screen is open when it
// comes, or the next time the app is. The clock keeps running after it.

export const HABIT_TIMER_KEY = 'habit_timer';

type Stored = HabitTimerState & { notificationId?: string | null };

/** Read fresh from the database every time: two mounted screens tick
 *  together, and the second must see the first's commit. */
function readState(): Stored | null {
  const raw = db.select().from(settings).where(eq(settings.key, HABIT_TIMER_KEY)).all()[0]?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
}

function writeState(state: Stored | null): void {
  if (!state) {
    db.delete(settings).where(eq(settings.key, HABIT_TIMER_KEY)).run();
    return;
  }
  const value = JSON.stringify(state);
  db.insert(settings).values({ key: HABIT_TIMER_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

function addSeconds(habitId: string, day: string, seconds: number): void {
  if (seconds <= 0) return;
  const now = new Date().toISOString();
  db.insert(habitHistory)
    .values({ id: habitLogId(habitId, day), habitId, date: day, count: seconds, done: false, updatedAt: now })
    .onConflictDoUpdate({
      target: habitHistory.id,
      set: { count: sql`${habitHistory.count} + ${seconds}`, updatedAt: now },
    })
    .run();
}

function todayCount(habitId: string, day: string): number {
  return db.select().from(habitHistory)
    .where(and(eq(habitHistory.habitId, habitId), eq(habitHistory.date, day)))
    .all()[0]?.count ?? 0;
}

export interface HabitTimerView {
  habitId: string | null;
  /** Seconds run and not yet added to the count. */
  running: number;
  start: (habitId: string, day: string) => void;
  stop: () => void;
}

export function useHabitTimer(): HabitTimerView {
  const { settings: appSettings } = useSettings();
  const { data: rows } = useLiveQuery(db.select().from(settings).where(eq(settings.key, HABIT_TIMER_KEY)));
  const raw = rows?.[0]?.value;
  const state: Stored | null = raw ? (JSON.parse(raw) as Stored) : null;
  const [now, setNow] = useState(() => Date.now());

  // The goal moment: commit so the habit counts as done (and syncs), and keep
  // the clock running. Checked on every tick and whenever the app comes back.
  const reachGoalIfDue = useCallback(() => {
    const fresh = readState();
    if (!fresh || !habitTimerGoalDue(fresh, Date.now())) return;
    const { seconds, next } = commitHabitTimer(fresh, Date.now());
    writeState({ ...next, notificationId: null });
    addSeconds(fresh.habitId, fresh.day, seconds);
    playSound('task-done', appSettings.soundSettings);
    triggerSync();
  }, [appSettings.soundSettings]);

  useEffect(() => {
    if (!raw) return;
    setNow(Date.now());
    reachGoalIfDue();
    const id = setInterval(() => {
      setNow(Date.now());
      reachGoalIfDue();
    }, 1000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') reachGoalIfDue(); });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [raw, reachGoalIfDue]);

  const stop = useCallback(() => {
    const fresh = readState();
    if (!fresh) return;
    writeState(null);
    void cancelScheduledNotification(fresh.notificationId);
    addSeconds(fresh.habitId, fresh.day, commitHabitTimer(fresh, Date.now()).seconds);
    triggerSync();
  }, []);

  const start = useCallback((habitId: string, day: string) => {
    stop();
    const habit = db.select().from(habits).where(eq(habits.id, habitId)).all()[0];
    if (!habit) return;
    const next: Stored = startHabitTimerState(habitId, day, Date.now(), todayCount(habitId, day), habit.goal);
    writeState(next);
    if (next.goalAt !== null) {
      void scheduleSessionEndNotification(
        new Date(next.goalAt),
        `${habit.name}: ${fmtHabitTime(habit.goal ?? 0)} done ✓`,
        'Goal reached. The clock keeps going; stop it whenever you like.',
      ).then(id => {
        // Only if this run is still the one going: a quick stop or restart
        // must not get a stale id attached.
        const current = readState();
        if (id && current && current.startedAt === next.startedAt && current.habitId === habitId) {
          writeState({ ...current, notificationId: id });
        } else {
          void cancelScheduledNotification(id);
        }
      });
    }
  }, [stop]);

  return {
    habitId: state?.habitId ?? null,
    running: state ? habitTimerElapsed(state, now) : 0,
    start,
    stop,
  };
}

/**
 * What a habit row needs from the clock: its live count (today's plus what's
 * running), whether that makes it done, and the ▶/⏸ for timer habits.
 */
export function habitClockProps(
  habit: { id: string; kind: 'boolean' | 'counter'; count: number; done: boolean; goal: number | null; timeUnit: boolean; timer: boolean },
  timer: HabitTimerView,
  day: string,
): { count: number; done: boolean; clock: { running: boolean; onPress: () => void } | undefined } {
  const running = timer.habitId === habit.id;
  const count = habit.count + (running ? timer.running : 0);
  return {
    count,
    done: habit.kind === 'counter' ? count >= (habit.goal ?? 1) : habit.done,
    clock: habit.timer && habit.timeUnit
      ? { running, onPress: () => (running ? timer.stop() : timer.start(habit.id, day)) }
      : undefined,
  };
}
