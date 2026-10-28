import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PluginHook, PluginManifest, PluginRecord } from '@pomodoso/types/plugins';

import type { PluginRow } from './db.ts';
import { EMPTY_PROMPT_STATE, breakKey, hookId, pendingDayEnd, pickBreakPrompt, promptHooks } from './pluginHooks.ts';

function plugin(id: string, hooks: PluginHook[], extra: Partial<PluginRow> = {}): PluginRow {
  return {
    id,
    slug: id,
    source: 'file',
    manifest: { hooks } as unknown as PluginManifest,
    settings: {},
    enabled: true,
    autoUpdate: false,
    installedOn: '2026-10-01',
    createdAt: `2026-10-01T00:00:0${id.length}Z`,
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

const smoke = plugin('a', [
  { on: 'pomodoro_end', ask: 'Smoked?', yes: { add: 'cigarette' } },
  { on: 'weekly_report', line: 'x' },
]);
const water = plugin('bb', [{ on: 'pomodoro_end', ask: 'Water?', yes: { add: 'glass' } }]);
const pixels = plugin('ccc', [{ on: 'day_end', ask: 'How was today?', pick: { collection: 'day_state', field: 'state' } }]);

test('prompt hooks come from live, enabled plugins for that event only', () => {
  const off = plugin('dddd', [{ on: 'pomodoro_end', ask: 'Off?', yes: { add: 'x' } }], { enabled: false });
  const gone = plugin('eeeee', [{ on: 'pomodoro_end', ask: 'Gone?', yes: { add: 'x' } }], { deletedAt: '2026-10-02T00:00:00Z' });
  assert.deepEqual(promptHooks([water, smoke, pixels, off, gone], 'pomodoro_end').map((c) => c.hook.ask), ['Smoked?', 'Water?']);
  assert.deepEqual(promptHooks([smoke, pixels], 'day_end').map((c) => c.hook.ask), ['How was today?']);
});

test('one question per break, rotating between plugins, stable within a break', () => {
  const cands = promptHooks([smoke, water], 'pomodoro_end');
  let s = pickBreakPrompt(cands, EMPTY_PROMPT_STATE, breakKey('2026-10-28', 1));
  assert.equal(s.break?.hook, hookId('a', 0));
  // Reopening the popup in the same break keeps the same question.
  assert.equal(pickBreakPrompt(cands, s, breakKey('2026-10-28', 1)), s);
  s = pickBreakPrompt(cands, { ...s, break: { ...s.break!, done: true } }, breakKey('2026-10-28', 2));
  assert.equal(s.break?.hook, hookId('bb', 0));
  assert.equal(s.break?.done, false);
  s = pickBreakPrompt(cands, s, breakKey('2026-10-28', 3));
  assert.equal(s.break?.hook, hookId('a', 0));
});

test('a break with no plugin questions records no hook', () => {
  const s = pickBreakPrompt([], EMPTY_PROMPT_STATE, breakKey('2026-10-28', 1));
  assert.equal(s.break?.hook, null);
});

test('day_end asks about yesterday until it is answered or dismissed', () => {
  const cands = promptHooks([pixels], 'day_end');
  const day = (state: string | undefined): PluginRecord[] =>
    state === undefined ? [] : [{ id: 'r', collection: 'day_state', day: '2026-10-27', created_at: '2026-10-27T22:00:00Z', data: { state } }];
  assert.equal(pendingDayEnd(cands, EMPTY_PROMPT_STATE, '2026-10-27', () => day(undefined))?.hook.ask, 'How was today?');
  assert.equal(pendingDayEnd(cands, EMPTY_PROMPT_STATE, '2026-10-27', () => day('great')), undefined);
  const dismissed = { ...EMPTY_PROMPT_STATE, dayEnd: { [hookId('ccc', 0)]: '2026-10-27' } };
  assert.equal(pendingDayEnd(cands, dismissed, '2026-10-27', () => []), undefined);
  // Installed today: there's no yesterday to ask about.
  const fresh = promptHooks([{ ...pixels, installedOn: '2026-10-28' }], 'day_end');
  assert.equal(pendingDayEnd(fresh, EMPTY_PROMPT_STATE, '2026-10-27', () => []), undefined);
});
