// Drives the real browser-action popup over the Chrome DevTools Protocol.
//
// Why this exists: every automated check in CI passed while reordering was
// completely broken in the popup. The popup's HTML opened in a tab behaves
// differently from the popup *window* — the window emits phantom `resize`
// events that cancelled every drag — so testing the tab proved nothing about
// the thing users click. Three rounds of reasoning produced two fixes for
// symptoms that only existed in the tab; driving the real popup reproduced the
// actual bug on the first attempt.
//
// Two Chrome details this has to work around:
//
//   - Chrome 137+ ignores `--load-extension`. `Extensions.loadUnpacked` is the
//     supported replacement, and it is gated behind
//     `--enable-unsafe-extension-debugging`, which in turn requires
//     `--remote-debugging-pipe` rather than a debugging port. So the transport
//     is fds 3 and 4 carrying NUL-delimited JSON, not a websocket.
//   - `chrome.action.openPopup()` needs a focused browser window, or it fails
//     with "Could not find an active browser window".
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The popup window went away mid-test.
 *
 * A browser-action popup closes the moment its window loses focus, so anything
 * that steals focus on the machine running this — a notification, another app,
 * a screen lock — kills the popup and every later call fails with CDP's
 * unhelpful "Session with given id not found". That is the environment, not the
 * product, so it is worth naming and worth one retry.
 */
export class PopupClosedError extends Error {
  constructor(method) {
    super(`the popup closed mid-test (during ${method}) — something stole focus from Chrome`);
    this.name = 'PopupClosedError';
  }
}

/** Launches Chrome with a throwaway profile and the extension loaded. */
export async function launch(extensionDir) {
  const profile = mkdtempSync(join(tmpdir(), 'pomodoso-e2e-'));
  const chrome = spawn(CHROME, [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const pending = new Map();
  let buf = Buffer.alloc(0);
  let nextId = 0;

  chrome.stdio[4].on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let i;
    while ((i = buf.indexOf(0)) !== -1) {
      const raw = buf.subarray(0, i).toString('utf8');
      buf = buf.subarray(i + 1);
      if (!raw) continue;
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej, method } = pending.get(msg.id);
        pending.delete(msg.id);
        // Name the call. "Session with given id not found" says nothing about
        // which session or why, and the popup closing on focus loss makes that
        // a routine thing to have to diagnose.
        msg.error ? rej(new Error(`CDP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`)) : res(msg.result);
      }
    }
  });

  const send = (method, params = {}, sessionId, timeoutMs = 20000) => {
    const id = ++nextId;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej, method });
      chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }
      }, timeoutMs);
    });
  };

  const close = () => {
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  // Cleanup has to cover setup itself. If loadUnpacked rejects or times out,
  // launch() never returns and the caller's finally never runs — leaving a
  // Chrome process and a temp profile behind on every failed run.
  try {
    // Poll for readiness rather than sleeping a guessed interval. A fixed wait
    // is fine until the machine is busy or a previous Chrome is still shutting
    // down, and then the first real call times out — which is a flake, not a
    // failure, and the worst kind of thing to leave in a checked-in test.
    for (let attempt = 0; ; attempt++) {
      try {
        await send('Browser.getVersion', {}, undefined, 3000);
        break;
      } catch (err) {
        if (attempt >= 15) throw new Error(`Chrome never became ready: ${err.message}`);
        await sleep(500);
      }
    }

    // Without discovery, a stopped MV3 service worker isn't listed at all —
    // and it stops whenever it goes idle, which is most of the time between
    // tests. openPopup has to reach it to call chrome.action.openPopup().
    await send('Target.setDiscoverTargets', { discover: true });
    // Longer than the default: loading and starting an unpacked extension is
    // the slowest call here by a wide margin on a cold profile.
    const { id: extensionId } = await send('Extensions.loadUnpacked', { path: extensionDir }, undefined, 60000);
    await sleep(2000);

    // One page kept for the whole session, and its window forced out of any
    // minimised state. chrome.action.openPopup() refuses without an active
    // browser window, and a window whose last tab was closed — or that Chrome
    // never brought forward — does not count as one.
    const { targetId: focusTarget } = await send('Target.createTarget', { url: 'about:blank' });
    const focusSession = (await send('Target.attachToTarget', { targetId: focusTarget, flatten: true })).sessionId;
    await send('Page.enable', {}, focusSession);
    const { windowId } = await send('Browser.getWindowForTarget', { targetId: focusTarget });
    await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});

    const focus = async () => {
      await send('Target.activateTarget', { targetId: focusTarget });
      await send('Page.bringToFront', {}, focusSession).catch(() => {});
      await sleep(900);
    };

    return { send, extensionId, close, focus };
  } catch (err) {
    close();
    throw err;
  }
}

