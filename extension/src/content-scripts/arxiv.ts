import type { TicketRef } from '@pomodoso/types';

function detectAndReport(): void {
  const ticket = detectArxivPaper(window.location.href, document);
  try {
    chrome.runtime.sendMessage({ type: 'ticket.detected', payload: ticket ?? null });
  } catch { /* extension context invalidated after reload */ }
}

detectAndReport();

export function detectArxivPaper(url: string, doc: Document): TicketRef | null {
  const match = url.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/);
  if (!match || !match[1]) return null;

  const externalId = match[1];

  const ogTitle = doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content;
  // h1.title contains a <span class="descriptor">Title:</span> — grab text nodes only
  const h1Nodes = doc.querySelector('h1.title')?.childNodes;
  const h1Text = h1Nodes
    ? Array.from(h1Nodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent?.trim())
        .filter(Boolean)
        .join(' ')
        .trim()
    : undefined;

  const title = ogTitle ?? h1Text ?? '';
  if (!title) return null;

  return {
    provider_kind: 'arxiv',
    external_id: externalId,
    external_url: `https://arxiv.org/abs/${externalId}`,
    title,
  };
}
