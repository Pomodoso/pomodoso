// Bridge between Pomodoso's web app and the extension, injected on the site
// only (manifest content_scripts). The page can't message the extension
// without its ID, which differs between the Chrome and Edge stores and an
// unpacked build; it posts here instead and this relays the two requests it
// may make. The background checks the page's origin again.

const PAGE = 'pomodoso-web';
const EXTENSION = 'pomodoso-extension';

window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const m = e.data as { source?: unknown; id?: unknown; type?: unknown; slug?: unknown } | null;
  if (m?.source !== PAGE || typeof m.id !== 'string') return;
  if (m.type !== 'ping' && m.type !== 'apps.install') return;
  const reply = (response: unknown) => window.postMessage({ source: EXTENSION, id: m.id, response }, location.origin);
  chrome.runtime
    .sendMessage({ type: `web.${m.type}`, slug: m.slug })
    .then(reply)
    .catch(() => reply(null));
});
