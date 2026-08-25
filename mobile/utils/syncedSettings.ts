import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { settings } from '@/db/schema';

// The translation layer between how mobile stores preferences and how they
// travel on the wire.
//
// The two disagree on shape, which is why this was left out of sync for so
// long. The extension bundles the five timer numbers into a single
// `timer_settings` object; mobile keeps each as its own row, because every
// screen reads them individually and a bundle would mean parsing the whole
// thing to answer "how long is a short break". Neither storage is wrong, so
// the difference is reconciled here rather than by changing either side.
//
// Only keys both clients actually have are listed. `timezone` is deliberately
// absent: the extension syncs it and the backend uses it for day boundaries,
// but mobile derives its own from Intl at the point of use and has no stored
// preference to push — sending one would mean inventing a value only to
// overwrite the extension's real one.
//
// mobile-only keys (showHabitsInToday, showMeetingsInToday) stay device-local
// by omission, which is correct: they describe this screen, not the account.

type WireKey = 'timer_settings' | 'sound_settings' | 'max_priorities' | 'week_start' | 'work_days';

/** Local setting keys that make up each wire key. */
const WIRE_MEMBERS: Record<WireKey, string[]> = {
  timer_settings: ['focus_seconds', 'short_break_seconds', 'long_break_seconds', 'long_break_every', 'daily_goal'],
  sound_settings: ['sound_settings'],
  max_priorities: ['max_priorities'],
  week_start: ['week_start'],
  work_days: ['work_days'],
};

/** Field name inside `timer_settings` for each of its local keys. */
const TIMER_FIELDS: Record<string, string> = {
  focus_seconds: 'focusSeconds',
  short_break_seconds: 'shortBreakSeconds',
  long_break_seconds: 'longBreakSeconds',
  long_break_every: 'longBreakEvery',
  daily_goal: 'dailyGoal',
};

export const WIRE_KEYS = Object.keys(WIRE_MEMBERS) as WireKey[];

function get(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value;
}

function put(key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

function parse(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Which wire key a local setting belongs to, or undefined if it's local-only. */
export function wireKeyFor(localKey: string): WireKey | undefined {
  return WIRE_KEYS.find(w => WIRE_MEMBERS[w].includes(localKey));
}

/**
 * Marks a wire key as changed so the next push sends it.
 *
 * Timestamps rather than a dirty flag, because the push compares against
 * `<key>_synced_at` the same way the extension does — that is what makes an
 * edit made while offline still win over an older server value once it lands.
 */
export function markSettingDirty(localKey: string): void {
  const wire = wireKeyFor(localKey);
  if (!wire) return;
  put(`${wire}_updated_at`, JSON.stringify(new Date().toISOString()));
}

/** The wire value for a key, or undefined if this device has nothing to say
 *  about it — an untouched setting shouldn't overwrite another device's. */
export function readWireSetting(key: WireKey): unknown | undefined {
  if (key !== 'timer_settings') {
    return parse(get(WIRE_MEMBERS[key][0]!));
  }
  // Built from whichever members exist. Partial on purpose: sending a
  // default for a number the user never set would silently replace a real
  // value chosen on another device.
  const bundle: Record<string, unknown> = {};
  for (const [localKey, field] of Object.entries(TIMER_FIELDS)) {
    const value = parse(get(localKey));
    if (value !== undefined) bundle[field] = value;
  }
  return Object.keys(bundle).length > 0 ? bundle : undefined;
}

/** Applies an incoming wire value onto the local keys it covers. */
export function applyWireSetting(key: WireKey, value: unknown): void {
  if (key !== 'timer_settings') {
    put(WIRE_MEMBERS[key][0]!, JSON.stringify(value));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const bundle = value as Record<string, unknown>;
  for (const [localKey, field] of Object.entries(TIMER_FIELDS)) {
    // Only fields the sender actually carried. An older client that doesn't
    // know about dailyGoal must not blank it here.
    if (field in bundle) put(localKey, JSON.stringify(bundle[field]));
  }
}

/** True when this device has a newer version of `key` than it last sent. */
export function isSettingDirty(key: WireKey): boolean {
  const updatedAt = parse(get(`${key}_updated_at`)) as string | undefined;
  if (!updatedAt) return false;
  const syncedAt = parse(get(`${key}_synced_at`)) as string | undefined;
  return !syncedAt || syncedAt < updatedAt;
}

export function settingUpdatedAt(key: WireKey): string {
  return (parse(get(`${key}_updated_at`)) as string | undefined) ?? new Date().toISOString();
}

export function markSettingSynced(key: WireKey, at: string): void {
  put(`${key}_synced_at`, JSON.stringify(at));
}

/** Records the server's version as the local one without marking it dirty —
 *  otherwise applying a pull would immediately queue a push of what just
 *  arrived, and two devices would trade the same value forever. */
export function acceptRemoteSetting(key: WireKey, value: unknown, updatedAt: string): void {
  const syncedAt = parse(get(`${key}_synced_at`)) as string | undefined;
  if (syncedAt && syncedAt >= updatedAt) return;
  applyWireSetting(key, value);
  markSettingSynced(key, updatedAt);
}
