import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  habitDaysFromServer,
  habitFrequency,
  pullScope,
  readExtra,
  readPullCursor,
  readSyncChoice,
  settingId,
  writeExtra,
  writePullCursor,
  writeSyncChoice,
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

// ─── pull cursor ──────────────────────────────────────────────────────────────

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const PROD = 'https://api.pomodoso.com';
const TUNNEL = 'https://pomodoso-mobile.t.pipehero.app';
const T = '2026-08-24T10:00:00.000Z';

test('a cursor round-trips within its own scope', () => {
  const scope = pullScope(USER_A, PROD);
  assert.equal(readPullCursor(writePullCursor(scope, T), scope), T);
});

test('a cursor from another backend is discarded', () => {
  // The case that actually happened: a device synced against a dev tunnel,
  // then had its API URL repointed at production. Honouring the tunnel's
  // timestamp made production answer with a near-empty delta, which the
  // client cannot distinguish from "nothing changed".
  const stored = writePullCursor(pullScope(USER_A, TUNNEL), T);
  assert.equal(readPullCursor(stored, pullScope(USER_A, PROD)), undefined);
});

test('a cursor from another account is discarded', () => {
  const stored = writePullCursor(pullScope(USER_A, PROD), T);
  assert.equal(readPullCursor(stored, pullScope(USER_B, PROD)), undefined);
});

test('a bare-timestamp cursor from before scoping is discarded', () => {
  // What every pre-existing install has stored. Nothing records which
  // account or backend issued it, so the only safe reading is none.
  assert.equal(readPullCursor(JSON.stringify(T), pullScope(USER_A, PROD)), undefined);
});

test('missing and malformed cursors both mean a full pull', () => {
  const scope = pullScope(USER_A, PROD);
  assert.equal(readPullCursor(undefined, scope), undefined);
  assert.equal(readPullCursor('', scope), undefined);
  assert.equal(readPullCursor('not json at all', scope), undefined);
  assert.equal(readPullCursor('null', scope), undefined);
  assert.equal(readPullCursor('[]', scope), undefined);
});

test('a cursor with the right scope but no usable timestamp is discarded', () => {
  const scope = pullScope(USER_A, PROD);
  assert.equal(readPullCursor(JSON.stringify({ scope }), scope), undefined);
  assert.equal(readPullCursor(JSON.stringify({ scope, since: 42 }), scope), undefined);
});

test('scopes are distinct across every axis that can change', () => {
  assert.notEqual(pullScope(USER_A, PROD), pullScope(USER_B, PROD));
  assert.notEqual(pullScope(USER_A, PROD), pullScope(USER_A, TUNNEL));
  assert.equal(pullScope(USER_A, PROD), pullScope(USER_A, PROD));
});

// ─── first-sign-in choice ─────────────────────────────────────────────────────

test('a choice round-trips within its own scope', () => {
  const scope = pullScope(USER_A, PROD);
  for (const choice of ['merge', 'cloud'] as const) {
    assert.equal(readSyncChoice(writeSyncChoice(scope, choice), scope), choice);
  }
});

test('a choice made for another account is not reused', () => {
  // The answer is about what happens to this device's data *for a given
  // account*. Reusing account A's answer would silently apply it to B —
  // and 'cloud' would erase the device without asking.
  const stored = writeSyncChoice(pullScope(USER_A, PROD), 'cloud');
  assert.equal(readSyncChoice(stored, pullScope(USER_B, PROD)), undefined);
});

test('a choice made against another backend is not reused', () => {
  const stored = writeSyncChoice(pullScope(USER_A, TUNNEL), 'cloud');
  assert.equal(readSyncChoice(stored, pullScope(USER_A, PROD)), undefined);
});

test('an absent or malformed choice means ask', () => {
  const scope = pullScope(USER_A, PROD);
  assert.equal(readSyncChoice(undefined, scope), undefined);
  assert.equal(readSyncChoice(null, scope), undefined);
  assert.equal(readSyncChoice('merge', scope), undefined, 'a bare string carries no scope');
  assert.equal(readSyncChoice({ scope }, scope), undefined);
  assert.equal(readSyncChoice({ scope, choice: 'wipe' }, scope), undefined, 'unknown verbs are not guessed at');
});

test('asking again is always preferred to acting on a doubtful answer', () => {
  // Every rejection path above returns undefined rather than a default.
  // Defaulting to 'merge' would silently union a borrowed device into an
  // account; defaulting to 'cloud' would erase one. Neither is recoverable,
  // and re-asking costs a dialog.
  const scope = pullScope(USER_A, PROD);
  for (const bad of [undefined, null, 0, '', 'cloud', [], { scope }, { choice: 'merge' }]) {
    assert.equal(readSyncChoice(bad, scope), undefined, `for ${JSON.stringify(bad)}`);
  }
});
