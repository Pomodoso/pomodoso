import { pullScope, readSyncChoice, writeSyncChoice, type SyncChoice } from '@pomodoso/types';
import { eq, not } from 'drizzle-orm';

import { db } from '@/db/client';
import { hasUserData } from '@/utils/seed';
import { habits, habitHistory, meeting, pomodoroSession, project, settings, task, taskOrder, timerPrefs, workspace } from '@/db/schema';

// What happens the first time an account signs in on a device that already
// has data of its own.
//
// Sync is Last-Write-Wins at the record level, so without asking, the two
// sets simply union: whatever was on the device is pushed into the account
// and whatever was in the account is pulled onto the device. That is right
// when the device was already yours and wrong in every other case — a
// borrowed phone, a shared laptop, or (the case that prompted this) a
// device carrying throwaway test data signing into a real account. The
// merge is unremarkable while it happens and tedious to undo afterwards,
// because by then both sides look identical and there is no record of which
// rows came from where.
//
// So it is asked once per (account, backend), the same pair the pull cursor
// is scoped to — signing into a different account asks again, and signing
// back into the same one does not.

const SYNC_CHOICE_KEY = 'sync_choice';
// Mirrors utils/sync.ts's own key — the one setting discardLocalData keeps.
const DEVICE_ID_KEY = 'device_id';

export type { SyncChoice };

function getSetting(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value;
}

function putSetting(key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/** The (account, backend) pair a choice applies to. Deliberately the same
 *  scope the pull cursor uses, so the two can never disagree about which
 *  account a device is currently talking to. */
export { pullScope as syncScope };

export function getSyncChoice(scope: string): SyncChoice | undefined {
  const raw = getSetting(SYNC_CHOICE_KEY);
  if (!raw) return undefined;
  // Unlike the extension, which keeps native objects in IndexedDB, mobile
  // stores JSON in a TEXT column — so the parse is this client's business
  // and only the shape is shared.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return readSyncChoice(parsed, scope);
}

export function recordSyncChoice(scope: string, choice: SyncChoice): void {
  putSetting(SYNC_CHOICE_KEY, JSON.stringify(writeSyncChoice(scope, choice)));
}

/** Whether this device has anything of its own to lose.
 *
 *  Counting rows was wrong: initDb seeds a workspace, four habits with a
 *  fortnight of history and seven demo tasks on first launch, so every
 *  install answered yes and the question was unskippable — the opposite of
 *  what the original comment here claimed. utils/seed.ts knows which rows
 *  the app wrote to itself and which the user made. */
export function hasLocalData(): boolean {
  return hasUserData();
}

/** True when sync must not run yet because the user hasn't answered.
 *
 *  Checked inside syncNow() rather than at its call sites: triggerSync fires
 *  on a 1.5s debounce from every mutation, plus foreground, cold start and a
 *  60s poll. Gating anywhere but the single choke point would leave one of
 *  those quietly merging while the dialog is still on screen. */
export function needsSyncChoice(scope: string): boolean {
  return getSyncChoice(scope) === undefined && hasLocalData();
}

/** Erases every local row so the account can be pulled fresh.
 *
 *  Hard deletes, not the usual `deleted_at` tombstones. A tombstone means
 *  "this record was deleted, propagate that" and would push the deletions up
 *  into the account — destroying exactly the data the user just chose to
 *  keep. The rows are being abandoned, not deleted.
 *
 *  Settings and timer prefs go too. An earlier version kept them as "device
 *  preferences", which left the device holding timer durations, week start
 *  and a Google Calendar connection belonging to whatever was here before —
 *  a half-wipe that reads as a bug when the answer given was "use my account
 *  only". The rule is simpler: config comes from the account, data is either
 *  merged or replaced.
 *
 *  `device_id` is the one survivor. It identifies this install rather than
 *  describing any content, and regenerating it would register a second
 *  device server-side for the same phone.
 *
 *  Mobile can afford to clear settings because the Supabase session lives in
 *  SecureStore (lib/supabase.ts), not here — the extension keeps its session
 *  in the equivalent table and must exclude it, or answering the question
 *  signs you out mid-answer.
 *
 *  A pomodoro running at this moment does stop, because the running session
 *  *is* a pomodoro_session row and useTimer derives `active` from that table.
 *  That's the honest outcome — the session is local data and the user chose
 *  to discard local data — and it leaves nothing dangling, which keeping the
 *  row while deleting its task would not. */
export function discardLocalData(): void {
  db.delete(task).run();
  db.delete(project).run();
  db.delete(workspace).run();
  db.delete(habits).run();
  db.delete(habitHistory).run();
  db.delete(pomodoroSession).run();
  db.delete(meeting).run();
  db.delete(taskOrder).run();
  db.delete(timerPrefs).run();
  db.delete(settings).where(not(eq(settings.key, DEVICE_ID_KEY))).run();
}

// ─── Prompting ────────────────────────────────────────────────────────────────

// syncNow() is a plain function and the dialog is a component, so the gate
// publishes the pending scope and the UI subscribes. A module-level store
// rather than context: syncNow() is called from background-fetch and the
// foreground poll as well as from React, and none of those have a provider
// above them.

type Listener = (scope: string | null) => void;

let _pending: string | null = null;
const _listeners = new Set<Listener>();

export function requestSyncChoice(scope: string): void {
  if (_pending === scope) return;
  _pending = scope;
  for (const listener of _listeners) listener(_pending);
}

export function resolveSyncChoice(): void {
  if (_pending === null) return;
  _pending = null;
  for (const listener of _listeners) listener(null);
}

export function getPendingSyncChoice(): string | null {
  return _pending;
}

export function subscribeSyncChoice(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
