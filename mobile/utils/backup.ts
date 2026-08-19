import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { db } from '@/db/client';
import { habitHistory, habits, pomodoroSession, project, settings, task, timerPrefs } from '@/db/schema';

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
export function importBackup(json: string): void {
  const envelope = validateBackup(json);
  db.transaction(tx => {
    for (const [name, table] of Object.entries(TABLES)) {
      tx.delete(table).run();
      const rows = envelope.data[name];
      if (Array.isArray(rows) && rows.length > 0) {
        tx.insert(table).values(rows as never[]).run();
      }
    }
  });
}
