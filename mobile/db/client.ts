import type { RecurrenceRule } from '@pomodoso/types';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import { habitLogId, uid } from '@/utils/id';

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

const STANDUP_RECURRENCE: RecurrenceRule = { freq: 'weekly', weekdays: [1, 2, 3, 4, 5], time: '09:30', startDate: '2026-01-05' };

// No `id` field here — real UUIDs (rule 3) are generated fresh per install at
// seed time below, not baked into these literals. Tasks don't cross-
// reference each other so that's all they need; habits are different (see
// SEED_HABIT_DEFS/seedHistory below).
const SEED_TASKS = [
  { title: 'Review MPL 2.0 question rename PR', ticketRef: 'INT-455', meta: '2 pomos · 50m', status: 'todo' as const, isPriority: false, sortOrder: 0 },
  { title: 'Fix flaky retry test in sync engine', ticketRef: 'POM-89', meta: '1h 20m', status: 'todo' as const, isPriority: true, sortOrder: 1 },
  { title: 'Write launch checklist doc', ticketRef: null, meta: '25m', status: 'todo' as const, isPriority: true, sortOrder: 2 },
  { title: 'Reply to App Store review notes', ticketRef: null, meta: 'Not started', status: 'todo' as const, isPriority: false, isToday: true, sortOrder: 3 },
  { title: 'Investigate SQLite adapter perf', ticketRef: 'POM-94', meta: 'Not started', status: 'todo' as const, isPriority: false, sortOrder: 4 },
  { title: 'Set up EAS Build project', ticketRef: null, meta: '40m · yesterday', status: 'done' as const, isPriority: false, sortOrder: 5 },
  {
    title: 'Daily standup notes',
    ticketRef: null,
    meta: 'Not started',
    status: 'todo' as const,
    isPriority: false,
    recurrence: JSON.stringify(STANDUP_RECURRENCE),
    sortOrder: 6,
  },
];

// `key` is a seed-time-only label (used to wire up seedHistory's
// habitId references and nothing else) — the real, stored `id` is a UUID
// generated fresh per install, same reasoning as SEED_TASKS above.
const SEED_HABIT_DEFS = [
  { key: 'water', name: 'Water', icon: 'water', kind: 'counter' as const, goal: 12, unit: 'ml', unitAmount: 250, days: '[]', sortOrder: 0 },
  { key: 'exercise', name: 'Exercise', icon: 'walk', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 1 },
  { key: 'read', name: 'Read 20 min', icon: 'book', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 2 },
  { key: 'sleep', name: 'Sleep 8h', icon: 'moon', kind: 'boolean' as const, goal: null, unit: null, unitAmount: null, days: '[]', sortOrder: 3 },
];

// Backfilled so the streak computed in useHabits() has something to show —
// matches the "🔥 12 day streak" / "🔥 5 day streak" flavor from the mockups.
// habitIds maps SEED_HABIT_DEFS' `key` to the real UUID generated for it at
// seed time (see initDb below). Ids use habitLogId (same deterministic
// scheme useHabits.ts uses for real writes), not uid() — matters once these
// rows sync: a random id here would let a second install's identical seed
// data collide-and-diverge on habit_id+date instead of converging.
function seedHistory(habitIds: Record<string, string>): { id: string; habitId: string; date: string; count: number; done: boolean }[] {
  const rows: { id: string; habitId: string; date: string; count: number; done: boolean }[] = [];

  // Water: 12 consecutive days at goal, then today partway through (5/12).
  for (let i = 1; i <= 12; i++) {
    const date = dateOffset(i);
    rows.push({ id: habitLogId(habitIds.water, date), habitId: habitIds.water, date, count: 12, done: true });
  }
  const today = dateOffset(0);
  rows.push({ id: habitLogId(habitIds.water, today), habitId: habitIds.water, date: today, count: 5, done: false });

  // Exercise: 5 consecutive days done (yesterday back), gap before that.
  for (let i = 1; i <= 5; i++) {
    const date = dateOffset(i);
    rows.push({ id: habitLogId(habitIds.exercise, date), habitId: habitIds.exercise, date, count: 0, done: true });
  }

  return rows;
}

