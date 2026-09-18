// Smoke tests against the real browser-action popup.
//
// Run with: pnpm --filter extension e2e   (builds first, then drives Chrome)
//
// Deliberately few and deliberately end-to-end. These cover the behaviours that
// CI cannot see, because CI type-checks, builds and unit-tests a popup nobody
// opens — and every one of those passed while dragging was completely broken.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { launch, openPopup, openTab, resetStorage, sleep } from './driver.mjs';
import {
  READ_ACHIEVEMENTS,
  READ_CHALLENGE_COMPLETION,
  SEED_HABIT_HISTORY,
  TASK_ORDER,
  seedTasks,
} from './fixtures.mjs';

const EXTENSION_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const results = [];
function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`${passed ? '  ok' : 'NOT OK'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/**
 * Reordering works in the popup window.
 *
 * The regression this exists for: Chrome's popup emits `resize` events that
 * aren't resizes, and dnd-kit treats a resize as "cancel the drag", so every
 * drag cancelled itself a few pixels in. Only reproducible here.
 */
async function testReorder(browser) {
  await resetStorage(browser);
  const tab = await openTab(browser);
  await seedTasks(tab, ['Alpha task', 'Bravo task', 'Charlie task']);
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
  await sleep(1500);

  const popup = await openPopup(browser);
  await sleep(1500);

  const rows = JSON.parse(await popup.js(`JSON.stringify(
    [...document.querySelectorAll('[aria-roledescription="sortable"]')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })
  )`));
  if (rows.length < 2) return check('reorder: tasks render in the popup', false, `${rows.length} rows`);

  const before = await popup.js(TASK_ORDER);
  await popup.drag(rows[0].x, rows[0].y, rows[0].x, rows[1].y + 12);
  const after = await popup.js(TASK_ORDER);
  check('reorder: dragging a task changes the order', before !== after, `${before} -> ${after}`);

  // The row is both a drag target and a click target; both must work.
  // Re-measured, because the drop reflows the list and settles with an
  // animation — clicking stale coordinates mid-transition hits nothing.
  await sleep(600);
  const settled = JSON.parse(await popup.js(`JSON.stringify(
    [...document.querySelectorAll('[aria-roledescription="sortable"]')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })
  )`));
  const last = settled[settled.length - 1] ?? rows[rows.length - 1];
  await popup.mouse('mouseMoved', last.x, last.y);
  await popup.mouse('mousePressed', last.x, last.y);
  await sleep(60);
  await popup.mouse('mouseReleased', last.x, last.y);
  await sleep(1500);
  check('reorder: a plain click still opens the task', await popup.js(`/Task detail/.test(document.body.innerText)`));
}

/**
 * A broken run asks instead of silently resetting, and each option states its
 * cost — keeping going spends a skip and forfeits the badge.
 */
async function testChallengeDecision(browser) {
  await resetStorage(browser);
  const tab = await openTab(browser);
  await tab.clickButton('/Use template/');
  await sleep(4000);
  await tab.js(`(${SEED_HABIT_HISTORY})(20, [3], 21)`);
  await tab.call('Page.reload', {});
  await sleep(6000);
  await tab.clickButton("/^Habits$/");
  await sleep(2000);

  const buttons = await tab.js(`JSON.stringify(
    [...document.querySelectorAll('button')].map(b => b.innerText.replace(/\\n/g, ' / '))
      .filter(t => /Keep going|Start over/.test(t))
  )`);
  check('challenge: a missed day offers keep-going and start-over', /Keep going/.test(buttons) && /Start over/.test(buttons), buttons);
  check('challenge: the skip cost is stated on the button', /gives up the badge/.test(buttons));
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
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
  await resetStorage(browser);
  const tab = await openTab(browser);
  await tab.clickButton('/Use template/');
  await sleep(4000);
  await tab.js(`(${SEED_HABIT_HISTORY})(20, [], 21)`);
  await tab.call('Page.reload', {});
  await sleep(7000);
  await tab.clickButton("/^Habits$/");
  await sleep(2500);

  const completed = await tab.js(READ_CHALLENGE_COMPLETION);
  check('challenge: a run complete from history records its completion',
    Array.isArray(completed) && completed.some(Boolean), JSON.stringify(completed));

  const kinds = await tab.js(READ_ACHIEVEMENTS);
  check('achievements: a clean 21-day run awards a medal',
    Array.isArray(kinds) && kinds.includes('challenge_21'), JSON.stringify(kinds));

  check('achievements: the medal is shown with its tier',
    /Bronze/.test(await tab.js(`document.body.innerText`)));
  await browser.send('Target.closeTarget', { targetId: tab.targetId });
}

const browser = await launch(EXTENSION_DIR);
try {
  await testReorder(browser);
  await testChallengeDecision(browser);
  await testCompletionAndAward(browser);
} finally {
  browser.close();
}

const failed = results.filter(r => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
