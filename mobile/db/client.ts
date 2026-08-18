import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

const expoDb = openDatabaseSync('pomodoso.db', { enableChangeListener: true });

export const db = drizzle(expoDb, { schema });

function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const SEED_HABITS = [
  { id: 'water', name: 'Water', icon: 'water', kind: 'counter' as const, goal: 12, unit: 'ml', unitAmount: 250, sortOrder: 0 },
  { id: 'exercise', name: 'Exercise', icon: 'walk', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, sortOrder: 1 },
  { id: 'read', name: 'Read 20 min', icon: 'book', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, sortOrder: 2 },
  { id: 'sleep', name: 'Sleep 8h', icon: 'moon', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, sortOrder: 3 },
];

// Backfilled so the streak computed in useHabits() has something to show —
// matches the "🔥 12 day streak" / "🔥 5 day streak" flavor from the mockups.
function seedHistory(): { id: string; habitId: string; date: string; count: number; done: boolean }[] {
  const rows: { id: string; habitId: string; date: string; count: number; done: boolean }[] = [];

  // Water: 12 consecutive days at goal, then today partway through (5/12).
  for (let i = 1; i <= 12; i++) {
    rows.push({ id: `water-${dateOffset(i)}`, habitId: 'water', date: dateOffset(i), count: 12, done: true });
  }
  rows.push({ id: `water-${dateOffset(0)}`, habitId: 'water', date: dateOffset(0), count: 5, done: false });

  // Exercise: 5 consecutive days done (yesterday back), gap before that.
  for (let i = 1; i <= 5; i++) {
    rows.push({ id: `exercise-${dateOffset(i)}`, habitId: 'exercise', date: dateOffset(i), count: 0, done: true });
  }

  return rows;
}

function initDb(): void {
  // This is a throwaway spike DB (see schema.ts) — no migration story yet, so
  // if an earlier version of the schema is on disk (missing `kind`), just
  // drop and reseed rather than building real migrations for data nobody
  // needs to keep.
  const hasCurrentSchema = (() => {
    try {
      expoDb.getFirstSync('SELECT kind FROM habits LIMIT 1');
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasCurrentSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS habits; DROP TABLE IF EXISTS habit_history;');
  }

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      kind TEXT NOT NULL,
      goal INTEGER,
      unit TEXT,
      unit_amount INTEGER,
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habit_history (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0
    );
  `);

  const existing = expoDb.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM habits');
  if (existing?.count === 0) {
    for (const habit of SEED_HABITS) {
      db.insert(schema.habits).values(habit).run();
    }
    for (const row of seedHistory()) {
      db.insert(schema.habitHistory).values(row).run();
    }
  }
}

initDb();
