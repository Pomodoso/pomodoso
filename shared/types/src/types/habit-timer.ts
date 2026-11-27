// The clock on a timer habit: a free-running stopwatch (not a pomodoro) that
// adds what it ran to the habit's count for the day. Shared math; each client
// stores the running state on its own device and decides when to commit.
//
// The count only moves on commits: when the clock stops, and once when the
// goal is reached, so the habit is marked done (and syncs as done) even if
// the clock is left running. After the goal it keeps counting, and pressing
// play again on a finished habit adds more time to it.

export interface HabitTimerState {
  habitId: string;
  /** YYYY-MM-DD the time is credited to: the day the clock started. */
  day: string;
  /** Epoch ms the uncommitted stretch began. */
  startedAt: number;
  /** Epoch ms the goal is reached, or null when it already was (or there's none). */
  goalAt: number | null;
}

/** Whole seconds run since the last commit. */
export function habitTimerElapsed(state: HabitTimerState, now: number): number {
  return Math.max(0, Math.floor((now - state.startedAt) / 1000));
}

/** When a clock started now on a habit at `count` of `goal` seconds hits the goal. */
export function habitTimerGoalAt(startedAt: number, count: number, goal: number | null | undefined): number | null {
  return goal && goal > count ? startedAt + (goal - count) * 1000 : null;
}

export function startHabitTimerState(habitId: string, day: string, now: number, count: number, goal: number | null | undefined): HabitTimerState {
  return { habitId, day, startedAt: now, goalAt: habitTimerGoalAt(now, count, goal) };
}

/**
 * Takes what has run so far: the seconds to add to the count, and the state
 * that keeps running from there. The leftover fraction of a second stays in
 * the running stretch rather than being lost on every commit.
 */
export function commitHabitTimer(state: HabitTimerState, now: number): { seconds: number; next: HabitTimerState } {
  const seconds = habitTimerElapsed(state, now);
  return { seconds, next: { ...state, startedAt: state.startedAt + seconds * 1000, goalAt: null } };
}

/** Whether the goal moment has come and not been committed yet. */
export function habitTimerGoalDue(state: HabitTimerState, now: number): boolean {
  return state.goalAt !== null && now >= state.goalAt;
}

/** h:mm:ss, always with hours, for the running clock. */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
