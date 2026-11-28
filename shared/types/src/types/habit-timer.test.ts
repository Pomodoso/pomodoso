import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitHabitTimer, fmtClock, habitTimerElapsed, habitTimerGoalAt, habitTimerGoalDue, startHabitTimerState } from './habit-timer.ts';

const T0 = Date.UTC(2026, 10, 27, 10, 0, 0);

test('the goal moment accounts for time already logged today', () => {
  assert.equal(habitTimerGoalAt(T0, 300, 900), T0 + 600_000);
  // Already done: no goal moment, the clock just adds more.
  assert.equal(habitTimerGoalAt(T0, 900, 900), null);
  assert.equal(habitTimerGoalAt(T0, 0, null), null);
});

test('a commit takes whole seconds and keeps the clock running from there', () => {
  const s = startHabitTimerState('h', '2026-11-27', T0, 0, 900);
  assert.equal(habitTimerElapsed(s, T0 + 61_500), 61);
  const { seconds, next } = commitHabitTimer(s, T0 + 61_500);
  assert.equal(seconds, 61);
  assert.equal(next.startedAt, T0 + 61_000);
  assert.equal(next.goalAt, null);
  // The half second left over isn't lost.
  assert.equal(habitTimerElapsed(next, T0 + 62_000), 1);
});

test('the goal is due once, at its moment', () => {
  const s = startHabitTimerState('h', '2026-11-27', T0, 0, 900);
  assert.equal(habitTimerGoalDue(s, T0 + 899_000), false);
  assert.equal(habitTimerGoalDue(s, T0 + 900_000), true);
  assert.equal(habitTimerGoalDue(commitHabitTimer(s, T0 + 900_000).next, T0 + 1_000_000), false);
});

test('the clock reads h:mm:ss', () => {
  assert.equal(fmtClock(0), '00:00:00');
  assert.equal(fmtClock(754), '00:12:34');
  assert.equal(fmtClock(3725), '01:02:05');
});
