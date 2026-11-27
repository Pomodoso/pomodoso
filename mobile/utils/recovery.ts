// Fields older mobile builds dropped and this one keeps: a project's end date,
// and a habit's time unit and end date. Existing rows got the column default
// when the column was added, not the account's real value, so the device
// can't tell "never had it" from "cleared it" on its own.
//
// So the migration that adds the columns records which rows existed then
// (they hold defaults, not choices). A row leaves the list the moment the
// user edits it here, because from then on its value is a choice. Rows still
// on the list get their real values from the server before anything is
// pushed (recoverDroppedFields in sync.ts), and aren't pushed until then, so
// a default is never sent as if the user had cleared something.

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { settings } from '@/db/schema';

export const PROJECT_END_DATE_UNRECOVERED = 'project_end_date_unrecovered';
export const HABIT_FIELDS_UNRECOVERED = 'habit_fields_unrecovered';
export type RecoveryKey = typeof PROJECT_END_DATE_UNRECOVERED | typeof HABIT_FIELDS_UNRECOVERED;

export function unrecoveredIds(key: RecoveryKey): Set<string> {
  const raw = db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value;
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeIds(key: RecoveryKey, ids: Set<string>): void {
  if (ids.size === 0) {
    db.delete(settings).where(eq(settings.key, key)).run();
    return;
  }
  const value = JSON.stringify([...ids]);
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** The user edited this row here: its fields are choices now, not defaults. */
export function markFieldsChosen(key: RecoveryKey, id: string): void {
  const ids = unrecoveredIds(key);
  if (ids.delete(id)) writeIds(key, ids);
}

/** Recovery done: nothing left waiting. */
export function clearUnrecovered(key: RecoveryKey): void {
  writeIds(key, new Set());
}
