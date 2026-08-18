import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

const expoDb = openDatabaseSync('pomodoso.db', { enableChangeListener: true });

export const db = drizzle(expoDb, { schema });

const SEED_HABITS = [
  { id: 'water', name: 'Water', icon: 'water', streakLabel: '🔥 12 day streak', done: true, sortOrder: 0 },
  { id: 'exercise', name: 'Exercise', icon: 'walk', streakLabel: '🔥 5 day streak', done: false, sortOrder: 1 },
  { id: 'read', name: 'Read 20 min', icon: 'book', streakLabel: 'No streak yet', done: false, sortOrder: 2 },
  { id: 'sleep', name: 'Sleep 8h', icon: 'moon', streakLabel: 'No streak yet', done: false, sortOrder: 3 },
] as const;

function initDb(): void {
  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      streak_label TEXT NOT NULL,
      done INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);

  const existing = expoDb.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM habits');
  if (existing?.count === 0) {
    for (const habit of SEED_HABITS) {
      db.insert(schema.habits).values(habit).run();
    }
  }
}

// Runs once, synchronously, the first time anything imports this module —
// expo-sqlite's sync API makes this safe to do at module scope for a spike.
initDb();
