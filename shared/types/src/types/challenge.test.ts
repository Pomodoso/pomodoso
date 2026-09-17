import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  challengeComplete,
  challengeDaysShown,
  challengeProgressLabel,
  challengeStreakLabel,
} from './challenge.ts';

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
