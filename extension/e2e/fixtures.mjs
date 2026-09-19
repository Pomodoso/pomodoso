import { sleep } from './driver.mjs';

// Seeding helpers. Everything goes through the page's own IndexedDB connection,
// because a 21-day challenge cannot be produced by clicking for 21 days.

export const SEED_HABIT_HISTORY = `(startedDaysAgo, missDaysAgo, lengthDays) => new Promise((resolve) => {
  const req = indexedDB.open('pomodoso');
  req.onerror = () => resolve('OPEN ERROR');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(['habits', 'habitHistory'], 'readwrite');
    const habits = tx.objectStore('habits');
    habits.getAll().onsuccess = (ev) => {
      const habit = ev.target.result.find(h => h.challengeLengthDays) || ev.target.result[0];
      if (!habit) { resolve('no habits'); return; }
      const day = (ago) => { const d = new Date(); d.setDate(d.getDate() - ago); return d.toLocaleDateString('en-CA'); };
      const hist = tx.objectStore('habitHistory');
      for (let i = startedDaysAgo; i >= 0; i--) {
        if (missDaysAgo.includes(i)) continue;
        hist.put({ habitId: habit.id, date: day(i), done: true, count: 99, updatedAt: new Date().toISOString() });
      }
      // Normalised so the run is unambiguous: every day scheduled, boolean kind.
      habit.challengeLengthDays = lengthDays;
      habit.challengeStartedAt = day(startedDaysAgo);
      habit.challengeSkippedDays = [];
      delete habit.challengeCompletedAt;
      habit.days = [];
      habit.kind = 'boolean';
      habit.updatedAt = new Date().toISOString();
      habits.put(habit);
      tx.oncomplete = () => resolve(habit.name);
      tx.onerror = () => resolve('TX ERROR');
    };
  };
})`;

export const READ_ACHIEVEMENTS = `new Promise((resolve) => {
  const req = indexedDB.open('pomodoso');
  req.onerror = () => resolve('OPEN ERROR');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('achievements')) { resolve([]); return; }
    const q = db.transaction('achievements', 'readonly').objectStore('achievements').getAll();
    q.onsuccess = () => resolve(q.result.map(a => a.kind));
  };
})`;

export const READ_CHALLENGE_COMPLETION = `new Promise((resolve) => {
  const req = indexedDB.open('pomodoso');
  req.onerror = () => resolve('OPEN ERROR');
  req.onsuccess = () => {
    const q = req.result.transaction('habits', 'readonly').objectStore('habits').getAll();
    q.onsuccess = () => resolve(
      q.result.filter(h => h.challengeLengthDays).map(h => h.challengeCompletedAt ?? null)
    );
  };
})`;

/**
 * Task titles in the list, in document order.
 *
 * Scoped to the sortable rows on purpose. While a drop animates, dnd-kit's
 * DragOverlay renders a second copy of the dragged row, so a document-wide
 * text scan reports four titles for three tasks — one of them twice — and the
 * assertion fails on a list that is perfectly correct. The overlay clone is a
 * plain row rather than a sortable, so asking for sortables excludes it by
 * construction instead of by timing.
 */
export const TASK_ORDER = `JSON.stringify(
  [...document.querySelectorAll('[aria-roledescription="sortable"]')]
    .map(el => (el.innerText || '').split('\\n').map(s => s.trim())
      .find(t => /^(Alpha|Bravo|Charlie) task$/.test(t)))
    .filter(Boolean)
)`;

/** Onboards, then creates tasks and puts them in Today. */
export async function seedTasks(tab, titles) {
  await tab.clickButton('/Start empty/');
  await sleep(2500);
  await tab.clickButton("/^Tasks$/");
  await sleep(1200);
  for (const title of titles) {
    await tab.clickButton('/Add task/');
    await sleep(700);
    await tab.js(`(() => {
      const f = [...document.querySelectorAll('input, textarea')].filter(e => !e.disabled && e.offsetParent !== null);
      if (f[0]) f[0].focus();
    })()`);
    for (const ch of title) {
      await tab.call('Input.dispatchKeyEvent', { type: 'char', text: ch });
    }
    await tab.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await tab.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1100);
    await tab.clickButton('/^←$/');
    await sleep(800);
    await tab.clickButton("/^Tasks$/");
    await sleep(700);
  }
  for (let i = 0; i < titles.length; i++) {
    const added = await tab.js(`(() => {
      const b = [...document.querySelectorAll('button')].filter(x => /\\+\\s*Today/i.test(x.innerText));
      if (!b.length) return false;
      b[0].click();
      return true;
    })()`);
    if (!added) break;
    await sleep(800);
  }
}

/**
 * Everything the new challenge/achievement work adds that a backup must carry.
 *
 * Challenge state lives in fields on the habit row rather than a table of its
 * own, which is exactly the shape that gets dropped by a partial write — the
 * `sortOrder` bug in #128 and again in #137 were both this. `sortOrder` is in
 * here for the same reason.
 */
export const READ_PERSISTED_SHAPE = `new Promise((resolve) => {
  const req = indexedDB.open('pomodoso');
  req.onerror = () => resolve('OPEN ERROR');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('achievements')) { resolve('NO ACHIEVEMENTS STORE'); return; }
    const tx = db.transaction(['habits', 'achievements'], 'readonly');
    const out = {};
    tx.objectStore('habits').getAll().onsuccess = (e) => {
      out.challenges = e.target.result
        .filter(h => h.challengeLengthDays)
        .map(h => ({
          name: h.name,
          lengthDays: h.challengeLengthDays,
          startedAt: h.challengeStartedAt ?? null,
          completedAt: h.challengeCompletedAt ?? null,
          skippedDays: h.challengeSkippedDays ?? null,
          sortOrder: h.sortOrder ?? null,
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    };
    tx.objectStore('achievements').getAll().onsuccess = (e) => {
      out.achievements = e.target.result
        .map(a => ({ id: a.id, kind: a.kind, earnedOn: a.earnedOn, habitId: a.habitId ?? null }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    };
    tx.oncomplete = () => resolve(JSON.stringify(out));
    tx.onerror = () => resolve('TX ERROR');
  };
})`;

