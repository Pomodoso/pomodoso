// The clock on timer habits, shared by the popup and the background.
//
// The running state lives in chrome.storage.local, device-local like an
// unsynced pomodoro, so it survives the popup closing. The background owns
// the goal moment: an alarm commits the time run so far (marking the habit
// done, which syncs) and notifies, while the clock keeps going. Stopping it
// commits the rest. See habit-timer.ts in @pomodoso/types for the math.

import {
  commitHabitTimer,
  fmtHabitTime,
  startHabitTimerState,
  type HabitTimerState,
} from '@pomodoso/types';

import { db, now } from './db';

export const HABIT_TIMER_KEY = 'habit_timer';
export const HABIT_TIMER_ALARM = 'habit-timer-goal';

export async function readHabitTimer(): Promise<HabitTimerState | null> {
  const r = await chrome.storage.local.get(HABIT_TIMER_KEY);
  return (r[HABIT_TIMER_KEY] as HabitTimerState | undefined) ?? null;
}

async function writeHabitTimer(state: HabitTimerState | null): Promise<void> {
  if (state) await chrome.storage.local.set({ [HABIT_TIMER_KEY]: state });
  else await chrome.storage.local.remove(HABIT_TIMER_KEY);
}

/** Adds seconds to a habit's count on `day`, stamping completion when it crosses the goal. */
export async function addHabitSeconds(habitId: string, day: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const habit = await db.habits.get(habitId);
  const goal = habit?.goal;
  const existing = await db.habitHistory.get([habitId, day]);
  const before = existing?.count ?? 0;
  const count = before + seconds;
  const justCompleted = goal != null && count >= goal && before < goal;
  await db.habitHistory.put({
    habitId,
    date: day,
    ...(existing ?? {}),
    count,
    ...(goal != null ? { goal } : {}),
    ...(justCompleted ? { completedAt: now() } : {}),
    updatedAt: now(),
  });
}

/** Starts the clock on a habit, stopping (and committing) any other first. */
export async function startHabitTimer(habitId: string, day: string): Promise<void> {
  await stopHabitTimer();
  const habit = await db.habits.get(habitId);
  const count = (await db.habitHistory.get([habitId, day]))?.count ?? 0;
  const state = startHabitTimerState(habitId, day, Date.now(), count, habit?.goal);
  await writeHabitTimer(state);
  if (state.goalAt !== null) chrome.alarms.create(HABIT_TIMER_ALARM, { when: state.goalAt });
}

/** Stops the clock and adds what it ran. A no-op when nothing is running. */
export async function stopHabitTimer(): Promise<void> {
  const state = await readHabitTimer();
  if (!state) return;
  await chrome.alarms.clear(HABIT_TIMER_ALARM);
  await writeHabitTimer(null);
  await addHabitSeconds(state.habitId, state.day, commitHabitTimer(state, Date.now()).seconds);
}

/**
 * The goal moment (background alarm): commits what ran, so the habit is done
 * and syncs as done, and keeps the clock running. Returns the habit's name and
 * goal for the notification, or null when the clock was stopped meanwhile.
 */
export async function reachHabitTimerGoal(): Promise<{ name: string; goal: string } | null> {
  const state = await readHabitTimer();
  if (!state || state.goalAt === null) return null;
  const { seconds, next } = commitHabitTimer(state, Date.now());
  await writeHabitTimer(next);
  await addHabitSeconds(state.habitId, state.day, seconds);
  const habit = await db.habits.get(state.habitId);
  return habit ? { name: habit.name, goal: fmtHabitTime(habit.goal ?? 0) } : null;
}
