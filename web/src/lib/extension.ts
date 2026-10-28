// Talking to the Pomodoso extension from the web app. The extension lists this
// site under externally_connectable, which gives the page chrome.runtime
// .sendMessage; without the extension (or outside Chrome) there's nothing to
// call and every helper resolves to null.

const EXTENSION_ID = (import.meta.env.VITE_EXTENSION_ID as string | undefined) ?? 'kloaflkoffpkpldhaipegeabhhkijhbj';

export const CHROME_STORE_URL = `https://chromewebstore.google.com/detail/pomodoso/${EXTENSION_ID}`;

interface ChromeRuntime {
  sendMessage(id: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: unknown;
}

function send<T>(message: unknown): Promise<T | null> {
  const runtime = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        // Reading lastError marks it handled (not installed, or too old to answer).
        void runtime.lastError;
        resolve((response as T | undefined) ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** The installed extension's version, or null when it isn't there or can't install apps. */
export async function extensionVersion(): Promise<string | null> {
  const r = await send<{ ok: boolean; version?: string }>({ type: 'ping' });
  return r?.ok ? (r.version ?? null) : null;
}

/** Asks the extension to show an app's install preview. `opened` is false when
 *  Chrome wouldn't open the popup; the request then waits for the next open. */
export function installInExtension(slug: string): Promise<{ ok: boolean; opened: boolean } | null> {
  return send({ type: 'apps.install', slug });
}
