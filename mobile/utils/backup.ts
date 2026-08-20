import { inArray, isNull } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { db } from '@/db/client';
import { habitHistory, habits, pomodoroSession, project, settings, task, timerPrefs, workspace } from '@/db/schema';
import { cancelScheduledNotification } from '@/notifications';
import { uid } from '@/utils/id';

// Tables whose rows carry a workspaceId FK — need special handling on
// import (see the "Ensure a workspace exists" block below), unlike the
// otherwise fully generic per-table loop.
const WORKSPACE_SCOPED_TABLES = new Set(['task', 'project', 'pomodoroSession']);

// Ports extension's backup.ts. Simplified for what mobile actually has: no
// taskOrders/meetings/detectionRules (none exist yet), and no
// EXCLUDED_SETTINGS filtering — mobile has no auth/sync state living in the
// settings table yet either. Once login/sync land, this needs the same
// treatment extension's backup.ts gives auth_session/entitlements/device_id/
// sync state: excluded from export, and cleared (not restored) on import so
// a restored device re-syncs from scratch instead of inheriting another
// device's identity.
//
// `workspace` listed first so import's Object.entries loop below inserts it
// before task/project/pomodoroSession, which carry its id as workspaceId.
const TABLES = {
  workspace,
  habits,
  habitHistory,
  pomodoroSession,
  project,
  task,
  timerPrefs,
  settings,
} as const;

const REQUIRED_TABLES = ['task', 'habits'] as const;

export interface BackupEnvelope {
  version: '1';
  exportedAt: string;
  data: Record<string, unknown[]>;
}

// Excludes soft-deleted rows (Fase B's deletedAt columns) — a backup is "my
// current data", not my current data plus a growing pile of tombstones the
// user already deleted. timerPrefs/settings have no deletedAt, exported as-is.
export function exportBackup(): string {
  const data: Record<string, unknown[]> = {
    workspace: db.select().from(workspace).where(isNull(workspace.deletedAt)).all(),
    habits: db.select().from(habits).where(isNull(habits.deletedAt)).all(),
    habitHistory: db.select().from(habitHistory).where(isNull(habitHistory.deletedAt)).all(),
    pomodoroSession: db.select().from(pomodoroSession).where(isNull(pomodoroSession.deletedAt)).all(),
    project: db.select().from(project).where(isNull(project.deletedAt)).all(),
    task: db.select().from(task).where(isNull(task.deletedAt)).all(),
    timerPrefs: db.select().from(timerPrefs).all(),
    settings: db.select().from(settings).all(),
  };
  const envelope: BackupEnvelope = { version: '1', exportedAt: new Date().toISOString(), data };
  return JSON.stringify(envelope, null, 2);
}

// Writes the export to a cache file and opens the native share sheet — the
// mobile equivalent of the extension's browser download, since there's no
// Downloads folder to write into directly.
export async function shareBackup(): Promise<void> {
  const json = exportBackup();
  const date = new Date().toLocaleDateString('en-CA');
  const file = new File(Paths.cache, `pomodoso-${date}.json`);
  file.create({ overwrite: true });
  file.write(json);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export Pomodoso data' });
  }
}

export function validateBackup(json: string): BackupEnvelope {
  let parsed: Partial<BackupEnvelope>;
  try {
    parsed = JSON.parse(json) as Partial<BackupEnvelope>;
  } catch {
    throw new Error('Invalid backup file: not valid JSON');
  }
  if (parsed.version !== '1' || !parsed.data) {
    throw new Error('Invalid backup file: missing version or data');
  }
  for (const t of REQUIRED_TABLES) {
    if (!Array.isArray(parsed.data[t])) {
      throw new Error(`Invalid backup file: missing table "${t}"`);
    }
  }
  return parsed as BackupEnvelope;
}

