import { eq, inArray, isNull } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { db } from '@/db/client';
import { achievements, habitHistory, habits, meeting, plugin, pluginRecord, pomodoroSession, project, SEED_IDS_KEY, settings, task, taskOrder, timerPrefs, WELCOME_SEEN_KEY, workspace } from '@/db/schema';
import { cancelScheduledNotification } from '@/notifications';
import { uid } from '@/utils/id';
import { untouchedSeedIds } from '@/utils/seed';
import { markTaskOrderDirty } from '@/utils/sync';

// Tables whose rows carry a workspaceId FK — need special handling on
// import (see the "Ensure a workspace exists" block below), unlike the
// otherwise fully generic per-table loop.
const WORKSPACE_SCOPED_TABLES = new Set(['task', 'project', 'pomodoroSession', 'meeting']);

// Device and sync state, never exported, and kept as they are on import —
// same rule as the extension's EXCLUDED_SETTINGS (extension/src/backup.ts):
//   - device_id identifies this install; importing it clones another device.
//   - sync_last_pull / *_synced_at are sync cursors: importing them makes
//     sync believe data is already pulled or pushed, so it skips it.
//   - sync_choice / can_sync answer questions about the device that made the
//     backup, not this one.
//   - active_timer_remote is a timer running on some other device, as last
//     announced to the one that made the backup.
//   - seed_row_ids lists *this* device's demo rows; another device's list
//     would mark nothing, or the wrong rows, as demo.
//   - welcome_seen is this device's answer to the welcome screen; a restore
//     must neither erase it nor answer it from another device.
const EXCLUDED_SETTINGS = new Set([
  'device_id',
  'sync_last_pull',
  'sync_choice',
  'can_sync',
  'active_timer_remote',
  SEED_IDS_KEY,
  WELCOME_SEEN_KEY,
]);
const isExcludedSetting = (key: string) => EXCLUDED_SETTINGS.has(key) || key.endsWith('_synced_at');

// Ports extension's backup.ts.
//
// `task_order` is the one table not in the backup: it holds only sync
// timestamps (Today/Priorities membership lives on the task rows, see
// db/schema.ts). Import rebuilds it instead, marking every live workspace's
// membership dirty so the restored Today and Priorities get pushed.
//
// `workspace` listed first so import's Object.entries loop below inserts it
// before task/project/pomodoroSession/meeting, which carry its id as
// workspaceId.
const TABLES = {
  workspace,
  habits,
  habitHistory,
  achievements,
  pomodoroSession,
  project,
  task,
  meeting,
  plugin,
  pluginRecord,
  timerPrefs,
  settings,
} as const;

// Imported rows must be dirty so the next sync pushes them (same as the
// extension's refreshSyncMeta): syncedAt is dropped, and updatedAt is bumped
// so Last-Write-Wins lets the restored data win on the server and other
// devices' incremental pull picks it up.
//
// Except task.updatedAt, which is kept: a resolved task with no sessions is
// grouped in History by that date (useTaskHistory.ts), so bumping it would
// move every restored task into today's History (and keep resolved ones in
// Today, see isUpdatedToday). Its syncedAt is still cleared, so it gets pushed.
//
// Never-edited rows (updatedAt === createdAt) keep theirs too: that equality
// is how utils/seed.ts tells an untouched demo row from user data, and
// bumping it would turn restored demo rows into real ones that sync.
function refreshSyncMeta(name: string, rows: unknown[]): unknown[] {
  const ts = new Date().toISOString();
  return rows.map(r => {
    const row = { ...(r as Record<string, unknown>) };
    if ('syncedAt' in row) row.syncedAt = null;
    const pristine = 'createdAt' in row && row.updatedAt === row.createdAt;
    if (name !== 'task' && !pristine && 'updatedAt' in row) row.updatedAt = ts;
    return row;
  });
}

const REQUIRED_TABLES = ['task', 'habits'] as const;

export interface BackupEnvelope {
  version: '1';
  exportedAt: string;
  data: Record<string, unknown[]>;
}

