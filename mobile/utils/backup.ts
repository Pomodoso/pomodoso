import { inArray } from 'drizzle-orm';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { db } from '@/db/client';
import { habitHistory, habits, pomodoroSession, project, settings, task, timerPrefs } from '@/db/schema';
import { cancelScheduledNotification } from '@/notifications';

// Ports extension's backup.ts. Simplified for what mobile actually has:
// no workspaces/taskOrders/meetings/detectionRules (none exist yet), and no
// EXCLUDED_SETTINGS filtering — mobile has no auth/sync state living in the
// settings table yet either. Once login/sync land, this needs the same
// treatment extension's backup.ts gives auth_session/entitlements/device_id/
// sync state: excluded from export, and cleared (not restored) on import so
// a restored device re-syncs from scratch instead of inheriting another
// device's identity.
const TABLES = {
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

export function exportBackup(): string {
  const data: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    data[name] = db.select().from(table).all();
  }
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
export async function importBackup(json: string): Promise<void> {
  const envelope = validateBackup(json);

  // Cancelled before the transaction (notification APIs are async, a
  // db.transaction callback isn't) — mirrors removeTask's cascade
  // (useTasks.ts): deleting a live session without cancelling its OS
  // notification first leaves an orphaned notification that still fires
  // later, referencing a session the imported database no longer has.
  const liveSessions = db.select().from(pomodoroSession).where(inArray(pomodoroSession.status, ['active', 'paused'])).all();
  for (const s of liveSessions) {
    if (!s.notificationId) continue;
    const cancelled = await cancelScheduledNotification(s.notificationId);
    if (!cancelled) {
      console.warn('Orphaned notification from a session cleared by import could not be cancelled:', s.notificationId);
    }
  }

  db.transaction(tx => {
    for (const [name, table] of Object.entries(TABLES)) {
      const rows = envelope.data[name];
      if (!Array.isArray(rows)) continue;
      tx.delete(table).run();
      if (rows.length > 0) {
        tx.insert(table).values(rows as never[]).run();
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
}
