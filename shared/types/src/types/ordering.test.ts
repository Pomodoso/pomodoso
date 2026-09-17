import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applySavedOrder,
  applyStatusPlacement,
  reorderSubset,
  statusPlacement,
} from './ordering.ts';

// ─── applySavedOrder ──────────────────────────────────────────────────────────

test('applySavedOrder follows the saved order', () => {
  assert.deepEqual(applySavedOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
});

test('applySavedOrder drops saved ids that no longer exist', () => {
  // 'gone' was deleted on another device — it must not hold a slot.
  assert.deepEqual(applySavedOrder(['a', 'b'], ['gone', 'b', 'a']), ['b', 'a']);
});

test('applySavedOrder appends ids the saved order has never seen', () => {
  // 'new' arrived from another device. Filtering it out would make a real
  // task look deleted, which is the bug this half exists to prevent.
  assert.deepEqual(applySavedOrder(['a', 'new', 'b'], ['b', 'a']), ['b', 'a', 'new']);
});

test('applySavedOrder keeps the natural order among unseen ids', () => {
  assert.deepEqual(applySavedOrder(['x', 'y', 'a'], ['a']), ['a', 'x', 'y']);
});

test('applySavedOrder with no saved order is the identity', () => {
  assert.deepEqual(applySavedOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
});

// ─── reorderSubset ────────────────────────────────────────────────────────────

test('reorderSubset leaves hidden items where they were', () => {
  // Only a, c and e are on screen; b and d are filtered out. Swapping a and e
  // must not move b or d off their own indexes.
  const full = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(reorderSubset(full, ['e', 'c', 'a']), ['e', 'b', 'c', 'd', 'a']);
});

test('reorderSubset over the whole list is a plain reorder', () => {
  assert.deepEqual(reorderSubset(['a', 'b', 'c'], ['c', 'b', 'a']), ['c', 'b', 'a']);
});

test('reorderSubset ignores ids that are not in the full list', () => {
  assert.deepEqual(reorderSubset(['a', 'b'], ['b', 'ghost', 'a']), ['b', 'a']);
});

test('reorderSubset always returns a permutation of the full list', () => {
  const full = ['a', 'b', 'c', 'd'];
  const out = reorderSubset(full, ['d', 'b']);
  assert.deepEqual([...out].sort(), [...full].sort());
  assert.equal(out.length, full.length);
});

test('reorderSubset with an empty subset changes nothing', () => {
  assert.deepEqual(reorderSubset(['a', 'b'], []), ['a', 'b']);
});

// ─── statusPlacement / applyStatusPlacement ───────────────────────────────────

test('resolved statuses sink, active rises, the rest hold', () => {
  assert.equal(statusPlacement('done'), 'end');
  assert.equal(statusPlacement('cancelled'), 'end');
  assert.equal(statusPlacement('in_progress'), 'start');
  assert.equal(statusPlacement('todo'), 'keep');
  // "not right now" is the one state where the hand-chosen position still wins.
  assert.equal(statusPlacement('delayed'), 'keep');
});

test('completing a task sends it to the end', () => {
  assert.deepEqual(applyStatusPlacement(['a', 'b', 'c'], 'a', 'done'), ['b', 'c', 'a']);
});

test('cancelling a task sends it to the end', () => {
  assert.deepEqual(applyStatusPlacement(['a', 'b', 'c'], 'b', 'cancelled'), ['a', 'c', 'b']);
});

test('starting a task brings it to the front', () => {
  assert.deepEqual(applyStatusPlacement(['a', 'b', 'c'], 'c', 'in_progress'), ['c', 'a', 'b']);
});

test('todo and delayed leave the order untouched', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(applyStatusPlacement(ids, 'a', 'todo'), ids);
  assert.equal(applyStatusPlacement(ids, 'a', 'delayed'), ids);
});

test('a task already in position returns the same array, so no write happens', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(applyStatusPlacement(ids, 'c', 'done'), ids);
  assert.equal(applyStatusPlacement(ids, 'a', 'in_progress'), ids);
});

test('a task outside the section is left alone', () => {
  const ids = ['a', 'b'];
  assert.equal(applyStatusPlacement(ids, 'elsewhere', 'done'), ids);
});

test('reopening is not an undo — the task keeps its new place', () => {
  const done = applyStatusPlacement(['a', 'b', 'c'], 'a', 'done');
  assert.deepEqual(done, ['b', 'c', 'a']);
  assert.deepEqual(applyStatusPlacement(done, 'a', 'todo'), ['b', 'c', 'a']);
});
