import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

const expoDb = openDatabaseSync('pomodoso.db', { enableChangeListener: true });

export const db = drizzle(expoDb, { schema });

function dateOffset(daysAgo: number): string {
  // Local calendar date, matching hooks/useHabits.ts — habit_history.date is
  // a local date, not UTC.
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('en-CA');
}

const SEED_TASKS = [
  { id: 'task-mpl', title: 'Review MPL 2.0 question rename PR', ticketRef: 'INT-455', meta: '2 pomos · 50m', status: 'todo' as const, isPriority: false, sortOrder: 0 },
  { id: 'task-flaky', title: 'Fix flaky retry test in sync engine', ticketRef: 'POM-89', meta: '1h 20m', status: 'todo' as const, isPriority: true, sortOrder: 1 },
  { id: 'task-checklist', title: 'Write launch checklist doc', ticketRef: null, meta: '25m', status: 'todo' as const, isPriority: true, sortOrder: 2 },
  { id: 'task-appstore', title: 'Reply to App Store review notes', ticketRef: null, meta: 'Not started', status: 'todo' as const, isPriority: false, isToday: true, sortOrder: 3 },
  { id: 'task-sqlite', title: 'Investigate SQLite adapter perf', ticketRef: 'POM-94', meta: 'Not started', status: 'todo' as const, isPriority: false, sortOrder: 4 },
  { id: 'task-eas', title: 'Set up EAS Build project', ticketRef: null, meta: '40m · yesterday', status: 'done' as const, isPriority: false, sortOrder: 5 },
];

const SEED_HABITS = [
  { id: 'water', name: 'Water', icon: 'water', kind: 'counter' as const, goal: 12, unit: 'ml', unitAmount: 250, days: '[]', sortOrder: 0 },
  { id: 'exercise', name: 'Exercise', icon: 'walk', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 1 },
  { id: 'read', name: 'Read 20 min', icon: 'book', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 2 },
  { id: 'sleep', name: 'Sleep 8h', icon: 'moon', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 3 },
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
      expoDb.getFirstSync('SELECT kind, days FROM habits LIMIT 1');
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasCurrentSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS habits; DROP TABLE IF EXISTS habit_history;');
  }

  // Same throwaway-spike migration story for pomodoro_session's taskTitle ->
  // taskId change, and later the prompt_resolved column (break flow).
  const hasCurrentSessionSchema = (() => {
    try {
      expoDb.getFirstSync('SELECT task_id, prompt_resolved FROM pomodoro_session LIMIT 1');
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasCurrentSessionSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS pomodoro_session;');
  }

  // Same throwaway-spike migration story for task's done -> status change,
  // and later the project_id and is_today columns.
  const hasCurrentTaskSchema = (() => {
    try {
      expoDb.getFirstSync('SELECT status, project_id, is_today FROM task LIMIT 1');
      return true;
    } catch {
      return false;
    }
  })();
  if (!hasCurrentTaskSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS task;');
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
      days TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS habit_history (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pomodoro_session (
      id TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT,
      planned_duration_seconds INTEGER,
      started_at TEXT NOT NULL,
      paused_at TEXT,
      ended_at TEXT,
      status TEXT NOT NULL,
      notification_id TEXT,
      prompt_resolved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS timer_prefs (
      id TEXT PRIMARY KEY NOT NULL,
      last_mode TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      ticket_ref TEXT,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      project_id TEXT,
      is_priority INTEGER NOT NULL DEFAULT 0,
      is_today INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

  const hasPrefs = expoDb.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM timer_prefs');
  if (hasPrefs?.count === 0) {
    db.insert(schema.timerPrefs).values({ id: 'singleton', lastMode: 'pomodoro' }).run();
  }

  const hasTasks = expoDb.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM task');
  if (hasTasks?.count === 0) {
    const createdAt = new Date().toISOString();
    for (const seedTask of SEED_TASKS) {
      db.insert(schema.task).values({ ...seedTask, createdAt, updatedAt: createdAt }).run();
    }
  }
}

initDb();
