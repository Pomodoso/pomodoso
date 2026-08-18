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