/**
 * Clicks the real Export button and returns the JSON it produced.
 *
 * Captured by borrowing `URL.createObjectURL` rather than by intercepting the
 * download. The handler still runs `exportDb()` for real, which is the part
 * that can break; writing the blob to disk is Chrome's job and testing it here
 * would only test Chrome.
 *
 * The anchor's own click is stubbed for the same reason, and for a second one:
 * letting the download actually start hands focus to Chrome's download UI, and
 * a browser-action popup closes the instant it loses focus — so the real
 * download doesn't just add nothing, it destroys the window the rest of the
 * test needs.
 */
export const EXPORT_VIA_UI = `new Promise((resolve) => {
  const button = [...document.querySelectorAll('button')].find(b => /Export data/.test(b.innerText));
  if (!button) { resolve('NO EXPORT BUTTON'); return; }

  const originalCreate = URL.createObjectURL.bind(URL);
  const originalClick = HTMLAnchorElement.prototype.click;
  let timer;
  const finish = (value) => {
    URL.createObjectURL = originalCreate;
    HTMLAnchorElement.prototype.click = originalClick;
    window.removeEventListener('unhandledrejection', onReject);
    clearTimeout(timer);
    resolve(value);
  };
  // handleExport has a try/finally and no catch, so a failing exportDb()
  // surfaces only as an unhandled rejection. Without this the promise below
  // just sits until the timeout and the test reports "unreadable backup"
  // instead of the actual error.
  const onReject = (e) => finish('EXPORT REJECTED: ' + ((e.reason && e.reason.message) || String(e.reason)));
  window.addEventListener('unhandledrejection', onReject);

  // The flag is read back by the test: if the real click ever runs instead of
  // this one, a download starts, focus goes to Chrome's download UI and the
  // popup closes. That failure is timing-dependent and looks like something
  // else entirely, so it gets asserted rather than hoped for.
  window.__exportClickWasStubbed = false;
  HTMLAnchorElement.prototype.click = function () {
    window.__exportClickWasStubbed = true; // no download, no focus loss
  };
  URL.createObjectURL = (blob) => {
    // Only the URL hook is restored here. handleExport creates the object URL
    // and *then* clicks the anchor, synchronously — so restoring the click stub
    // at this point would hand the real download back before it runs, which is
    // the single thing this whole dance exists to prevent. finish() restores
    // it, and finish() runs from the FileReader callback, after the click.
    URL.createObjectURL = originalCreate;
    const reader = new FileReader();
    reader.onload = () => finish(reader.result);
    reader.onerror = () => finish('READ ERROR');
    reader.readAsText(blob);
    return originalCreate(blob);
  };

  timer = setTimeout(() => finish('EXPORT TIMED OUT'), 15000);
  button.click();
})`;

/**
 * Walks Settings → Data, where export and import live.
 *
 * The Data row is matched on its description rather than its title: it is a
 * NavRow, which renders as a button wrapping an icon, a title and a
 * description, so an anchored /^Data$/ never matches the text and a loose
 * /Data/ matches half the screen.
 *
 * Throws rather than returning quietly. A navigation that silently does
 * nothing surfaces later as "NO EXPORT BUTTON", which reads like the button is
 * missing rather than like the test never got to the page.
 */
export async function openBackupPage(popup) {
  // Settings is behind the header's icon-only Menu button, which has no text
  // to match on — only a title attribute.
  const menu = await popup.js(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.title === 'Menu');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!menu) throw new Error('no Menu button in the popup header');
  await sleep(1200);
  if (!(await popup.clickButton('/Settings/'))) throw new Error('no Settings entry in the menu');
  await sleep(1500);
  if (!(await popup.clickButton('/Export or import all your data/'))) {
    throw new Error('no Data row in Settings');
  }
  await sleep(1500);
}

/** Start dates of every challenge habit, or the string 'UNDEFINED' when unset. */
export const READ_CHALLENGE_STARTS = `new Promise((resolve) => {
  const req = indexedDB.open('pomodoso');
  req.onerror = () => resolve('OPEN ERROR');
  req.onsuccess = () => {
    const q = req.result.transaction('habits', 'readonly').objectStore('habits').getAll();
    q.onsuccess = () => resolve(
      q.result.filter(h => h.challengeLengthDays)
        .map(h => h.challengeStartedAt === undefined ? 'UNDEFINED' : h.challengeStartedAt)
    );
  };
})`;

/** Creates a habit with the challenge switched on, through the form. */
export async function createChallengeHabit(popup, name) {
  if (!(await popup.clickButton('/Add/'))) throw new Error('no Add button on Habits');
  await sleep(1500);
  await popup.js(`(() => {
    const i = [...document.querySelectorAll('input')].find(e => e.type === 'text' || !e.type);
    if (!i) return;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, ${JSON.stringify(name)});
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(500);
  await popup.js(`(() => {
    const c = [...document.querySelectorAll('input')].find(e => e.type === 'checkbox');
    if (c) c.click();
  })()`);
  await sleep(800);
  await popup.js(`(() => {
    const b = [...document.querySelectorAll('button')].filter(x => /Save/.test(x.innerText));
    if (b.length) b[b.length - 1].click();
  })()`);
  await sleep(2500);
}
