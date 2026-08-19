import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Spike schema to validate the expo-sqlite + drizzle-orm combo (M0 backlog item
// in docs/mobile-app-plan.md). Mirrors the real shape from
// extension/src/db.ts's HabitRow/HabitHistoryRow split — habit *definition*
// (kind, goal, unit) separate from per-day *progress* (count/done), since
// "done" resets daily and isn't a property of the habit itself. Still a spike,
// not the real shared data model — that comes with the shared/core extraction.
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
});

export const habitHistory = sqliteTable('habit_history', {
  id: text('id').primaryKey(),
  habitId: text('habit_id').notNull(),
  date: text('date').notNull(), // YYYY-MM-DD, local
  count: integer('count').notNull().default(0),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
});

// Mirrors the shape of the real spec's pomodoro_session entity (section 6.1)
// closely enough for a device-local mobile spike: one row per session,
// "active" is just the row with status active/paused. taskId is nullable —
// spec 6.1 says task association is mandatory, relaxed here since a session
// can be "unassigned time" (documented deviation, see useTimer.ts).
export const pomodoroSession = sqliteTable('pomodoro_session', {
  id: text('id').primaryKey(),
  mode: text('mode', { enum: ['pomodoro', 'stopwatch'] }).notNull(),
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
});

export type ProjectRow = typeof project.$inferSelect;

// Status set matches extension/src/db.ts's TaskStatus exactly, so the
// mobile status picker mirrors the extension's semantics/UX (see
// STATUS_OPTIONS/STATUS_DOT_COLOR in extension/src/popup/HomeState.tsx).
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed' | 'cancelled';

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
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
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
