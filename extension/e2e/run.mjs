// Smoke tests against the real browser-action popup.
//
// Run with: pnpm --filter extension e2e   (builds first, then drives Chrome)
//
// Deliberately few and deliberately end-to-end. These cover the behaviours that
// CI cannot see, because CI type-checks, builds and unit-tests a popup nobody
// opens — and every one of those passed while dragging was completely broken.
//
// Every assertion runs against the popup window. A tab may be used to *seed*
// state, because writing twenty-one days of habit history needs a scriptable
// page that stays open, but nothing is ever asserted there: a tab does not
// reproduce popup-window behaviour, which is the entire reason this file
// exists.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { PopupClosedError, launch, openPopup, openTab, resetStorage, sleep } from './driver.mjs';
import {
  EXPORT_VIA_UI,
  READ_ACHIEVEMENTS,
  READ_CHALLENGE_COMPLETION,
  READ_PERSISTED_SHAPE,
  SEED_HABIT_HISTORY,
  TASK_ORDER,
  openBackupPage,
  seedTasks,
} from './fixtures.mjs';

const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  ok' : 'NOT OK'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/** Row centres of the sortable rows currently rendered. */
const SORTABLE_ROWS = `JSON.stringify(
  [...document.querySelectorAll('[aria-roledescription="sortable"]')].map(el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })
)`;

/** Seeds through a tab, then hands back a popup with that state loaded. */
async function seedThenOpenPopup(browser, seedInTab) {
  await resetStorage(browser);
  const tab = await openTab(browser);
  await seedInTab(tab);
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
  await sleep(1200);
  return openPopup(browser);
}

/**
 * Reordering works in the popup window, and the new order sticks.
 *
 * The regression this exists for: Chrome's popup emits `resize` events that
 * aren't resizes, and dnd-kit treats a resize as "cancel the drag", so every
 * drag cancelled itself a few pixels in. Only reproducible here.
 */
