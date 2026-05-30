import type { TicketRef } from '@pomodoso/types';

function detectAndReport(): void {
  const ticket = detectSentryIssue(window.location.href, document);
  try {
    chrome.runtime.sendMessage({ type: 'ticket.detected', payload: ticket ?? null });
  } catch { /* extension context invalidated after reload */ }
}

detectAndReport();

// Sentry is a React SPA — watch for DOM changes and URL changes
const observer = new MutationObserver(() => detectAndReport());
observer.observe(document.body, { childList: true, subtree: false });
window.addEventListener('popstate', detectAndReport);

export function detectSentryIssue(url: string, doc: Document): TicketRef | null {
  // Match: https://<org>.sentry.io/issues/<id>/
  const match = url.match(/([^/]+)\.sentry\.io\/issues\/(\d+)/);
  if (!match || !match[1] || !match[2]) return null;

  const org = match[1];
  const issueId = match[2];
  const externalId = `${org.toUpperCase()}-${issueId}`;

  // Sentry page title: "ShortMessage | Sentry" or "ShortMessage · ProjectName · Sentry"
  const rawTitle = doc.title ?? '';
  const title = rawTitle
    .replace(/\s*[|·].*$/, '')  // strip everything after | or ·
    .trim();

  if (!title) return null;

  const canonicalUrl = `https://${org}.sentry.io/issues/${issueId}/`;

  return {
    provider_kind: 'sentry',
    external_id: externalId,
    external_url: canonicalUrl,
    title,
  };
}
