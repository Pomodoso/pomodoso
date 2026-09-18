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
