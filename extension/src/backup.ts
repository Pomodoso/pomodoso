import { db } from './db';

// auth_session contains JWT tokens — never export
const EXCLUDED_SETTINGS = new Set(['calendar_last_synced', 'auth_session']);
const EXPECTED_TABLES = ['tasks', 'taskOrders', 'projects', 'workspaces', 'habits', 'habitHistory', 'meetings', 'detectionRules', 'settings'] as const;

export interface BackupEnvelope {
  version: '1';
  exportedAt: string;
  data: Record<string, unknown[]>;
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

  const settings = allSettings.filter(s => !EXCLUDED_SETTINGS.has(s.key));

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

  for (const table of EXPECTED_TABLES) {
    if (!Array.isArray(parsed.data[table])) {
      throw new Error(`Invalid backup file: missing table "${table}"`);
    }
  }

  const { tasks, taskOrders, projects, workspaces, habits, habitHistory, meetings, detectionRules, settings } = parsed.data;

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

    // Settings: clear only non-excluded keys, then restore
    const existingSettings = await db.settings.toArray();
    const keysToDelete = existingSettings.map(s => s.key).filter(k => !EXCLUDED_SETTINGS.has(k));
    await db.settings.bulkDelete(keysToDelete);

    await Promise.all([
      db.tasks.bulkPut(tasks as never[]),
      db.taskOrders.bulkPut(taskOrders as never[]),
      db.projects.bulkPut(projects as never[]),
      db.workspaces.bulkPut(workspaces as never[]),
      db.habits.bulkPut(habits as never[]),
      db.habitHistory.bulkPut(habitHistory as never[]),
      db.meetings.bulkPut(meetings as never[]),
      db.detectionRules.bulkPut(detectionRules as never[]),
      db.settings.bulkPut((settings as never[]).filter((s: { key: string }) => !EXCLUDED_SETTINGS.has(s.key))),
    ]);
  });
}
