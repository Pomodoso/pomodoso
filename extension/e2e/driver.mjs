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
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    }
  });

  const send = (method, params = {}, sessionId) => {
    const id = ++nextId;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }
      }, 20000);
    });
  };

  await sleep(4000);
  const { id: extensionId } = await send('Extensions.loadUnpacked', { path: extensionDir });
  await sleep(2000);

  const close = () => {
    chrome.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  return { send, extensionId, close };
}

/** Wraps a CDP session so callers deal in `js()` and `mouse()`, not raw methods. */
function session(send, sessionId) {
  const call = (method, params = {}) => send(method, params, sessionId);
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
export async function openPopup({ send, extensionId }) {
  const { targetInfos } = await send('Target.getTargets');
  const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(extensionId));
  if (!sw) throw new Error('extension service worker not found');

  const swSession = (await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, swSession);

  // openPopup() refuses without a focused browser window, and tests that open
  // and close tabs can leave none focused. Rather than hoping one is there,
  // make a page, focus it, and try again if Chrome still disagrees — the
  // failure is a timing one, not a permanent one.
  let opened;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { targetId: blank } = await send('Target.createTarget', { url: 'about:blank' });
    await send('Target.activateTarget', { targetId: blank });
    const s = (await send('Target.attachToTarget', { targetId: blank, flatten: true })).sessionId;
    await send('Page.enable', {}, s);
    await send('Page.bringToFront', {}, s).catch(() => {});
    await sleep(1200);

    opened = await send('Runtime.evaluate', {
      expression: `chrome.action.openPopup().then(() => 'ok').catch(e => 'ERR ' + e.message)`,
      returnByValue: true, awaitPromise: true,
    }, swSession);
    if (opened.result.value === 'ok') break;
    await sleep(1000);
  }
  if (opened.result.value !== 'ok') throw new Error(`openPopup failed: ${opened.result.value}`);
  await sleep(2500);

  const after = (await send('Target.getTargets')).targetInfos;
  const popup = after.find(t => t.type === 'page' && t.url.includes(`${extensionId}/popup/index.html`));
  if (!popup) throw new Error('popup window did not appear');

  const { sessionId } = await send('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await sleep(3000);
  return session(send, sessionId);
}
