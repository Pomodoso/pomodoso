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
// "active" is just the row with status active/paused. No task table yet —
// taskTitle is a plain label captured from whatever was tapped to start the
// session, not a real foreign key (that comes with the shared/core
// extraction and a real Task model).
export const pomodoroSession = sqliteTable('pomodoro_session', {
  id: text('id').primaryKey(),
  mode: text('mode', { enum: ['pomodoro', 'stopwatch'] }).notNull(),
  kind: text('kind', { enum: ['focus', 'short_break', 'long_break'] }).notNull(),
  taskTitle: text('task_title'),
  ticketRef: text('ticket_ref'),
  plannedDurationSeconds: integer('planned_duration_seconds'), // null for stopwatch
  // startedAt is shifted forward by the paused duration on every resume, so
  // "elapsed" is always just (now - startedAt) while active — no separate
  // accumulator to keep in sync.
  startedAt: text('started_at').notNull(),
  pausedAt: text('paused_at'),
  endedAt: text('ended_at'),
  status: text('status', { enum: ['active', 'paused', 'completed', 'interrupted'] }).notNull(),
  notificationId: text('notification_id'),
});

// Spike task model — id/title/ticketRef/done/isPriority is enough to back
// Home's "Today's priorities" and the Tasks tab. No project/workspace yet
// (comes with the shared/core extraction and a real multi-entity model).
// pomodoroSession still stores a plain taskTitle/ticketRef text snapshot
// rather than a taskId FK — keeps this PR from also having to migrate the
// timer schema; revisit once real task-level time aggregation is needed.
export const task = sqliteTable('task', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  ticketRef: text('ticket_ref'),
  meta: text('meta'), // display-only placeholder ("1h 20m", "Not started") until real time aggregation exists
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  isPriority: integer('is_priority', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
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
