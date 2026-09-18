import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  challengeComplete,
  challengeDaysShown,
  challengeProgressLabel,
  challengeStreakLabel,
  achievementTier,
  challengeCanKeepGoing,
  challengeDaysOf,
  challengeEarnsBadge,
  challengeKeepGoing,
  challengeNeedsDecision,
  challengeProgress,
  challengeRecordCompletion,
  challengeSkipAllowance,
  challengeSkipsLeft,
  challengeStartOver,
  habitStreakLabel,
  nextAchievementTier,
} from './challenge.ts';
import type { ChallengeDay, ChallengeState } from './challenge.ts';

test('a challenge completes on the day it reaches its length', () => {
  assert.equal(challengeComplete(20, 21), false);
  assert.equal(challengeComplete(21, 21), true);
});

test('the shown day count is capped at the challenge length', () => {
  // daysDone keeps climbing with the streak after the run is over; without the
  // cap a finished 21-day challenge reads "Day 34 of 21".
  assert.equal(challengeDaysShown(34, 21), 21);
  assert.equal(challengeDaysShown(5, 21), 5);
});

test('progress reads as a day count until it is complete', () => {
  assert.equal(challengeProgressLabel(0, 21), 'Day 0 of 21. One day at a time.');
  assert.equal(challengeProgressLabel(7, 21), 'Day 7 of 21. One day at a time.');
  assert.equal(challengeProgressLabel(21, 21), 'Completed! 21 of 21 days');
});

test('the streak line distinguishes "not started" from "running"', () => {
  assert.equal(challengeStreakLabel(0, 21), '0/21 days · no streak yet');
  assert.equal(challengeStreakLabel(1, 21), '1/21 days · streak alive');
});

test('the streak line caps at the length too', () => {
  assert.equal(challengeStreakLabel(34, 21), '21/21 days · streak alive');
});

test('a custom challenge length is respected throughout', () => {
  assert.equal(challengeProgressLabel(3, 7), 'Day 3 of 7. One day at a time.');
  assert.equal(challengeProgressLabel(7, 7), 'Completed! 7 of 7 days');
  assert.equal(challengeStreakLabel(9, 7), '7/7 days · streak alive');
});

test('the streak label reads as a count once there is one', () => {
  assert.equal(habitStreakLabel(0), 'No streak yet');
  assert.equal(habitStreakLabel(1), '🔥 1 day streak');
  assert.equal(habitStreakLabel(12), '🔥 12 day streak');
});

// ─── Challenge lifecycle ──────────────────────────────────────────────────────

const RUN = (over: Partial<ChallengeState> = {}): ChallengeState => ({
  lengthDays: 21, startedAt: '2026-09-01', completedAt: null, skippedDays: [], ...over,
});
const days = (spec: string, from = 1): ChallengeDay[] =>
  // "xx.x" — x done, . missed. Index maps to 2026-09-(from + i).
  [...spec].map((c, i) => ({
    date: `2026-09-${String(from + i).padStart(2, '0')}`,
    done: c === 'x',
  }));

test('progress counts done days and reports unforgiven misses', () => {
  const p = challengeProgress(RUN(), days('xx.xx'), '2026-09-06');
  assert.equal(p.daysDone, 4);
  assert.deepEqual(p.missedDays, ['2026-09-03']);
  assert.equal(challengeNeedsDecision(p), true);
});

test('today is never counted as missed — the day is not over', () => {
  const p = challengeProgress(RUN(), days('xx.'), '2026-09-03');
  assert.deepEqual(p.missedDays, []);
  assert.equal(challengeNeedsDecision(p), false);
});

test('a forgiven day stops counting as a miss but does not count as done', () => {
  const state = challengeKeepGoing(RUN(), ['2026-09-03']);
  const p = challengeProgress(state, days('xx.xx'), '2026-09-06');
  assert.deepEqual(p.missedDays, []);
  // Four done days out of 21: forgiving pushed the finish line out, it did not
  // award the day.
  assert.equal(p.daysDone, 4);
});

test('completion is permanent — a later rest day cannot revoke the trophy', () => {
  // The bug this whole model exists to prevent: a finished run whose streak
  // has since collapsed still reads as complete.
  const done = challengeRecordCompletion(RUN(), '2026-09-21');
  const p = challengeProgress(done, days('x'), '2026-10-01');
  assert.equal(p.complete, true);
  assert.equal(p.completedAt, '2026-09-21');
});

test('recording completion twice keeps the original date', () => {
  const first = challengeRecordCompletion(RUN(), '2026-09-21');
  assert.equal(challengeRecordCompletion(first, '2026-09-30').completedAt, '2026-09-21');
});

test('a completed run never asks for a decision', () => {
  const done = challengeRecordCompletion(RUN(), '2026-09-21');
  const p = challengeProgress(done, days('x.x'), '2026-10-01');
  assert.equal(challengeNeedsDecision(p), false);
});

// ─── The allowance: what happens on the second missed day ────────────────────

test('the allowance is about one skip per week, and never zero', () => {
  assert.equal(challengeSkipAllowance(21), 3);
  assert.equal(challengeSkipAllowance(7), 1);
  assert.equal(challengeSkipAllowance(30), 4);
  assert.equal(challengeSkipAllowance(3), 1);
});

test('a second missed day can still be forgiven, and is counted', () => {
  let state = challengeKeepGoing(RUN(), ['2026-09-03']);
  assert.equal(challengeSkipsLeft(state), 2);
  state = challengeKeepGoing(state, ['2026-09-10']);
  assert.equal(challengeSkipsLeft(state), 1);
  assert.deepEqual(state.skippedDays, ['2026-09-03', '2026-09-10']);
});

