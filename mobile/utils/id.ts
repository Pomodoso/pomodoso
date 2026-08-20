import * as Crypto from 'expo-crypto';

// CLAUDE.md rule 3: all IDs are client-generated UUIDs — required for
// offline creation and conflict-free sync. Every hook used to define its
// own local `uid()` returning a Date.now()+random string, not a real UUID;
// that would have made every entity silently un-syncable once Fase B's sync
// engine ships — the backend's parse_entity_id does
// uuid::Uuid::parse_str(&e.id).ok() and drops anything that doesn't parse,
// with no error surfaced to the client.
export function uid(): string {
  return Crypto.randomUUID();
}

// Ported verbatim from extension's db.ts habitLogId — deterministic, not
// random, so the same (habitId, date) always converges to the same id
// across devices (what makes the backend's UNIQUE(habit_id, date) upsert
// converge instead of duplicating once Fase B sync ships). Still needs to be
// UUID-*shaped* like every other id (rule 3 / parse_entity_id, see uid()
// above) — hex-encodes the habit id + date digits into a UUID-shaped string
// rather than using a plain composite key like `${habitId}-${date}`.
// Assumes habitId is already a real UUID (dashes stripped below).
export function habitLogId(habitId: string, date: string): string {
  const h = habitId.replace(/-/g, ''); // 32 hex chars of the habit UUID
  const dd = date.replace(/-/g, ''); // 8 digits, e.g. 20260619
  // 24 chars of the habit + the date → the date lands in the last segment.
  const p = (h.substring(0, 24) + dd).padEnd(32, '0').substring(0, 32);
  return `${p.substring(0, 8)}-${p.substring(8, 12)}-5${p.substring(13, 16)}-8${p.substring(17, 20)}-${p.substring(20, 32)}`;
}
