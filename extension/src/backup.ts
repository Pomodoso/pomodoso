import { db, normalizeWorkspaces, now, sanitizeHabitData } from './db';
import type { HabitRow, HabitHistoryRow, ProjectRow, WorkspaceRow } from './db';

// auth_session contains JWT tokens — never export.
// device_id identifies this install — importing it would clone another device's identity.
// entitlements / sync_last_pull / *_synced_at are sync state: importing them makes the
// sync engine believe data is already synced (or pulled), so nothing gets pushed and
// incremental pulls skip server rows — that's how imported projects "disappeared".
const EXCLUDED_SETTINGS = new Set([
  'calendar_last_synced',
  'auth_session',
  'entitlements',
  'device_id',
  'sync_last_pull',
]);
const isExcludedSetting = (key: string) =>
  EXCLUDED_SETTINGS.has(key) || key.endsWith('_synced_at');

// Tables a backup must contain to be considered valid. Tables added in newer
// versions are imported when present but don't invalidate older backups.
const REQUIRED_TABLES = ['tasks', 'projects', 'workspaces', 'habits'] as const;
const ALL_TABLES = ['tasks', 'taskOrders', 'projects', 'workspaces', 'habits', 'habitHistory', 'meetings', 'detectionRules', 'settings'] as const;

export interface BackupEnvelope {
  version: '1';
  exportedAt: string;
  data: Record<string, unknown[]>;
}

// Imported rows must look "dirty" AND be the newest write so the sync engine
// re-pushes them and *other* devices actually receive them:
//   - drop syncedAt        → the row is dirty and gets pushed
//   - bump updatedAt = now → (1) LWW makes the restored data win on the server
//                            (2) other devices' incremental pull (`updated_at >
//                                since`) catches it. Keeping the backup's old
//                                updatedAt is why imported habits/tasks never
//                                reached a second extension — their timestamp
//                                predated the other device's pull cursor.
function refreshSyncMeta<T extends { syncedAt?: string; updatedAt?: string }>(rows: T[]): T[] {
  const ts = now();
  return rows.map(r => {
    const { syncedAt: _ignored, ...rest } = r;
    if ('updatedAt' in rest) (rest as { updatedAt?: string }).updatedAt = ts;
    return rest as T;
  });
}

export async function exportDb(): Promise<string> {
  const [tasks, taskOrders, projects, workspaces, habits, habitHistory, meetings, detectionRules, allSettings] = await Promise.all([
    db.tasks.toArray(),
    db.taskOrders.toArray(),
    db.projects.toArray(),
    db.workspaces.toArray(),
    db.habits.toArray(),
    db.habitHistory.toArray(),
    db.meetings.toArray(),
    db.detectionRules.toArray(),
    db.settings.toArray(),
  ]);

  const settings = allSettings.filter(s => !isExcludedSetting(s.key));

  const envelope: BackupEnvelope = {
    version: '1',
    exportedAt: new Date().toISOString(),
    data: { tasks, taskOrders, projects, workspaces, habits, habitHistory, meetings, detectionRules, settings },
  };

  return JSON.stringify(envelope, null, 2);
}

export async function importDb(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Partial<BackupEnvelope>;

  if (parsed.version !== '1' || !parsed.data) {
    throw new Error('Invalid backup file: missing version or data');
  }

  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(parsed.data[table])) {
      throw new Error(`Invalid backup file: missing table "${table}"`);
    }
  }

  const data = parsed.data;
  const rows = (table: (typeof ALL_TABLES)[number]): unknown[] =>
    Array.isArray(data[table]) ? data[table] : [];

  await db.transaction('rw', [db.tasks, db.taskOrders, db.projects, db.workspaces, db.habits, db.habitHistory, db.meetings, db.detectionRules, db.settings], async () => {
    await Promise.all([
      db.tasks.clear(),
      db.taskOrders.clear(),
      db.projects.clear(),
      db.workspaces.clear(),
      db.habits.clear(),
      db.habitHistory.clear(),
      db.meetings.clear(),
      db.detectionRules.clear(),
    ]);

    // Settings: clear non-excluded keys, plus local sync state — after an import
    // the next sync must do a full pull and re-push everything (LWW merges).
    const existingSettings = await db.settings.toArray();
    const keysToDelete = existingSettings
      .map(s => s.key)
      .filter(k => !isExcludedSetting(k) || k.endsWith('_synced_at') || k === 'sync_last_pull');
    await db.settings.bulkDelete(keysToDelete);

    // Projects: drop dangling workspace refs (e.g. legacy 'default' or a
    // workspace not present in this backup) → null, so sync re-homes them to a
    // valid workspace instead of orphaning them.
    const validWsIds = new Set((rows('workspaces') as WorkspaceRow[]).map(w => w.id));
    const cleanProjects = (refreshSyncMeta(rows('projects') as never[]) as ProjectRow[]).map(p => ({
      ...p,
      workspaceId: p.workspaceId && validWsIds.has(p.workspaceId) ? p.workspaceId : null,
    }));

    // Habits: globalize + fix non-UUID ids / orphan history (see sanitizeHabitData).
    const sane = sanitizeHabitData(
      refreshSyncMeta(rows('habits') as never[]) as HabitRow[],
      refreshSyncMeta(rows('habitHistory') as never[]) as HabitHistoryRow[],
    );

    await Promise.all([
      db.tasks.bulkPut(refreshSyncMeta(rows('tasks') as never[])),
      db.taskOrders.bulkPut(refreshSyncMeta(rows('taskOrders') as never[])),
      db.projects.bulkPut(cleanProjects as never[]),
      db.workspaces.bulkPut(refreshSyncMeta(rows('workspaces') as never[])),
      db.habits.bulkPut(sane.habits as never[]),
      db.habitHistory.bulkPut(sane.history as never[]),
      db.meetings.bulkPut(rows('meetings') as never[]),
      db.detectionRules.bulkPut(refreshSyncMeta(rows('detectionRules') as never[])),
      db.settings.bulkPut((rows('settings') as { key: string }[]).filter(s => !isExcludedSetting(s.key)) as never[]),
    ]);
  });

  // Backups can carry duplicate same-named workspaces from older versions —
  // converge them right away (sync repeats this against the server later).
  await normalizeWorkspaces();
}
