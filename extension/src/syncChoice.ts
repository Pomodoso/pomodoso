import { readSyncChoice, writeSyncChoice, type SyncChoice } from '@pomodoso/types';

import { db } from './db';

export type { SyncChoice };

// What happens the first time an account signs in on a browser profile that
// already has data of its own.
//
// Sync is Last-Write-Wins at the record level, so without asking, the two
// sets simply union: whatever was in this profile is pushed into the account
// and whatever was in the account is pulled down. That is right when the
// profile was already yours and wrong in every other case — a shared
// machine, a second profile kept for testing, or an install carrying
// throwaway data signing into a real account. The merge is unremarkable
// while it happens and tedious to undo afterwards, because by then both
// sides look identical and there is no record of which rows came from where.
//
// Asked once per (account, backend), the same pair the pull cursor is scoped
// to — signing into a different account asks again, signing back into the
// same one does not.

const SYNC_CHOICE_KEY = 'sync_choice';

/** Content tables — everything a user creates that belongs to the account.
 *  `settings` is deliberately absent: it holds device preferences (theme,
 *  timer config, the auth session itself) rather than account content. */
const CONTENT_TABLES = [
  'tasks', 'taskOrders', 'projects', 'workspaces',
  'habits', 'habitHistory', 'meetings', 'detectionRules',
] as const;

export async function getSyncChoice(scope: string): Promise<SyncChoice | undefined> {
  return readSyncChoice((await db.settings.get(SYNC_CHOICE_KEY))?.value, scope);
}

export async function recordSyncChoice(scope: string, choice: SyncChoice): Promise<void> {
  await db.settings.put({ key: SYNC_CHOICE_KEY, value: writeSyncChoice(scope, choice) });
}

/** Whether this profile has anything of its own to lose. A fresh install has
 *  nothing to merge and is never asked. */
export async function hasLocalData(): Promise<boolean> {
  for (const name of CONTENT_TABLES) {
    if ((await db.table(name).count()) > 0) return true;
  }
  return false;
}

/** True when sync must not run yet because the user hasn't answered.
 *
 *  Checked inside syncAll() rather than at its call sites: triggerSync fires
 *  on a 1.5s debounce from ~25 mutation sites in App.tsx, plus the popup's
 *  own open-sync and the background worker's 1-minute alarm. Gating anywhere
 *  but the choke point would leave one of those quietly merging while the
 *  dialog is still open. */
export async function needsSyncChoice(scope: string): Promise<boolean> {
  return (await getSyncChoice(scope)) === undefined && (await hasLocalData());
}

/** Erases every local row so the account can be pulled fresh.
 *
 *  Dexie `clear()`, not the usual `deletedAt` tombstones. A tombstone means
 *  "this record was deleted, propagate that" and would push the deletions up
 *  into the account — destroying exactly the data the user just chose to
 *  keep. The rows are being abandoned, not deleted. */
export async function discardLocalData(): Promise<void> {
  await db.transaction('rw', CONTENT_TABLES.map(t => db.table(t)), async () => {
    for (const name of CONTENT_TABLES) await db.table(name).clear();
  });
}

// ─── Prompting ────────────────────────────────────────────────────────────────

// syncAll() is a plain function and the dialog is a component, so the gate
// publishes the pending scope and the popup subscribes. A module-level store
// rather than context: syncAll() also runs in the background service worker,
// where no React tree exists at all.

type Listener = (scope: string | null) => void;

let _pending: string | null = null;
const _listeners = new Set<Listener>();

export function requestSyncChoice(scope: string): void {
  if (_pending === scope) return;
  _pending = scope;
  for (const listener of _listeners) listener(_pending);
}

export function clearPendingSyncChoice(): void {
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
