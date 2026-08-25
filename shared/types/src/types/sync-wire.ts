// The wire contract for sync's `extra` bag, shared by every client.
//
// Push/pull themselves stay per-client: the extension is async over Dexie
// with native JS objects in IndexedDB, mobile is synchronous over drizzle
// with JSON in TEXT columns, and the two carry different local columns
// entirely. Abstracting that would be a leaky interface over genuinely
// different storage. What *must* agree is the wire format — when the two
// disagree there, records quietly corrupt each other across devices, with
// nothing failing loudly enough to notice.
//
// They already had disagreed. The extension wrote a field when it was
// `!== undefined` and read it back with `?? existing`; mobile wrote when
// `!= null` and read with `'key' in extra`. Because mobile stores a cleared
// description as null, `!= null` dropped the key, so clearing a description
// on mobile never reached any other device. Encoding and decoding now live
// here, once.

/** The `extra` payload carried alongside a synced entity's columns. */
export type ExtraBag = Record<string, unknown>;

/**
 * Writes a field into an outgoing `extra` bag.
 *
 * Three states have to stay distinguishable, and conflating any two of them
 * is what caused the original divergence:
 *
 * - `undefined` — this client has no such field. Omitted, so a client that
 *   *does* carry it keeps its own value. Mobile has no `preferredMode`
 *   column, for instance, and must not blank the extension's.
 * - `null` or an empty collection — the field exists here and the user
 *   emptied it. Sent explicitly, because that is the only way a clear
 *   travels.
 * - anything else — sent as-is.
 */
export function writeExtra(extra: ExtraBag, key: string, value: unknown): void {
  if (value === undefined) return;
  extra[key] = value;
}

/**
 * Reads a field from an incoming `extra` bag, given whatever the local row
 * already holds.
 *
 * Presence is the whole signal: a key that is there wins even when it is
 * null or empty (that is a clear, and the record already won LWW to get
 * here), and a key that is absent leaves the local value untouched (the
 * sender simply may not carry that field).
 *
 * Note this is deliberately not `extra[key] ?? existing`, which is what the
 * extension used to do — that silently resurrects a value the sender had
 * cleared.
 */
export function readExtra<T>(extra: ExtraBag, key: string, existing: T): T {
  return key in extra ? (extra[key] as T) : existing;
}

// ─── Habit frequency ──────────────────────────────────────────────────────────

/** Local weekday numbers → the backend's frequency pair. */
export function habitFrequency(days: number[]): { frequency: string; frequency_days: string | null } {
  if (!days || days.length === 0 || days.length === 7) {
    return { frequency: 'daily', frequency_days: null };
  }
  if (days.length === 5 && days.every((d, i) => d === i)) {
    return { frequency: 'weekdays', frequency_days: null };
  }
  return { frequency: 'custom', frequency_days: JSON.stringify(days) };
}

/** The inverse of `habitFrequency`. Unparseable input degrades to "every day"
 *  rather than throwing mid-sync. */
export function habitDaysFromServer(frequency: string, frequencyDays?: string | null): number[] {
  if (frequency === 'daily') return [];
  if (frequency === 'weekdays') return [0, 1, 2, 3, 4];
  if (frequencyDays) {
    try {
      return JSON.parse(frequencyDays) as number[];
    } catch {
      return [];
    }
  }
  return [];
}

// ─── Setting ids ──────────────────────────────────────────────────────────────

/**
 * Derives a stable UUID for a user_setting key.
 *
 * The key is hex-encoded so the result only contains valid hex digits: keys
 * like "timer_settings" have characters ('t', 'i', '_') that the backend's
 * `uuid::Uuid` deserializer rejects with a 422 if used directly.
 *
 * Every client must derive this identically or the same setting arrives at
 * the backend under two different ids and stops converging.
 */
export function settingId(key: string): string {
  const hex = Array.from(key)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .substring(0, 32);
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-5${hex.substring(13, 16)}-8${hex.substring(17, 20)}-${hex.substring(20, 32)}`;
}

// ─── Pull cursor ──────────────────────────────────────────────────────────────

/**
 * A stored pull cursor: the `server_time` from the last successful pull,
 * tagged with the (account, backend) pair that issued it.
 *
 * Pull is incremental — the backend answers `WHERE updated_at > $since` — so
 * the cursor is only meaningful against the exact server that produced it,
 * for the exact account it was produced under. Both clients used to store a
 * bare timestamp, which silently outlived both:
 *
 * - Repointing a build at a different backend (a dev tunnel to production)
 *   left the device asking production for "everything since <a timestamp
 *   another server invented>". Production answered with an almost empty
 *   delta and the client treated that as up to date. The account's real
 *   data, all of it older, was never requested again.
 * - Signing out and into a second account reused the first account's
 *   cursor, so the new account only ever received rows edited after that
 *   moment.
 *
 * Neither fails loudly: an empty delta and a genuinely-nothing-changed delta
 * look identical.
 */
export interface PullCursor {
  scope: string;
  since: string;
}

/**
 * Identifies the (account, backend) pair a cursor belongs to.
 *
 * Both clients must build this identically — a device that computes the
 * scope differently from the one that wrote the cursor discards it and does
 * a full pull. That is the safe direction to fail, but it means a mismatch
 * shows up as a permanent performance bug rather than an error.
 */
export function pullScope(userId: string, apiUrl: string): string {
  return `${userId}@${apiUrl}`;
}

/**
 * Reads a stored cursor, returning `undefined` — meaning "pull everything" —
 * whenever it can't be proven to belong to `scope`.
 *
 * Unparseable and foreign cursors are both discarded rather than repaired.
 * A full pull costs one large response; honouring a wrong cursor costs the
 * user data they can see on another device and not this one.
 *
 * A bare-string cursor is what every install written before this existed
 * has stored. There is no way to learn which account or backend issued it,
 * so it is discarded too, and the resulting one-time full pull is also what
 * repairs a device already holding a stale one.
 */
export function readPullCursor(raw: string | undefined, scope: string): string | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const cursor = parsed as Partial<PullCursor>;
  if (cursor.scope !== scope) return undefined;
  return typeof cursor.since === 'string' ? cursor.since : undefined;
}

/** Serialises a cursor for storage. Always paired with `readPullCursor`. */
export function writePullCursor(scope: string, since: string): string {
  return JSON.stringify({ scope, since } satisfies PullCursor);
}