async function testReorder(browser) {
  let popup = await seedThenOpenPopup(browser, tab =>
    seedTasks(tab, ['Alpha task', 'Bravo task', 'Charlie task']));
  await sleep(1200);

  const rows = JSON.parse(await popup.js(SORTABLE_ROWS));
  if (rows.length < 2) return check('reorder: tasks render in the popup', false, `${rows.length} rows`);

  const before = JSON.parse(await popup.js(TASK_ORDER));
  await popup.drag(rows[0].x, rows[0].y, rows[0].x, rows[1].y + 12);
  const after = JSON.parse(await popup.settled(TASK_ORDER));

  // The exact permutation, not merely "something changed": a wrong order, or
  // rows vanishing from the list, would both pass a looser check.
  const expected = [before[1], before[0], ...before.slice(2)];
  check('reorder: dragging the first task past the second swaps exactly those two',
    JSON.stringify(after) === JSON.stringify(expected),
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

  // The row is both a drag target and a click target; both must work.
  // Re-measured, because the drop reflows the list and settles with an
  // animation — clicking stale coordinates mid-transition hits nothing.
  await sleep(600);
  const settled = JSON.parse(await popup.js(SORTABLE_ROWS));
  const last = settled[settled.length - 1] ?? rows[rows.length - 1];
  await popup.mouse('mouseMoved', last.x, last.y);
  await popup.mouse('mousePressed', last.x, last.y);
  await sleep(60);
  await popup.mouse('mouseReleased', last.x, last.y);
  await sleep(1500);
  check('reorder: a plain click still opens the task',
    await popup.js(`/Task detail/.test(document.body.innerText)`));

  // Reopening proves the order was persisted, not just animated into place.
  await browser.send('Target.closeTarget', { targetId: popup.targetId });
  await sleep(1000);
  popup = await openPopup(browser);
  await sleep(1500);
  const reopened = JSON.parse(await popup.settled(TASK_ORDER));
  check('reorder: the order survives reopening the popup',
    JSON.stringify(reopened) === JSON.stringify(expected), JSON.stringify(reopened));
  await browser.send('Target.closeTarget', { targetId: popup.targetId });
}

/**
 * A broken run asks instead of silently resetting, and each option states its
 * cost — keeping going spends a skip and forfeits the badge.
 */
async function testChallengeDecision(browser) {
  const popup = await seedThenOpenPopup(browser, async tab => {
    await tab.clickButton('/Use template/');
    await sleep(4000);
    await tab.js(`(${SEED_HABIT_HISTORY})(20, [3], 21)`);
  });
  await popup.clickButton("/^Habits$/");
  await sleep(2500);

  const buttons = await popup.js(`JSON.stringify(
    [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\\n/g, ' / '))
      .filter(t => /Keep going|Start over/.test(t))
  )`);
  check('challenge: a missed day offers keep-going and start-over',
    /Keep going/.test(buttons) && /Start over/.test(buttons), buttons);
  check('challenge: the skip cost is stated on the button', /gives up the badge/.test(buttons));
  await browser.send('Target.closeTarget', { targetId: popup.targetId });
}

/**
 * A run completed by history alone records its completion and awards the medal.
 *
 * The regression this exists for: completion used to be recomputed from the
 * live streak, so finishing and then resting one day revoked the trophy; and
 * later, a run completed without a fresh toggle recorded nothing at all and
 * lost the medal on "Go again".
 */
async function testCompletionAndAward(browser) {
  const popup = await seedThenOpenPopup(browser, async tab => {
    await tab.clickButton('/Use template/');
    await sleep(4000);
    await tab.js(`(${SEED_HABIT_HISTORY})(20, [], 21)`);
  });
  await popup.clickButton("/^Habits$/");
  await sleep(2500);

  const completed = await popup.js(READ_CHALLENGE_COMPLETION);
  check('challenge: a run complete from history records its completion',
    Array.isArray(completed) && completed.some(Boolean), JSON.stringify(completed));

  const kinds = await popup.js(READ_ACHIEVEMENTS);
  check('achievements: a clean 21-day run awards a medal',
    Array.isArray(kinds) && kinds.includes('challenge_21'), JSON.stringify(kinds));

  check('achievements: the medal is shown with its tier',
    /Bronze/.test(await popup.js(`document.body.innerText`)));
  await browser.send('Target.closeTarget', { targetId: popup.targetId });
}

/**
 * A backup carries the challenge run and the medals it earned, and restoring
 * one brings them back.
 *
 * CLAUDE.md spells out that a new table has to be added to backup.ts in three
 * separate places, and that missing one breaks import/export silently. That is
 * a rule no type checks and no unit test can enforce, so it gets checked by
 * actually exporting and re-importing through the buttons a user would press.
 *
 * Challenge state is the other half: it rides on the habit row rather than in
 * a table of its own, so it is invisible to a table-level review and is
 * exactly what a partial write drops.
 */
async function testBackupRoundTrip(browser) {
  const popup = await seedThenOpenPopup(browser, async tab => {
    await tab.clickButton('/Use template/');
    await sleep(4000);
    await tab.js(`(${SEED_HABIT_HISTORY})(20, [], 21)`);
  });
  // Visiting Habits is what records the completion and mints the medal.
  await popup.clickButton("/^Habits$/");
  await sleep(2500);

  const before = await popup.js(READ_PERSISTED_SHAPE);
  const parsedBefore = JSON.parse(before);
  check('backup: the fixture really produced a run and a medal',
    parsedBefore.challenges?.length > 0 && parsedBefore.achievements?.length > 0,
    before);

  await openBackupPage(popup);
  const json = await popup.js(EXPORT_VIA_UI);
  let envelope;
  try {
    envelope = JSON.parse(json);
  } catch {
    return check('backup: Export produces a readable backup', false, String(json).slice(0, 120));
  }
  check('backup: the export carries achievements as their own table',
    Array.isArray(envelope.data?.achievements) && envelope.data.achievements.length > 0,
    `tables: ${Object.keys(envelope.data ?? {}).join(', ')}`);

  const exportedHabit = (envelope.data?.habits ?? []).find(h => h.challengeLengthDays);
  check('backup: the export carries the challenge run on the habit',
    Boolean(exportedHabit?.challengeStartedAt && exportedHabit?.challengeCompletedAt),
    JSON.stringify({
      startedAt: exportedHabit?.challengeStartedAt ?? null,
      completedAt: exportedHabit?.challengeCompletedAt ?? null,
    }));

  // Import it back over a wiped profile — the restore path a user takes after
  // reinstalling, and the one where a missing table shows up as lost data.
  const dir = mkdtempSync(join(tmpdir(), 'pomodoso-backup-'));
  const file = join(dir, 'backup.json');
  writeFileSync(file, json);
  try {
    await browser.send('Target.closeTarget', { targetId: popup.targetId });
    await sleep(800);

    const fresh = await seedThenOpenPopup(browser, async tab => {
      await tab.clickButton('/Start empty/');
      await sleep(2500);
    });
    await openBackupPage(fresh);
    await fresh.setFileInput('#import-file', file);
    await sleep(1500);
    const confirmed = await fresh.clickButton('/Replace all data/');
    check('backup: choosing a file offers the replace-everything confirmation', confirmed === true);
    // importDb reloads the popup on success.
    await sleep(4000);

    const after = await fresh.js(READ_PERSISTED_SHAPE);
    check('backup: the run and its medal survive an export/import round trip',
      after === before, after === before ? '' : `${before}\n     vs ${after}`);
    await browser.send('Target.closeTarget', { targetId: fresh.targetId });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs a test, retrying once if the popup was closed out from under it.
 *
 * Narrow on purpose: only PopupClosedError retries, and only once. A failed
 * assertion is a result and never retried — a suite that reruns until it likes
 * the answer reports nothing. This covers the one failure that is genuinely
 * about the machine rather than the code: a popup closes as soon as anything
 * takes focus away from Chrome.
 */
async function run(test, browser) {
  const mark = results.length;
  try {
    await test(browser);
  } catch (err) {
    if (!(err instanceof PopupClosedError)) throw err;
    console.log(`  ..  ${test.name}: ${err.message}; retrying once`);
    // Discard whatever the abandoned attempt managed to record. It may have
    // got through some of its checks before the popup went, and keeping those
    // would report the same check twice.
    results.length = mark;
    await test(browser);
  }
}

const browser = await launch(EXTENSION_DIR);
try {
  await run(testReorder, browser);
  await run(testChallengeDecision, browser);
  await run(testCompletionAndAward, browser);
  await run(testBackupRoundTrip, browser);
} finally {
  browser.close();
}

const failed = results.filter(r => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
