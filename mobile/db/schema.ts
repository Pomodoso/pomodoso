import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Spike schema to validate the expo-sqlite + drizzle-orm combo (M0 backlog item
// in docs/mobile-app-plan.md). Mirrors the real shape from
// extension/src/db.ts's HabitRow/HabitHistoryRow split — habit *definition*
// (kind, goal, unit) separate from per-day *progress* (count/done), since
// "done" resets daily and isn't a property of the habit itself. Still a spike,
// not the real shared data model — that comes with the shared/core extraction.
// createdAt/updatedAt/deletedAt/syncedAt on habits+habitHistory are the
// CLAUDE.md rule 5 foundation for Fase B sync — habits sync user-global
// (rule 6), not workspace-scoped. updatedAt drives LWW; deletedAt is the
// tombstone; syncedAt marks what's already been pushed (see useHabits.ts's
// soft-delete conversion). createdAt on habits specifically mirrors
// extension's HabitRow.createdAt — immutable, separate from updatedAt.
// habitHistory has no createdAt: `date` already anchors "when" for a
// history row, an extra creation timestamp adds nothing extension's own
// HabitHistoryRow doesn't already skip either.
export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  kind: text('kind', { enum: ['boolean', 'counter'] }).notNull(),
  goal: integer('goal'), // counter only — target step count for the day
  unit: text('unit'), // counter only — e.g. 'ml'
  unitAmount: integer('unit_amount'), // counter only — amount per step, e.g. 250
  // JSON-stringified number[], matching extension/src/db.ts's HabitRow.days
  // exactly: 0=Mon..6=Sun, [] means "every day" (canonical form for daily —
  // the extension's own form always saves length-7 selections as []).
  days: text('days').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  syncedAt: text('synced_at'),
});

export const habitHistory = sqliteTable('habit_history', {
  id: text('id').primaryKey(),
  habitId: text('habit_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD, local
  count: integer('count').notNull().default(0),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  syncedAt: text('synced_at'),
});

// Mirrors the shape of the real spec's pomodoro_session entity (section 6.1)
// closely enough for a device-local mobile spike: one row per session,
// "active" is just the row with status active/paused. taskId is nullable —
// spec 6.1 says task association is mandatory, relaxed here since a session
// can be "unassigned time" (documented deviation, see useTimer.ts).
export const pomodoroSession = sqliteTable('pomodoro_session', {
  id: text('id').primaryKey(),
  // 'manual' mirrors extension's TimerMode (@pomodoso/types) — a retroactive
  // time-log entry with no live timer lifecycle, always inserted directly as
  // status='completed'/promptResolved=true (see useTasks.ts's addManualTime).
  mode: text('mode', { enum: ['pomodoro', 'stopwatch', 'manual'] }).notNull(),
  kind: text('kind', { enum: ['focus', 'short_break', 'long_break'] }).notNull(),
  taskId: text('task_id'),
  plannedDurationSeconds: integer('planned_duration_seconds'), // null for stopwatch
  // startedAt is shifted forward by the paused duration on every resume, so
  // "elapsed" is always just (now - startedAt) while active — no separate
  // accumulator to keep in sync.
  startedAt: text('started_at').notNull(),
  pausedAt: text('paused_at'),
  endedAt: text('ended_at'),
  status: text('status', { enum: ['active', 'paused', 'completed', 'interrupted'] }).notNull(),
  notificationId: text('notification_id'),
  // Whether the post-session prompt (offer a break after a completed focus
  // pomodoro; offer the next focus after a completed break) has been acted
  // on — started or explicitly skipped/dismissed. Derived from real DB state
  // rather than an ephemeral in-memory "stage" flag (extension's TimerState
  // equivalent lives only in chrome.storage.local, see useTimer.ts), so the
  // prompt survives the app being killed and reopened.
  promptResolved: integer('prompt_resolved', { mode: 'boolean' }).notNull().default(false),
  // CLAUDE.md rule 5/7 foundation for Fase B sync — no separate createdAt,
  // startedAt already anchors "when" for a session the same way habitHistory's
  // `date` does. updatedAt must be bumped on every mutation (pause/resume/
  // complete/cancel), not just insert, since LWW compares it.
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  syncedAt: text('synced_at'),
});

// Mirrors extension/src/db.ts's ProjectRow, minus workspaceId (mobile has
// no workspace concept yet — the extension itself treats a project with no
// workspaceId as global/visible everywhere, so dropping the field entirely
// is equivalent, not a narrowing) and endDate (extension's "archived after"
// date — no archival UI ported yet, not needed until projects list grows).
export const project = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  syncedAt: text('synced_at'),
});

