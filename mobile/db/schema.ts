import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Spike schema to validate the expo-sqlite + drizzle-orm combo (M0 backlog item
// in docs/mobile-app-plan.md). Only covers what the Habits screen needs today —
// this is not the real shared data model, that comes with the shared/core
// extraction from extension/src/db.ts.
export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  streakLabel: text('streak_label').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull(),
  sortOrder: integer('sort_order').notNull(),
});