// Replaces every local table's contents with the backup's. Transactional so
// a failure partway through can't leave some tables replaced and others
// stale — same reasoning as removeHabit's cascade (useHabits.ts).
//
// A table is only touched if the backup actually includes it (even as an
// explicit empty array — that still means "this table should be empty").
// validateBackup only requires task+habits (REQUIRED_TABLES), so an older
// or partial backup can validly omit any other table — deleting those
// unconditionally would silently erase local data the backup never meant
// to touch, while the UI still reported a successful restore.
//
// The wipe below (tx.delete, not a deletedAt tombstone) is deliberately a
// real hard delete, unlike every other mutation in the app post-Fase B —
// this is a full "replace the world" operation behind an explicit
// destructive confirmation, not a per-row user delete that needs to
// propagate as a tombstone. Soft-deleting first would leave potentially
// thousands of tombstones for rows about to be overwritten by the backup's
// own content anyway, which could then sync as spurious deletions against a
// device that has genuinely current data.
export async function importBackup(json: string): Promise<void> {
  const envelope = validateBackup(json);

  // Snapshot before the transaction, but only cancel notifications AFTER
  // it commits (see below) — cancelling first would desync notification
  // state from DB state if the transaction then rolled back (a malformed
  // backup row violating a constraint, say): the session row would survive
  // the rollback exactly as it was, but its notification would already be
  // gone, so a backgrounded timer would finish silently.
  const liveSessions = db.select().from(pomodoroSession).where(inArray(pomodoroSession.status, ['active', 'paused'])).all();

  db.transaction(tx => {
    // Resolved below, before task/project/pomodoroSession (which carry it)
    // are inserted. Two real gaps this closes (Greptile P1): a legacy
    // pre-workspace backup's task/project/session rows have no workspaceId
    // key at all, which would otherwise violate the NOT NULL column and
    // fail the whole import; and a backup that validly includes an empty
    // `workspace: []` would otherwise leave the device with no workspace
    // at all afterward, crashing every useWorkspace() consumer on next
    // render (it throws rather than returning null — see that hook).
    let workspaceId: string | null = null;

    // Seeds a fresh "Personal" workspace and returns its id — the shared
    // last-resort fallback for every path below that can end up with no
    // live workspace row (empty `workspace: []`, a backup whose workspace
    // rows are ALL tombstones — deletedAt set, an easy miss since inserting
    // *a* row isn't the same as inserting a *live* one, or no live row
    // already on the device for the legacy no-workspace-key case).
    function seedFallbackWorkspace(): string {
      const id = uid();
      const now = new Date().toISOString();
      tx.insert(workspace).values({ id, name: 'Personal', color: '#4A6FA5', createdAt: now, updatedAt: now }).run();
      return id;
    }

    for (const [name, table] of Object.entries(TABLES)) {
      const rows = envelope.data[name];

      if (name === 'workspace') {
        if (Array.isArray(rows)) {
          // Included (even as an explicit empty array) — matches every
          // other table's "included → wipe and replace" rule.
          tx.delete(table).run();
          if (rows.length > 0) {
            tx.insert(table).values(rows as never[]).run();
          }
          // Re-query rather than trusting rows[0]: every imported row could
          // be a tombstone (deletedAt set) even though rows.length > 0 —
          // Greptile P1 on the first version of this fix.
          const live = tx.select().from(workspace).where(isNull(workspace.deletedAt)).all();
          workspaceId = live[0] ? live[0].id : seedFallbackWorkspace();
        } else {
          // Not included at all — a legacy pre-workspace backup. Matches
          // every other table's "not included → don't touch" rule: keep
          // the device's current workspace instead of replacing it with a
          // synthetic one.
          const existing = tx.select().from(workspace).where(isNull(workspace.deletedAt)).all();
          workspaceId = existing[0] ? existing[0].id : seedFallbackWorkspace();
        }
        continue;
      }

      if (!Array.isArray(rows)) continue;
      tx.delete(table).run();
      if (rows.length > 0) {
        // Backfill only rows that don't already carry a workspaceId — the
        // object-spread order means a genuine value from the row always
        // wins over this fallback.
        const values = WORKSPACE_SCOPED_TABLES.has(name) ? rows.map(r => ({ workspaceId, ...(r as object) })) : rows;
        tx.insert(table).values(values as never[]).run();
      }
    }
    // Regardless of whether pomodoroSession was itself included above: an
    // import replaces the world state (tasks get new rows/ids), so a
    // still-active/paused session from before the import — or one that
    // rode along in the backup's own snapshot — can't be left running. It
    // may now reference a task that no longer exists, and worse, an
    // orphaned active/paused row permanently blocks startSession's atomic
    // "no active session" guard (useTimer.ts) from ever starting a new one.
    tx.delete(pomodoroSession).where(inArray(pomodoroSession.status, ['active', 'paused'])).run();
  });

  // Only reached if the transaction above actually committed (it throws on
  // rollback, which propagates out of this function before reaching here)
  // — so every session in liveSessions is now genuinely gone. Cancellation
  // failure is logged, not treated as fatal, same as removeTask's cascade
  // (useTasks.ts): a rare failure to cancel one notification shouldn't
  // block an otherwise-successful import.
  for (const s of liveSessions) {
    if (!s.notificationId) continue;
    const cancelled = await cancelScheduledNotification(s.notificationId);
    if (!cancelled) {
      console.warn('Orphaned notification from a session cleared by import could not be cancelled:', s.notificationId);
    }
  }
}
