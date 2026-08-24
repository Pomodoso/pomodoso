import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  habitDaysFromServer,
  habitFrequency,
  readExtra,
  settingId,
  writeExtra,
  type ExtraBag,
} from './sync-wire.ts';

// ─── writeExtra ───────────────────────────────────────────────────────────────

test('writeExtra omits a field this client does not carry', () => {
  const extra: ExtraBag = {};
  writeExtra(extra, 'preferredMode', undefined);
  assert.deepEqual(extra, {}, 'undefined must not reach the wire at all');
});

test('writeExtra sends an explicit null so a clear can travel', () => {
  const extra: ExtraBag = {};
  writeExtra(extra, 'description', null);
  assert.deepEqual(extra, { description: null });
});

test('writeExtra sends empty collections rather than dropping them', () => {
  // The bug this pins: dropping an emptied array is indistinguishable from
  // "I don't have this field", so removing every link never propagated.
  const extra: ExtraBag = {};
  writeExtra(extra, 'links', []);
  assert.deepEqual(extra, { links: [] });
});

test('writeExtra passes ordinary values through', () => {
  const extra: ExtraBag = {};
  writeExtra(extra, 'description', 'hello');
  writeExtra(extra, 'completedDates', ['2026-08-24']);
  assert.deepEqual(extra, { description: 'hello', completedDates: ['2026-08-24'] });
});

test('writeExtra keeps falsy-but-meaningful values', () => {
  const extra: ExtraBag = {};
  writeExtra(extra, 'count', 0);
  writeExtra(extra, 'title', '');
  writeExtra(extra, 'flag', false);
  assert.deepEqual(extra, { count: 0, title: '', flag: false });
});

// ─── readExtra ────────────────────────────────────────────────────────────────

test('readExtra takes the wire value when the key is present', () => {
  assert.equal(readExtra({ description: 'from server' }, 'description', 'local'), 'from server');
});

test('readExtra applies a clear instead of resurrecting the local value', () => {
  // The extension used to do `extra[key] ?? existing`, which turned a
  // deliberate clear back into the old text on the receiving device.
  assert.equal(readExtra({ description: null }, 'description', 'local'), null);
  assert.deepEqual(readExtra({ links: [] }, 'links', ['old']), []);
});

test('readExtra keeps the local value when the key is absent', () => {
  // Absent means the sender may not carry the field — mobile has no
  // preferredMode column, and must not blank the extension's.
  assert.equal(readExtra({}, 'preferredMode', 'pomodoro'), 'pomodoro');
});

test('readExtra round-trips with writeExtra for every state', () => {
  for (const value of ['text', '', 0, false, null, [], ['a'], { k: 1 }]) {
    const extra: ExtraBag = {};
    writeExtra(extra, 'field', value);
    assert.deepEqual(readExtra(extra, 'field', 'LOCAL'), value, `round-trip failed for ${JSON.stringify(value)}`);
  }
  // The one state that deliberately does not round-trip: absent stays local.
  const extra: ExtraBag = {};
  writeExtra(extra, 'field', undefined);
  assert.equal(readExtra(extra, 'field', 'LOCAL'), 'LOCAL');
});

// ─── habit frequency ──────────────────────────────────────────────────────────

test('habitFrequency maps empty and full weeks to daily', () => {
  assert.deepEqual(habitFrequency([]), { frequency: 'daily', frequency_days: null });
  assert.deepEqual(habitFrequency([0, 1, 2, 3, 4, 5, 6]), { frequency: 'daily', frequency_days: null });
});

test('habitFrequency recognises Monday-to-Friday', () => {
  assert.deepEqual(habitFrequency([0, 1, 2, 3, 4]), { frequency: 'weekdays', frequency_days: null });
});

test('habitFrequency treats any other five days as custom', () => {
  // Same length as weekdays, different days — the check is order-sensitive
  // on purpose, so this must not be mistaken for Mon-Fri.
  assert.deepEqual(habitFrequency([0, 1, 2, 3, 5]), { frequency: 'custom', frequency_days: '[0,1,2,3,5]' });
});

test('habitFrequency round-trips through habitDaysFromServer', () => {
  for (const days of [[], [0, 1, 2, 3, 4], [1, 3, 5], [6]]) {
    const { frequency, frequency_days } = habitFrequency(days);
    const back = habitDaysFromServer(frequency, frequency_days);
    const expected = days.length === 7 ? [] : days;
    assert.deepEqual(back, expected, `round-trip failed for ${JSON.stringify(days)}`);
  }
});

test('habitDaysFromServer degrades to every-day on unparseable input', () => {
  assert.deepEqual(habitDaysFromServer('custom', 'not json'), []);
  assert.deepEqual(habitDaysFromServer('custom', null), []);
});

// ─── setting ids ──────────────────────────────────────────────────────────────

test('settingId produces a syntactically valid UUID', () => {
  assert.match(settingId('timer_settings'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('settingId is stable and distinct per key', () => {
  // Stability is the whole point: two clients deriving different ids for the
  // same key means the setting lands twice on the backend and stops
  // converging.
  assert.equal(settingId('timer_settings'), settingId('timer_settings'));
  assert.notEqual(settingId('timer_settings'), settingId('sound_settings'));
});

test('settingId handles keys longer than the uuid it fills', () => {
  assert.match(settingId('a_very_long_setting_key_beyond_sixteen_bytes'), /^[0-9a-f-]{36}$/);
});
