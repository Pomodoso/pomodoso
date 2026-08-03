import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecurrenceRule } from '@pomodoso/types';
import { shouldOccurOn, lastOccurrenceOnOrBefore, activeOccurrence } from './recurrence.ts';

// All rules here are all-day (time: null) so date logic is independent of the
// wall clock — `shouldBeInTodayNow` reduces to `shouldOccurOn` for these.
const monthly1st: RecurrenceRule = {
  freq: 'monthly',
  monthDay: 1,
  time: null,
  startDate: '2026-01-01',
  carryOver: true,
};
const monthly1stNoCarry: RecurrenceRule = { ...monthly1st, carryOver: false };
const daily: RecurrenceRule = { freq: 'daily', time: null, startDate: '2026-01-01', carryOver: true };
const everyOtherDay: RecurrenceRule = { ...daily, interval: 2 }; // occurs Jan 1, 3, 5, ...
const weeklyMonWed: RecurrenceRule = {
  freq: 'weekly',
  weekdays: [1, 3], // Mon, Wed
  time: null,
  startDate: '2026-01-01',
  carryOver: true,
};

test('shouldOccurOn — monthly on the 1st', () => {
  assert.equal(shouldOccurOn(monthly1st, '2026-02-01'), true);
  assert.equal(shouldOccurOn(monthly1st, '2026-02-02'), false);
  assert.equal(shouldOccurOn(monthly1st, '2025-12-01'), false); // before startDate
});

test('shouldOccurOn — every other day counts from startDate', () => {
  assert.equal(shouldOccurOn(everyOtherDay, '2026-01-01'), true);
  assert.equal(shouldOccurOn(everyOtherDay, '2026-01-02'), false);
  assert.equal(shouldOccurOn(everyOtherDay, '2026-01-03'), true);
});

test('lastOccurrenceOnOrBefore — finds the previous occurrence', () => {
  // Monthly 1st: from any mid-month day, the last occurrence is that month's 1st.
  assert.equal(lastOccurrenceOnOrBefore(monthly1st, '2026-02-15'), '2026-02-01');
  assert.equal(lastOccurrenceOnOrBefore(monthly1st, '2026-02-01'), '2026-02-01'); // inclusive
  assert.equal(lastOccurrenceOnOrBefore(monthly1st, '2025-12-31'), null); // before startDate
});

test('lastOccurrenceOnOrBefore — weekly picks the nearest earlier weekday', () => {
  // 2026-01-01 is a Thursday; first Mon/Wed occurrences are Jan 5 (Mon), Jan 7 (Wed).
  assert.equal(lastOccurrenceOnOrBefore(weeklyMonWed, '2026-01-06'), '2026-01-05'); // Tue -> prev Mon
  assert.equal(lastOccurrenceOnOrBefore(weeklyMonWed, '2026-01-08'), '2026-01-07'); // Thu -> prev Wed
});

test('activeOccurrence — carry-over surfaces a missed occurrence (the bug)', () => {
  // The reported bug: monthly-on-the-1st task, app not opened on the 1st.
  // On the 2nd it must still surface the 1st's occurrence.
  assert.equal(activeOccurrence(monthly1st, '2026-02-02'), '2026-02-01');
  assert.equal(activeOccurrence(monthly1st, '2026-02-20'), '2026-02-01');
});

test('activeOccurrence — carry-over returns today when today is the occurrence', () => {
  assert.equal(activeOccurrence(monthly1st, '2026-02-01'), '2026-02-01');
});

test('activeOccurrence — non-carry-over only surfaces today', () => {
  assert.equal(activeOccurrence(monthly1stNoCarry, '2026-02-01'), '2026-02-01');
  assert.equal(activeOccurrence(monthly1stNoCarry, '2026-02-02'), null); // missed = gone
});

test('activeOccurrence — daily carry-over on a normal day is just today', () => {
  assert.equal(activeOccurrence(daily, '2026-03-10'), '2026-03-10');
});

test('activeOccurrence — returns null before the rule starts', () => {
  assert.equal(activeOccurrence(monthly1st, '2025-12-15'), null);
});

test('activeOccurrence — respects endDate for carry-over', () => {
  const ended: RecurrenceRule = { ...monthly1st, endDate: '2026-02-01' };
  // On 2026-03-05 the last occurrence <= today is 2026-02-01 (within range).
  assert.equal(activeOccurrence(ended, '2026-03-05'), '2026-02-01');
  // A rule that ended before its next occurrence yields nothing new.
  const endedEarly: RecurrenceRule = { ...monthly1st, endDate: '2026-01-15' };
  assert.equal(activeOccurrence(endedEarly, '2026-02-10'), '2026-01-01');
});
