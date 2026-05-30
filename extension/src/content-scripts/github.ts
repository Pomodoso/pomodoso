import type { TicketRef, TicketStatus } from '@pomodoso/types';

function detectAndReport(): void {
  const ticket = detectGitHubTicket(window.location.href, document);
  try {
    chrome.runtime.sendMessage({ type: 'ticket.detected', payload: ticket ?? null });
  } catch { /* extension context invalidated after reload */ }
}

detectAndReport();
document.addEventListener('turbo:load', detectAndReport);
document.addEventListener('turbo:render', detectAndReport);

export function detectGitHubTicket(url: string, doc: Document): TicketRef | null {
  const isPR = url.includes('/pull/');
  const isIssue = url.includes('/issues/');
  if (!isPR && !isIssue) return null;

  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/);
  if (!match || !match[1] || !match[3]) return null;

  const repo = match[1];
  const number = match[3];
  const externalId = `#${number}`;

  // Title: og:title is "PR title by user · Pull Request #N · org/repo"
  const ogTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  const h1 = doc.querySelector('h1.gh-header-title')?.textContent?.trim()
    ?? doc.querySelector('h1 bdi')?.textContent?.trim();

  let title = ogTitle ?? h1 ?? '';
  // Strip GitHub og:title suffix
  title = title.replace(/\s*·\s*(Pull Request|Issue)\s+#\d+\s*·\s*.+$/, '').trim();

  if (!title) return null;

  const canonicalUrl = `https://github.com/${repo}/${isPR ? 'pull' : 'issues'}/${number}`;

  const status = isPR ? detectPRStatus(doc) : detectIssueStatus(doc);

  const result: TicketRef = {
    provider_kind: 'github',
    external_id: externalId,
    external_url: canonicalUrl,
    title,
    ...(status ? { status } : {}),
  };

  if (isPR) {
    result.linked_pr = { url: canonicalUrl, number: `#${number}` };
  }

  return result;
}

function detectPRStatus(doc: Document): TicketStatus | undefined {
  const stateEl = doc.querySelector('.gh-header-meta .State');
  const text = stateEl?.textContent?.trim().toLowerCase() ?? '';
  if (text.includes('merged')) return 'merged';
  if (text.includes('closed')) return 'done';
  if (text.includes('open')) return 'in_review';
  return undefined;
}

function detectIssueStatus(doc: Document): TicketStatus | undefined {
  const stateEl = doc.querySelector('.gh-header-meta .State');
  const text = stateEl?.textContent?.trim().toLowerCase() ?? '';
  if (text.includes('closed')) return 'done';
  if (text.includes('open')) return 'open';
  return undefined;
}
