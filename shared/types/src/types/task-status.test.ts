import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_TASK_STATUS_CONFIG,
  addCustomTaskStatus,
  parseTaskStatusConfig,
  removeCustomTaskStatus,
  resolveTaskStatus,
  setBaseStatusHidden,
  statusIdForSystemChange,
  taskStatusOptions,
  updateCustomTaskStatus,
  type TaskStatusConfig,
} from './task-status.ts';

const review: TaskStatusConfig = {
  hidden: [],
  custom: [{ id: 'r', label: 'In review', base: 'in_progress' }],
};

// ─── parseTaskStatusConfig ────────────────────────────────────────────────────

test('parse: garbage reads as the defaults', () => {
  assert.deepEqual(parseTaskStatusConfig(null), DEFAULT_TASK_STATUS_CONFIG);
  assert.deepEqual(parseTaskStatusConfig('x'), DEFAULT_TASK_STATUS_CONFIG);
});

test('parse: drops malformed entries and keeps the rest', () => {
  const parsed = parseTaskStatusConfig({
    hidden: ['delayed', 'nope'],
    custom: [
      { id: 'a', label: ' QA ', base: 'in_progress' },
      { id: 'a', label: 'dup', base: 'todo' },
      { id: 'b', label: '', base: 'todo' },
      { id: 'c', label: 'Bad', base: 'merged' },
    ],
  });
  assert.deepEqual(parsed, { hidden: ['delayed'], custom: [{ id: 'a', label: 'QA', base: 'in_progress' }] });
});

test('parse: a required base with nothing visible is un-hidden', () => {
  // Two devices, each legal alone: one hid "In progress" while "In review"
  // existed, the other deleted "In review". LWW can keep both effects.
  assert.deepEqual(parseTaskStatusConfig({ hidden: ['in_progress', 'cancelled'], custom: [] }).hidden, ['cancelled']);
});

// ─── options / resolve ────────────────────────────────────────────────────────

test('options: customs sit right after the default they map to', () => {
  assert.deepEqual(
    taskStatusOptions(review).map(o => o.label),
    ['Todo', 'In progress', 'In review', 'Done', 'Delayed', 'Cancelled'],
  );
});

test('options: hidden defaults are left out', () => {
  const config = setBaseStatusHidden(review, 'in_progress', true);
  assert.ok(config);
  assert.deepEqual(
    taskStatusOptions(config).map(o => o.label),
    ['Todo', 'In review', 'Done', 'Delayed', 'Cancelled'],
  );
});

test('resolve: a custom id shows its label', () => {
  assert.equal(resolveTaskStatus('in_progress', 'r', review).label, 'In review');
});

test('resolve: an id that maps to another base is stale and ignored', () => {
  // An older client moved the task to done and left statusId alone.
  assert.deepEqual(resolveTaskStatus('done', 'r', review), { base: 'done', statusId: null, label: 'Done' });
});

test('resolve: an unknown id falls back to the base', () => {
  assert.equal(resolveTaskStatus('in_progress', 'gone', review).label, 'In progress');
});

// ─── statusIdForSystemChange ──────────────────────────────────────────────────

test('system change: a custom status on the same base is kept', () => {
  assert.equal(statusIdForSystemChange('in_progress', 'r', review), 'r');
});

test('system change: moving to another base drops the custom status', () => {
  assert.equal(statusIdForSystemChange('done', 'r', review), null);
});

test('system change: a hidden default is replaced by its first custom', () => {
  const config = setBaseStatusHidden(review, 'in_progress', true);
  assert.ok(config);
  assert.equal(statusIdForSystemChange('in_progress', null, config), 'r');
});

// ─── edits ────────────────────────────────────────────────────────────────────

test('edit: a required default cannot be hidden when it is the last of its base', () => {
  assert.equal(setBaseStatusHidden(DEFAULT_TASK_STATUS_CONFIG, 'done', true), null);
  assert.ok(setBaseStatusHidden(DEFAULT_TASK_STATUS_CONFIG, 'cancelled', true));
});

test('edit: the last custom of a hidden required base cannot be removed or moved', () => {
  const config = setBaseStatusHidden(review, 'in_progress', true);
  assert.ok(config);
  assert.equal(removeCustomTaskStatus(config, 'r'), null);
  assert.equal(updateCustomTaskStatus(config, 'r', { base: 'todo' }), null);
  assert.ok(removeCustomTaskStatus(review, 'r'));
});

test('edit: blank labels are refused', () => {
  assert.equal(addCustomTaskStatus(DEFAULT_TASK_STATUS_CONFIG, { id: 'x', label: '  ', base: 'todo' }), null);
  assert.equal(updateCustomTaskStatus(review, 'r', { label: ' ' }), null);
});
