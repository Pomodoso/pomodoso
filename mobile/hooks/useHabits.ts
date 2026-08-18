import { sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { habitHistory, habits } from '@/db/schema';

export interface HabitWithProgress {
  id: string;
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  goal: number | null;
  unit: string | null;
  unitAmount: number | null;
  sortOrder: number;
  count: number;
  done: boolean;
  streakLabel: string;
}

function todayStr(): string {
  // Local calendar date, not UTC — habit_history.date is a local date, and a
  // UTC-based key rolls the day over at the wrong local time.
  return new Date().toLocaleDateString('en-CA');
}

function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toLocaleDateString('en-CA');
}

function isDone(kind: 'boolean' | 'counter', goal: number | null, row: { count: number; done: boolean } | undefined): boolean {
  if (!row) return false;
  return kind === 'counter' ? row.count >= (goal ?? 0) : row.done;
}

function streakLabel(
  kind: 'boolean' | 'counter',
  goal: number | null,
  historyByDate: Map<string, { count: number; done: boolean }>,
): string {
  let streak = 0;
  for (let i = 1; i < 365; i++) {
    if (isDone(kind, goal, historyByDate.get(dateOffset(i)))) {
      streak++;
    } else {
      break;
    }
  }
  return streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet';
}

export function useHabits() {
  const today = todayStr();
  const { data: habitRows } = useLiveQuery(db.select().from(habits).orderBy(habits.sortOrder));
  const { data: historyRows } = useLiveQuery(db.select().from(habitHistory));

  const rowsByHabit = new Map<string, Map<string, { count: number; done: boolean }>>();
  for (const row of historyRows ?? []) {
    if (!rowsByHabit.has(row.habitId)) rowsByHabit.set(row.habitId, new Map());
    rowsByHabit.get(row.habitId)!.set(row.date, { count: row.count, done: row.done });
  }

  const merged: HabitWithProgress[] = (habitRows ?? []).map(h => {
    const byDate = rowsByHabit.get(h.id) ?? new Map();
    const todayRow = byDate.get(today);
    return {
      ...h,
      count: todayRow?.count ?? 0,
      done: isDone(h.kind, h.goal, todayRow),
      streakLabel: streakLabel(h.kind, h.goal, byDate),
    };
  });

  // Both mutations below are a single atomic INSERT ... ON CONFLICT DO UPDATE
  // that reads/writes in the same SQLite statement, rather than a JS
  // read-then-write — otherwise two rapid taps racing on the same render-time
  // snapshot either drop an increment or double-insert the first row.

  function toggleHabit(id: string): void {
    db.insert(habitHistory)
      .values({ id: `${id}-${today}`, habitId: id, date: today, count: 0, done: true })
      .onConflictDoUpdate({
        target: habitHistory.id,
        set: { done: sql`NOT ${habitHistory.done}` },
      })
      .run();
  }

  function incrementHabit(id: string, delta: number): void {
    // No upper clamp — going over goal is fine (13 glasses when the target is
    // 12 still means the habit is done), only floor at 0. `done` isn't
    // written here: for counter habits it's derived from count/goal (isDone
    // above), not stored.
    db.insert(habitHistory)
      .values({ id: `${id}-${today}`, habitId: id, date: today, count: Math.max(0, delta), done: false })
      .onConflictDoUpdate({
        target: habitHistory.id,
        set: { count: sql`max(0, ${habitHistory.count} + ${delta})` },
      })
      .run();
  }

  return { habits: merged, toggleHabit, incrementHabit };
}
