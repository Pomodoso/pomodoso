// Talking to the Pomodoso extension from the web app. The extension injects a
// small bridge on this site (its content-scripts/web-bridge.ts), so the page
// needs no extension ID, which differs between the Chrome and Edge stores
// and an unpacked build. Without the extension (an old one, or not
// installed) nothing answers and every helper resolves to null.

export const CHROME_STORE_URL = 'https://chromewebstore.google.com/detail/pomodoso/kloaflkoffpkpldhaipegeabhhkijhbj';

/** No answer by then: there's no extension (or it predates the bridge). */
const TIMEOUT_MS = 1500;

function send<T>(type: 'ping' | 'apps.install', extra: Record<string, unknown> = {}): Promise<T | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (value: T | null) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { source?: unknown; id?: unknown; response?: unknown } | null;
      if (e.source !== window || m?.source !== 'pomodoso-extension' || m.id !== id) return;
      done((m.response as T | undefined) ?? null);
    };
    const timer = setTimeout(() => done(null), TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'pomodoso-web', id, type, ...extra }, window.location.origin);
  });
}

/** The installed extension's version, or null when it isn't there or can't install apps. */
export async function extensionVersion(): Promise<string | null> {
  const r = await send<{ ok: boolean; version?: string }>('ping');
  return r?.ok ? (r.version ?? null) : null;
}

/** Asks the extension to show an app's install preview. `opened` is false when
 *  Chrome wouldn't open the popup; the request then waits for the next open. */
export function installInExtension(slug: string): Promise<{ ok: boolean; opened: boolean } | null> {
  return send('apps.install', { slug });
}
