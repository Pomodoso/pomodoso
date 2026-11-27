import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidYmd, taskScheduleDue, taskScheduleLabel, taskSchedulePresets } from './task-schedule.ts';

// 2026-11-27 is a Friday.
const TODAY = '2026-11-27';

test('a task is due on its day and after, not before', () => {
  assert.equal(taskScheduleDue('2026-11-27', 'todo', TODAY), true);
  // Not opened that day: it still comes in the next time.
  assert.equal(taskScheduleDue('2026-11-20', 'todo', TODAY), true);
  assert.equal(taskScheduleDue('2026-11-28', 'todo', TODAY), false);
});

test('an unscheduled, finished or cancelled task is never due', () => {
  assert.equal(taskScheduleDue(undefined, 'todo', TODAY), false);
  assert.equal(taskScheduleDue(null, 'todo', TODAY), false);
  assert.equal(taskScheduleDue('2026-11-20', 'done', TODAY), false);
  assert.equal(taskScheduleDue('2026-11-20', 'cancelled', TODAY), false);
  assert.equal(taskScheduleDue('garbage', 'todo', TODAY), false);
});

test('presets: tomorrow, and the next Monday', () => {
  assert.deepEqual(taskSchedulePresets(TODAY), { tomorrow: '2026-11-28', nextMonday: '2026-11-30' });
  // On a Monday, next Monday is a week away, not today.
  assert.equal(taskSchedulePresets('2026-11-30').nextMonday, '2026-12-07');
  // On a Sunday, it's tomorrow.
  assert.equal(taskSchedulePresets('2026-11-29').nextMonday, '2026-11-30');
});

test('labels read relative to today', () => {
  assert.equal(taskScheduleLabel('2026-11-28', TODAY), 'Tomorrow');
  assert.equal(taskScheduleLabel('2026-12-01', TODAY), 'Tue');
  assert.equal(taskScheduleLabel('2026-12-10', TODAY), 'Dec 10');
  assert.equal(taskScheduleLabel('2027-01-05', TODAY), 'Jan 5, 2027');
  assert.equal(taskScheduleLabel(TODAY, TODAY), 'Today');
});

test('only real dates are valid', () => {
  assert.equal(isValidYmd('2026-02-28'), true);
  assert.equal(isValidYmd('2026-02-31'), false);
  assert.equal(isValidYmd('2026-2-3'), false);
});
