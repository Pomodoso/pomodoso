// Whether a task's link (or a detected ticket's URL) is the page the user is on.
//
// Used to point at the tasks that belong to the current tab: the linked-tasks
// banner, the detection banner, and the highlight on Today's rows. It used to
// be a bare `startsWith` either way round, which matched far too much: a link
// to ENG-1 lit up on ENG-12, and a link to https://github.com lit up on every
// page of GitHub.

/** Comparable form of a URL: no trailing slash, no empty hash. Null if unparseable. */
function normalize(raw: string): { key: string; bare: boolean } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  // The hash stays: some apps (Gmail) keep the thing's identity there.
  const hash = url.hash === '#' ? '' : url.hash;
  const key = `${url.host.toLowerCase()}${path}${url.search}${hash}`;
  // A site root says nothing about which thing the user is looking at.
  return { key, bare: path === '' && url.search === '' && hash === '' };
}

/** True when `b` continues `a` at a boundary: a/…, a?…, a#…. */
function extends_(b: string, a: string): boolean {
  return b.length > a.length && b.startsWith(a) && '/?#'.includes(b[a.length]!);
}

/**
 * Same page, or one is a sub-page of the other. Linear's
 * `/issue/ENG-412` and `/issue/ENG-412/fix-login` match; `ENG-41` and
 * `ENG-412` don't. A bare site root only matches itself.
 */
export function urlsMatch(link: string, page: string): boolean {
  const a = normalize(link);
  const b = normalize(page);
  if (!a || !b) return false;
  if (a.key === b.key) return true;
  if (a.bare || b.bare) return false;
  return extends_(b.key, a.key) || extends_(a.key, b.key);
}

/**
 * Whether a task is the detected ticket.
 *
 * The URL decides whenever there is one to compare: a task added from a
 * detection always saves the ticket's link. A bare id is only trusted for a
 * task with no links, and only when it can't belong to another project:
 * GitHub's `#7` is PR 7 in every repository, so matching on it would mark a
 * task from one repo as being on another repo's page. `ENG-412` names its
 * team, so it can stand on its own.
 */
export function taskMatchesTicket(
  task: { ticketId: string | null; links?: { url: string }[] | undefined },
  ticket: { external_id?: string | null | undefined; external_url?: string | null | undefined },
): boolean {
  const links = task.links ?? [];
  if (ticket.external_url && links.some(l => urlsMatch(l.url, ticket.external_url!))) return true;
  if (links.length > 0) return false;
  const id = ticket.external_id;
  return Boolean(id) && task.ticketId === id && !/^#?\d+$/.test(id!);
}
