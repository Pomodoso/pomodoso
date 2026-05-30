import type { TicketRef, TicketStatus } from '@pomodoso/types';

function detectAndReport(): void {
  const ticket = detectLinearTicket(window.location.href, document);
  try {
    chrome.runtime.sendMessage({ type: 'ticket.detected', payload: ticket ?? null });
  } catch { /* extension context invalidated after reload */ }
}

detectAndReport();

// Re-detect on navigation (Linear is a SPA)
const observer = new MutationObserver(() => detectAndReport());
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('popstate', detectAndReport);

export function detectLinearTicket(url: string, doc: Document): TicketRef | null {
  const match = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
  if (!match || !match[1]) return null;

  const externalId = match[1];

  const ogTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  const pageTitle = doc.title;
  const h1 = doc.querySelector('h1')?.textContent?.trim();

  const rawTitle = ogTitle ?? h1 ?? pageTitle ?? '';
  const title = rawTitle.replace(/\s*\|.*$/, '').replace(new RegExp(`^${externalId}\\s*[-–]\\s*`), '').trim();

  if (!title) return null;

  const canonicalUrl = `https://linear.app${new URL(url).pathname}`;

  const statusEl = doc.querySelector('[data-testid="issue-status"]');
  const status = parseLinearStatus(statusEl?.textContent?.trim() ?? '');

  return {
    provider_kind: 'linear',
    external_id: externalId,
    external_url: canonicalUrl,
    title,
    ...(status ? { status } : {}),
  };
}

function parseLinearStatus(text: string): TicketStatus | undefined {
  const map: Record<string, TicketStatus> = {
    'In Progress': 'in_progress',
    'In Review': 'in_review',
    'Done': 'done',
    'Blocked': 'blocked',
    'Backlog': 'open',
    'Todo': 'open',
    'Cancelled': 'done',
  };
  return map[text];
}
