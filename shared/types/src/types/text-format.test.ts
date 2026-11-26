import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyFormat, parseFormattedText } from './text-format.ts';

// ─── applyFormat ──────────────────────────────────────────────────────────────

test('wraps the selection and selects the result', () => {
  assert.deepEqual(applyFormat('make it bold', 8, 12, 'bold'), { value: 'make it **bold**', start: 8, end: 16 });
});

test('unwraps a selection that is already wrapped', () => {
  assert.deepEqual(applyFormat('make it **bold**', 8, 16, 'bold'), { value: 'make it bold', start: 8, end: 12 });
});

test('with no selection inserts an empty pair with the cursor inside', () => {
  assert.deepEqual(applyFormat('ab', 1, 1, 'code'), { value: 'a``b', start: 2, end: 2 });
});

test('bullet toggles every line the selection touches', () => {
  const on = applyFormat('one\ntwo\nthree', 0, 7, 'bullet');
  assert.equal(on.value, '- one\n- two\nthree');
  const off = applyFormat(on.value, 0, 11, 'bullet');
  assert.equal(off.value, 'one\ntwo\nthree');
});

test('bullet with a cursor only touches its own line', () => {
  assert.equal(applyFormat('one\ntwo', 5, 5, 'bullet').value, 'one\n- two');
});

test('clamps a selection outside the text', () => {
  assert.equal(applyFormat('hi', 5, 9, 'italic').value, 'hi__');
});

// ─── parseFormattedText ───────────────────────────────────────────────────────

test('parses bold, italic and code spans', () => {
  assert.deepEqual(parseFormattedText('a **b** _c_ `d`')[0]!.spans, [
    { text: 'a ' },
    { bold: true, text: 'b' },
    { text: ' ' },
    { italic: true, text: 'c' },
    { text: ' ' },
    { code: true, text: 'd' },
  ]);
});

test('nests italic inside bold', () => {
  assert.deepEqual(parseFormattedText('**a _b_**')[0]!.spans, [
    { bold: true, text: 'a ' },
    { bold: true, italic: true, text: 'b' },
  ]);
});

test('reads list items and strips their marker', () => {
  const [a, b, c] = parseFormattedText('- one\n* two\nthree');
  assert.deepEqual([a!.bullet, b!.bullet, c!.bullet], [true, true, false]);
  assert.equal(a!.spans[0]!.text, 'one');
});

test('leaves snake_case and unmatched markers alone', () => {
  assert.deepEqual(parseFormattedText('snake_case_name and 2 * 3')[0]!.spans, [{ text: 'snake_case_name and 2 * 3' }]);
});

test('code content is literal', () => {
  assert.deepEqual(parseFormattedText('`**x**`')[0]!.spans, [{ code: true, text: '**x**' }]);
});

test('round-trips what the buttons write', () => {
  const { value } = applyFormat('note', 0, 4, 'bold');
  assert.deepEqual(parseFormattedText(value)[0]!.spans, [{ bold: true, text: 'note' }]);
});