/** Wraps a CDP session so callers deal in `js()` and `mouse()`, not raw methods. */
function session(send, sessionId) {
  const call = async (method, params = {}) => {
    try {
      return await send(method, params, sessionId);
    } catch (err) {
      if (/Session with given id not found/.test(err.message)) throw new PopupClosedError(method);
      throw err;
    }
  };
  return {
    call,
    async js(expression) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error('page threw: ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 300));
      }
      return r.result.value;
    },
    mouse(type, x, y) {
      return call('Input.dispatchMouseEvent', {
        type, x, y, button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1, pointerType: 'mouse',
      });
    },
    /**
     * Evaluates until two consecutive reads agree, so nothing is asserted
     * mid-animation. A drop reflows the list over a transition; sampling once
     * the instant the mouse comes up catches it halfway.
     */
    async settled(expression, { timeoutMs = 6000, interval = 350 } = {}) {
      const deadline = Date.now() + timeoutMs;
      let previous = await this.js(expression);
      for (;;) {
        await sleep(interval);
        const current = await this.js(expression);
        if (current === previous) return current;
        previous = current;
        if (Date.now() > deadline) return current;
      }
    },
    /** Press, move in small steps, release — a drag the sensors actually see. */
    async drag(fromX, fromY, toX, toY, steps = 25) {
      await this.mouse('mouseMoved', fromX, fromY);
      await this.mouse('mousePressed', fromX, fromY);
      await sleep(80);
      for (let i = 1; i <= steps; i++) {
        await this.mouse('mouseMoved',
          Math.round(fromX + (toX - fromX) * i / steps),
          Math.round(fromY + (toY - fromY) * i / steps));
        await sleep(20);
      }
      await sleep(200);
      await this.mouse('mouseReleased', toX, toY);
      await sleep(900);
    },
    /**
     * Clicks the first button whose text matches. Returns false if none did.
     *
     * Matches against trimmed innerText: buttons here wrap an icon and a label
     * across lines, so an anchored pattern like /^Habits$/ never matches the
     * raw text.
     */
    clickButton(pattern) {
      return this.js(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => ${pattern}.test(x.innerText.trim()));
        if (!b) return false;
        b.click();
        return true;
      })()`);
    },
  };
}

/**
 * Wipes the extension origin's storage.
 *
 * Tests share one browser, so without this the second one starts already
 * onboarded and its "Use template" click finds no button — which looks exactly
 * like a product failure and isn't.
 */
export async function resetStorage({ send, extensionId }) {
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/index.html` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Storage.clearDataForOrigin', {
    origin: `chrome-extension://${extensionId}`,
    storageTypes: 'all',
  }, sessionId);
  // chrome.storage.local is extension storage, not web storage for the origin,
  // so clearDataForOrigin leaves it untouched — and `pom_onboarded` lives
  // there. Without this the second test never sees the onboarding screen and
  // seeds nothing, which reads as a product failure and isn't.
  await send('Runtime.evaluate', {
    expression: `Promise.all([
      chrome.storage.local.clear(),
      chrome.storage.session?.clear?.() ?? Promise.resolve(),
    ]).then(() => 'cleared')`,
    returnByValue: true, awaitPromise: true,
  }, sessionId);
  await send('Target.closeTarget', { targetId });
  await sleep(800);
}

/** A tab on the extension origin. Scriptable freely; shares storage with the popup. */
export async function openTab({ send, extensionId }) {
  const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extensionId}/popup/index.html` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await sleep(5000);
  return { ...session(send, sessionId), targetId };
}

/**
 * The real toolbar popup — the window clicking the extension icon opens.
 *
 * This is the whole point of the file. A tab is not a substitute for it.
 */
export async function openPopup({ send, extensionId, focus }) {
  // MV3 service workers shut down when idle, so the worker found a moment ago
  // may be gone by the time we attach — and it dies again between tests.
  // Look it up and attach as one retried step rather than two hopeful ones.
  let swSession;
  for (let attempt = 0; attempt < 10 && !swSession; attempt++) {
    const { targetInfos } = await send('Target.getTargets');
    const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extensionId));
    if (sw) {
      try {
        swSession = (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
      } catch {
        swSession = undefined; // died between the lookup and the attach
      }
    }
    if (!swSession) await sleep(600);
  }
  if (!swSession) throw new Error('extension service worker never became attachable');
  await send('Runtime.enable', {}, swSession);

  // openPopup() refuses without a focused browser window, and tests that open
  // and close tabs can leave none focused. Rather than hoping one is there,
  // make a page, focus it, and try again if Chrome still disagrees — the
  // failure is a timing one, not a permanent one.
  const findPopup = async () => {
    const { targetInfos: all } = await send('Target.getTargets');
    return all.find(t => t.type === 'page' && t.url.includes(`${extensionId}/popup/index.html`));
  };

  let popup;
  let lastError = 'not attempted';
  for (let attempt = 0; attempt < 4 && !popup; attempt++) {
    // Refocus the session's page rather than making a new one: fresh tabs pile
    // up and each one steals focus from the popup we just asked for.
    await focus();

    const opened = await send('Runtime.evaluate', {
      expression: `chrome.action.openPopup().then(() => 'ok').catch(e => 'ERR ' + e.message)`,
      returnByValue: true, awaitPromise: true,
    }, swSession);
    lastError = opened.result.value;
    if (lastError !== 'ok') { await sleep(1000); continue; }

    // The call resolving doesn't mean the target is listed yet, so poll for it
    // rather than sampling once and declaring it missing.
    for (let i = 0; i < 12 && !popup; i++) {
      await sleep(400);
      popup = await findPopup();
    }
    if (!popup) lastError = 'opened but no popup target appeared';
  }
  if (!popup) throw new Error(`openPopup failed: ${lastError}`);

  const { sessionId } = await send('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await sleep(3000);
  return { ...session(send, sessionId), targetId: popup.targetId };
}
