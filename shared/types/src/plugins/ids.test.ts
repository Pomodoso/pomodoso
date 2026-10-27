import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dailyRecordId, uuidV5 } from './ids.ts';

const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

test('uuidV5 matches the RFC test vector and other implementations', () => {
  assert.equal(uuidV5('www.example.com', DNS), '2ed6657d-e927-568b-95e1-2665a8aea6a2');
  assert.equal(uuidV5('python.org', DNS), '886313e1-3b8a-5372-9b90-0c9aee199e5d');
});

test('long names cross SHA-1 block boundaries correctly', () => {
  // Expected value from Python's uuid.uuid5(uuid.NAMESPACE_DNS, 'x' * 200).
  assert.equal(uuidV5('x'.repeat(200), DNS), 'ddcc691a-b8e2-53e5-b059-6a232874b2eb');
});

test('a daily record id is the same for the same plugin, collection and day, and differs otherwise', () => {
  const plugin = 'a3f1c2d4-0000-4000-8000-000000000001';
  assert.equal(dailyRecordId(plugin, 'mood', '2026-10-21'), dailyRecordId(plugin, 'mood', '2026-10-21'));
  assert.notEqual(dailyRecordId(plugin, 'mood', '2026-10-21'), dailyRecordId(plugin, 'mood', '2026-10-22'));
  assert.notEqual(dailyRecordId(plugin, 'mood', '2026-10-21'), dailyRecordId(plugin, 'sleep', '2026-10-21'));
});