export type ProjectRow = typeof project.$inferSelect;

// Status set matches extension/src/db.ts's TaskStatus exactly, so the
// mobile status picker mirrors the extension's semantics/UX (see
// STATUS_OPTIONS/STATUS_DOT_COLOR in extension/src/popup/HomeState.tsx).
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed' | 'cancelled';

// Mirrors extension's db.ts TaskLink/NoteEntry exactly — not exported from
// @pomodoso/types (extension-local types there too), so defined locally
// here alongside TaskStatus rather than duplicated per-consumer.
export interface TaskLink {
  url: string;
  label: string;
}

export interface NoteEntry {
  id: string;
  createdAt: string; // ISO
  content: string;
}

// Spike task model — enough to back Home's "Today's priorities" and the Tasks
// tab. No project/workspace yet (comes with the shared/core extraction and a
// real multi-entity model). pomodoroSession.taskId references this — meta is
// computed from completed sessions where possible (useTasks.ts), falling
// back to this stored string only for tasks with no real session history
// yet ("Not started"). updatedAt drives the "completed today stays visible
// in Today, rolls off the next day" rule the extension already has.
export const task = sqliteTable('task', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  ticketRef: text('ticket_ref'),
  meta: text('meta'), // fallback placeholder for tasks with no sessions yet
  status: text('status', { enum: ['todo', 'in_progress', 'done', 'delayed', 'cancelled'] })
    .notNull()
    .default('todo'),
  projectId: text('project_id'),
  isPriority: integer('is_priority', { mode: 'boolean' }).notNull().default(false),
  // Mirrors extension's todayIds membership (db.ts TaskOrderRow) as a simple
  // per-task flag rather than a per-workspace ordered list — mobile has no
  // workspace concept, and display order already comes from sortOrder.
  // Mutually exclusive with isPriority, same as the extension's
  // addToPriorities/addToTasks (App.tsx) always clearing the other list.
  isToday: integer('is_today', { mode: 'boolean' }).notNull().default(false),
  // JSON-serialized RecurrenceRule (@pomodoso/types), null = not recurring.
  // Mirrors extension's Task.recurrence exactly — see utils/recurrence.ts
  // for the ported occurrence-calculation logic.
  recurrence: text('recurrence'),
  // JSON-serialized string[] of YYYY-MM-DD occurrence dates already
  // completed — mirrors extension's Task.completedDates. Recurring tasks
  // never reach status 'done' permanently: completing today's occurrence
  // (useTasks.ts's completeRecurringOccurrence) records the date here and
  // resets status back to 'todo' so the next occurrence starts clean.
  completedDates: text('completed_dates').notNull().default('[]'),
  description: text('description'),
  // JSON-serialized TaskLink[] — mirrors extension's Task.links.
  links: text('links').notNull().default('[]'),
  // JSON-serialized NoteEntry[] — mirrors extension's Task.noteEntries.
  // Mobile never had a legacy singular `notes` string field to migrate away
  // from, so unlike the extension there's no notes-vs-noteEntries split.
  noteEntries: text('note_entries').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
  syncedAt: text('synced_at'),
});

// Single row (id always 'singleton'). Spec 6.1: "the last used mode is
// remembered... Starting a session is one click on the play button on any
// task. The mode used is the one currently selected on the toggle." — so any
// play button (Home's central Start, or a task row's play icon) starts a
// session in whatever mode is stored here, not a per-task choice.
export const timerPrefs = sqliteTable('timer_prefs', {
  id: text('id').primaryKey(),
  lastMode: text('last_mode', { enum: ['pomodoro', 'stopwatch'] }).notNull(),
});

// Generic key-value store, matching extension/src/db.ts's own `settings`
// table (SettingRow { key, value }) — same pattern, not a bespoke one.
// Values are JSON-stringified. Keys used: focus_seconds, short_break_seconds,
// long_break_seconds, long_break_every, daily_goal, max_priorities,
// week_start, work_days — see hooks/useSettings.ts for defaults.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
