import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHabitTime, habitClosed, habitTimeStep, parseHabitTime } from './habit-time.ts';

test('time formats as m:ss, and h:mm:ss from an hour', () => {
  assert.equal(fmtHabitTime(0), '0:00');
  assert.equal(fmtHabitTime(905), '15:05');
  assert.equal(fmtHabitTime(3725), '1:02:05');
  assert.equal(fmtHabitTime(-5), '0:00');
});

test('time parses m:ss, h:mm:ss and bare minutes', () => {
  assert.equal(parseHabitTime('15:00'), 900);
  assert.equal(parseHabitTime('1:02:05'), 3725);
  assert.equal(parseHabitTime('20'), 1200);
  assert.equal(parseHabitTime(fmtHabitTime(1234)), 1234);
});

test('the step defaults to a minute', () => {
  assert.equal(habitTimeStep(null), 60);
  assert.equal(habitTimeStep(0), 60);
  assert.equal(habitTimeStep(300), 300);
});

test('a habit closes the day after its end date', () => {
  assert.equal(habitClosed(null, '2026-11-27'), false);
  assert.equal(habitClosed('2026-11-27', '2026-11-27'), false);
  assert.equal(habitClosed('2026-11-26', '2026-11-27'), true);
});