// Excludes soft-deleted rows (Fase B's deletedAt columns) — a backup is "my
// current data", not my current data plus a growing pile of tombstones the
// user already deleted. timerPrefs/settings have no deletedAt, exported as-is.
//
// Untouched demo rows stay out too. seed_row_ids is excluded (it lists this
// device's ids), so on another phone they would be indistinguishable from
// user data and get pushed into the account.
// "Untouched" means unedited *and* unused (see untouchedSeedIds): a demo row
// the user has adopted travels with the rest of their data.
export function exportBackup(): string {
  const seed = untouchedSeedIds();
  const without = <T extends { id: string }>(rows: T[], ids: string[]) => {
    const skip = new Set(ids);
    return rows.filter(r => !skip.has(r.id));
  };
  const data: Record<string, unknown[]> = {
    workspace: without(db.select().from(workspace).where(isNull(workspace.deletedAt)).all(), seed.workspace),
    habits: without(db.select().from(habits).where(isNull(habits.deletedAt)).all(), seed.habits),
    habitHistory: without(db.select().from(habitHistory).where(isNull(habitHistory.deletedAt)).all(), seed.habitHistory),
    achievements: db.select().from(achievements).where(isNull(achievements.deletedAt)).all(),
    pomodoroSession: db.select().from(pomodoroSession).where(isNull(pomodoroSession.deletedAt)).all(),
    project: db.select().from(project).where(isNull(project.deletedAt)).all(),
    task: without(db.select().from(task).where(isNull(task.deletedAt)).all(), seed.task),
    meeting: db.select().from(meeting).where(isNull(meeting.deletedAt)).all(),
    // Apps and their records travel like the extension's backup does: the
    // app with its manifest and settings, and every live record.
    plugin: db.select().from(plugin).where(isNull(plugin.deletedAt)).all(),
    pluginRecord: db.select().from(pluginRecord).where(isNull(pluginRecord.deletedAt)).all(),
    timerPrefs: db.select().from(timerPrefs).all(),
    settings: db.select().from(settings).all().filter(s => !isExcludedSetting(s.key)),
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
    // Every genuinely live workspace id after the `workspace` branch below
    // runs — a task/project/session row keeps its own workspaceId only if
    // it's in this set, otherwise it gets remapped to the resolved
    // `workspaceId` fallback. Needed because a row can carry a *present*
    // workspaceId that still points at a workspace the import just
    // tombstoned or dropped — "present" isn't the same as "live", and
    // leaving such a row alone would restore it pointing at a dead
    // workspace (Greptile P1 on the first version of this fix).
    let liveWorkspaceIds: Set<string> = new Set();

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
            tx.insert(table).values(refreshSyncMeta(name, rows) as never[]).run();
          }
        }
        // Re-query rather than trusting rows[0] either way: every imported
        // row could be a tombstone (deletedAt set) even though rows.length
        // > 0. Falls through to the "not included" path's own re-query when
        // rows isn't an array, so both branches converge on the same
        // liveWorkspaceIds/fallback logic below.
        const live = tx.select().from(workspace).where(isNull(workspace.deletedAt)).all();
        liveWorkspaceIds = new Set(live.map(w => w.id));
        workspaceId = live[0] ? live[0].id : seedFallbackWorkspace();
        if (!live[0]) liveWorkspaceIds.add(workspaceId);
        continue;
      }

      if (!Array.isArray(rows)) continue;

      if (name === 'settings') {
        // Device and sync state stays this device's (see EXCLUDED_SETTINGS),
        // except the sync cursors, which are cleared: after an import the next
        // sync must do a full pull and re-push everything. Same as the
        // extension's importDb.
        const local = tx.select().from(settings).all();
        for (const s of local) {
          if (!isExcludedSetting(s.key) || s.key.endsWith('_synced_at') || s.key === 'sync_last_pull') {
            tx.delete(settings).where(eq(settings.key, s.key)).run();
          }
        }
        // A restored preference's edit date is bumped, like a row's updatedAt
        // (see refreshSyncMeta): with the backup's older date, the server's
        // later value would win the next sync and overwrite the restore.
        const editedAt = JSON.stringify(new Date().toISOString());
        const restored = (rows as { key: string; value: string }[])
          .filter(s => !isExcludedSetting(s.key))
          .map(s => (s.key.endsWith('_updated_at') ? { ...s, value: editedAt } : s));
        if (restored.length > 0) tx.insert(settings).values(restored).run();
        continue;
      }

      tx.delete(table).run();
      if (rows.length > 0) {
        // A row keeps its own workspaceId only if it's genuinely live (see
        // liveWorkspaceIds above); otherwise it's remapped to the resolved
        // fallback, whether its own value was absent (legacy backup) or
        // present-but-dangling (pointed at a tombstoned/dropped workspace).
        const scoped = WORKSPACE_SCOPED_TABLES.has(name)
          ? rows.map(r => {
              const row = r as { workspaceId?: string };
              return liveWorkspaceIds.has(row.workspaceId ?? '') ? row : { ...row, workspaceId };
            })
          : rows;
        const values = refreshSyncMeta(name, scoped);
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

    // task_order isn't in the backup (see TABLES); the old rows describe
    // workspaces that may no longer exist.
    tx.delete(taskOrder).run();
  });

  // After the commit, so a rolled-back import doesn't leave orders marked.
  // Today/Priorities membership came back on the task rows; marking each
  // workspace dirty is what gets it pushed.
  for (const w of db.select({ id: workspace.id }).from(workspace).where(isNull(workspace.deletedAt)).all()) {
    markTaskOrderDirty(w.id);
  }

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