test('forgiveness runs out — the fourth miss on a 21-day run cannot be waved through', () => {
  let state = RUN();
  for (const d of ['2026-09-03', '2026-09-10', '2026-09-17']) state = challengeKeepGoing(state, [d]);
  assert.equal(challengeSkipsLeft(state), 0);
  assert.equal(challengeCanKeepGoing(state, ['2026-09-24']), false);
  // And the call refuses rather than overspending.
  assert.equal(challengeKeepGoing(state, ['2026-09-24']), state);
});

test('a multi-day break costs one skip per day', () => {
  const state = RUN();
  assert.equal(challengeCanKeepGoing(state, ['2026-09-03', '2026-09-04', '2026-09-05']), true);
  // Two days in a row is twice as expensive as one, with no special-casing.
  assert.equal(challengeCanKeepGoing(RUN({ lengthDays: 7 }), ['2026-09-03', '2026-09-04']), false);
});

test('starting over clears progress and returns the full allowance', () => {
  let state = challengeKeepGoing(RUN(), ['2026-09-03', '2026-09-10']);
  state = challengeStartOver(state, '2026-09-20');
  assert.equal(state.startedAt, '2026-09-20');
  assert.deepEqual(state.skippedDays, []);
  assert.equal(state.completedAt, null);
  assert.equal(challengeSkipsLeft(state), 3);
});

test('starting over after completing clears the completion', () => {
  const done = challengeRecordCompletion(RUN(), '2026-09-21');
  assert.equal(challengeStartOver(done, '2026-09-22').completedAt, null);
});

// ─── Badge eligibility ────────────────────────────────────────────────────────

test('only a 21-day run earns a badge', () => {
  assert.equal(challengeEarnsBadge(RUN({ lengthDays: 21 })), true);
  assert.equal(challengeEarnsBadge(RUN({ lengthDays: 7 })), false);
  assert.equal(challengeEarnsBadge(RUN({ lengthDays: 30 })), false);
  // Nothing stops a 3-day challenge existing; it just can't be farmed for badges.
  assert.equal(challengeEarnsBadge(RUN({ lengthDays: 3 })), false);
});

test('spending a single skip forfeits the badge', () => {
  const kept = challengeKeepGoing(RUN(), ['2026-09-03']);
  assert.equal(kept.skippedDays.length, 1);
  assert.equal(challengeEarnsBadge(kept), false);
});

test('starting over puts the badge back in play', () => {
  const kept = challengeKeepGoing(RUN(), ['2026-09-03']);
  assert.equal(challengeEarnsBadge(challengeStartOver(kept, '2026-09-10')), true);
});

// ─── Tiers ────────────────────────────────────────────────────────────────────

test('tiers step up at 1, 3, 5 and 10', () => {
  assert.equal(achievementTier(0), null);
  assert.equal(achievementTier(1), 'bronze');
  assert.equal(achievementTier(2), 'bronze');
  assert.equal(achievementTier(3), 'silver');
  assert.equal(achievementTier(4), 'silver');
  assert.equal(achievementTier(5), 'gold');
  assert.equal(achievementTier(9), 'gold');
  assert.equal(achievementTier(10), 'platinum');
  assert.equal(achievementTier(99), 'platinum');
});

test('the next tier counts down toward the threshold', () => {
  assert.deepEqual(nextAchievementTier(0), { tier: 'bronze', remaining: 1 });
  assert.deepEqual(nextAchievementTier(1), { tier: 'silver', remaining: 2 });
  assert.deepEqual(nextAchievementTier(4), { tier: 'gold', remaining: 1 });
  assert.deepEqual(nextAchievementTier(9), { tier: 'platinum', remaining: 1 });
  // Nothing above platinum to chase.
  assert.equal(nextAchievementTier(10), null);
});

// ─── challengeDaysOf ──────────────────────────────────────────────────────────

test('the run covers every scheduled day from its start through today', () => {
  const done = new Set(['2026-09-01', '2026-09-03']);
  const out = challengeDaysOf('2026-09-01', '2026-09-03', () => true, d => done.has(d));
  assert.deepEqual(out, [
    { date: '2026-09-01', done: true },
    { date: '2026-09-02', done: false },
    { date: '2026-09-03', done: true },
  ]);
});

test('unscheduled days are not part of the run at all', () => {
  // Only the 1st and 3rd are scheduled; the 2nd is not a miss, it is not a day.
  const scheduled = new Set(['2026-09-01', '2026-09-03']);
  const out = challengeDaysOf('2026-09-01', '2026-09-03', d => scheduled.has(d), () => true);
  assert.deepEqual(out.map(d => d.date), ['2026-09-01', '2026-09-03']);
});

test('a start date in the future yields nothing rather than walking backwards', () => {
  assert.deepEqual(challengeDaysOf('2026-09-10', '2026-09-01', () => true, () => true), []);
});

test('challengeDaysOf feeds challengeProgress end to end', () => {
  const done = new Set(['2026-09-01', '2026-09-02', '2026-09-04']);
  const out = challengeDaysOf('2026-09-01', '2026-09-05', () => true, d => done.has(d));
  const p = challengeProgress(RUN({ startedAt: '2026-09-01' }), out, '2026-09-05');
  assert.equal(p.daysDone, 3);
  assert.deepEqual(p.missedDays, ['2026-09-03']);
});