// Content-based probe (not a column check, see hasCurrentSchema's comment
// above) — true if `table` has any row whose id isn't UUID-shaped, meaning
// it predates the rule-3 fix and needs a drop+reseed. Every table below
// gets ids exclusively from utils/id.ts's uid() now, so this only ever
// matches genuinely stale pre-fix data.
function hasStaleId(table: string): boolean {
  try {
    return Boolean(expoDb.getFirstSync<{ id: string }>(`SELECT id FROM ${table} WHERE length(id) != 36 LIMIT 1`));
  } catch {
    return false; // table doesn't exist yet / query failed — not this check's concern
  }
}

function initDb(): void {
  // This is a throwaway spike DB (see schema.ts) — no migration story yet, so
  // if an earlier version of the schema is on disk (missing `kind`), just
  // drop and reseed rather than building real migrations for data nobody
  // needs to keep. The second check isn't a schema/column probe like the
  // first — habits/habit_history switched from non-UUID seed ids
  // ('water', 'water-2026-08-20') to real UUIDs (rule 3) without any column
  // changing, so there's no column-existence signal to probe. A stale
  // pre-UUID habit id would otherwise silently diverge: toggleHabit/
  // incrementHabit's onConflictDoUpdate targets habitLogId(habitId, date),
  // which never matches an old-format row, so every toggle would insert a
  // fresh duplicate instead of updating the existing one.
  const hasCurrentSchema = (() => {
    try {
      expoDb.getFirstSync(
        'SELECT kind, days, created_at, updated_at, deleted_at, synced_at, challenge_length_days FROM habits LIMIT 1',
      );
      return !hasStaleId('habits');
    } catch {
      return false;
    }
  })();
  if (!hasCurrentSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS habits; DROP TABLE IF EXISTS habit_history;');
  }

  // Same throwaway-spike migration story for pomodoro_session's taskTitle ->
  // taskId change, later the prompt_resolved column (break flow), and now
  // the Fase B sync columns + the rule-3 UUID id fix (see hasStaleId) + the
  // new workspace_id FK.
  const hasCurrentSessionSchema = (() => {
    try {
      expoDb.getFirstSync(
        'SELECT task_id, prompt_resolved, updated_at, deleted_at, synced_at, workspace_id FROM pomodoro_session LIMIT 1',
      );
      return !hasStaleId('pomodoro_session');
    } catch {
      return false;
    }
  })();
  if (!hasCurrentSessionSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS pomodoro_session;');
  }

  // Same throwaway-spike migration story for task's done -> status change,
  // later the project_id, is_today, recurrence/completed_dates, and
  // description/links/note_entries columns, and now the Fase B sync columns
  // + the rule-3 UUID id fix (see hasStaleId) + the new workspace_id FK.
  const hasCurrentTaskSchema = (() => {
    try {
      expoDb.getFirstSync(
        'SELECT status, project_id, is_today, recurrence, completed_dates, description, links, note_entries, deleted_at, synced_at, workspace_id FROM task LIMIT 1',
      );
      return !hasStaleId('task');
    } catch {
      return false;
    }
  })();
  if (!hasCurrentTaskSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS task;');
  }

  // Project didn't need a schema-version probe before (no shape changes
  // since #31) — Fase B's deleted_at/synced_at is its first one, plus the
  // rule-3 UUID id fix (see hasStaleId) and the new workspace_id FK.
  const hasCurrentProjectSchema = (() => {
    try {
      expoDb.getFirstSync('SELECT deleted_at, synced_at, workspace_id FROM project LIMIT 1');
      return !hasStaleId('project');
    } catch {
      return false;
    }
  })();
  if (!hasCurrentProjectSchema) {
    expoDb.execSync('DROP TABLE IF EXISTS project;');
  }

  expoDb.execSync(`
    CREATE TABLE IF NOT EXISTS workspace (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      kind TEXT NOT NULL,
      goal INTEGER,
      unit TEXT,
      unit_amount INTEGER,
      days TEXT NOT NULL DEFAULT '[]',
      challenge_length_days INTEGER,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS habit_history (
      id TEXT PRIMARY KEY NOT NULL,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pomodoro_session (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      kind TEXT NOT NULL,
      task_id TEXT,
      planned_duration_seconds INTEGER,
      started_at TEXT NOT NULL,
      task_segment_started_at TEXT,
      paused_at TEXT,
      ended_at TEXT,
      status TEXT NOT NULL,
      notification_id TEXT,
      prompt_resolved INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
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
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      ticket_ref TEXT,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      project_id TEXT,
      is_priority INTEGER NOT NULL DEFAULT 0,
      is_today INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT,
      completed_dates TEXT NOT NULL DEFAULT '[]',
      description TEXT,
      links TEXT NOT NULL DEFAULT '[]',
      note_entries TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meeting (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      track_mode TEXT NOT NULL DEFAULT 'off',
      logged INTEGER NOT NULL DEFAULT 0,
      logged_minutes INTEGER,
      project_id TEXT,
      notes TEXT NOT NULL DEFAULT '',
      description TEXT,
      recurring_label TEXT,
      google_event_id TEXT,
      recurring_event_id TEXT,
      calendar_id TEXT,
      calendar_name TEXT,
      calendar_color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      synced_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_order (
      workspace_id TEXT PRIMARY KEY NOT NULL,
      updated_at TEXT NOT NULL,
      synced_at TEXT
    );
  `);

  // Additive on purpose, unlike the drop-and-recreate probes above. Those
  // predate any real data and reshaped columns; this only appends a nullable
  // one, and dropping the table would throw away local pomodoro history that
  // a free (unsynced) user has no way to get back. Throws harmlessly on a
  // database that already has the column, which is every run after the first.
  try {
    expoDb.execSync('ALTER TABLE pomodoro_session ADD COLUMN task_segment_started_at TEXT;');
  } catch {
    /* column already present */
  }

  // Seeds one real-UUID workspace on first run — not a sentinel string id
  // like extension's old 'default' (a migration scar there, not a design
  // choice worth replicating, see schema.ts's workspace comment). Resolved
  // before any task/project/session seeding below, all of which need a
  // workspaceId. Independent of the habits/tasks empty-table checks further
  // down — this only ever runs its own insert once, on whichever app run
  // first creates the workspace table.
  let workspaceRow = expoDb.getFirstSync<{ id: string }>('SELECT id FROM workspace WHERE deleted_at IS NULL LIMIT 1');
  if (!workspaceRow) {
    const now = new Date().toISOString();
    const id = uid();
    db.insert(schema.workspace).values({ id, name: 'Personal', color: '#4A6FA5', createdAt: now, updatedAt: now }).run();
    workspaceRow = { id };
  }
  const workspaceId = workspaceRow.id;

  const existing = expoDb.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM habits');
  if (existing?.count === 0) {
    const now = new Date().toISOString();
    const habitIds: Record<string, string> = {};
    for (const { key, ...def } of SEED_HABIT_DEFS) {
      const id = uid();
      habitIds[key] = id;
      db.insert(schema.habits).values({ ...def, id, createdAt: now, updatedAt: now }).run();
    }
    for (const row of seedHistory(habitIds)) {
      db.insert(schema.habitHistory).values({ ...row, updatedAt: now }).run();
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
      db.insert(schema.task).values({ ...seedTask, id: uid(), workspaceId, createdAt, updatedAt: createdAt }).run();
    }
  }
}

initDb();
