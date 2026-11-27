import { test } from 'node:test';
import assert from 'node:assert/strict';

import { challengeStartFromStreak, migrateChallengeColumns } from './challengeStarts.ts';

const weekdays = (date: string): boolean => {
  const dow = new Date(`${date}T12:00:00`).getDay();
  return dow !== 0 && dow !== 6;
};

test('the upgrade backfill keeps a challenge on its existing streak', () => {
  // Mon–Fri habit, done Wed 18 through Fri 20; today is Mon 23, not done yet.
  const done = new Set(['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(challengeStartFromStreak('2026-11-23', weekdays, d => done.has(d)), '2026-11-18');
});

test('a habit with no streak starts its run today', () => {
  assert.equal(challengeStartFromStreak('2026-11-23', weekdays, () => false), '2026-11-23');
});

test('the launch that adds the columns backfills start dates', () => {
  let backfilled = 0;
  const ran = migrateChallengeColumns(() => {}, () => { backfilled++; });
  assert.equal(ran, true);
  assert.equal(backfilled, 1);
});

test('later launches leave an unstamped challenge for useHabits to start today', () => {
  // The columns exist, so every ALTER TABLE throws. A challenge switched on
  // since then must not be dated from the habit's old streak.
  let backfilled = 0;
  const ran = migrateChallengeColumns(
    () => { throw new Error('duplicate column name'); },
    () => { backfilled++; },
  );
  assert.equal(ran, false);
  assert.equal(backfilled, 0);
});
