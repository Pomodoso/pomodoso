import { eq } from 'drizzle-orm';
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
  return new Date().toISOString().slice(0, 10);
}

function dateOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
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

  function upsertToday(habitId: string, patch: { count?: number; done?: boolean }): void {
    const existingRow = (historyRows ?? []).find(r => r.habitId === habitId && r.date === today);
    if (existingRow) {
      db.update(habitHistory).set(patch).where(eq(habitHistory.id, existingRow.id)).run();
    } else {
      db.insert(habitHistory)
        .values({ id: `${habitId}-${today}`, habitId, date: today, count: patch.count ?? 0, done: patch.done ?? false })
        .run();
    }
  }

  function toggleHabit(id: string, done: boolean): void {
    upsertToday(id, { done });
  }

  function incrementHabit(id: string, delta: number): void {
    const habit = (habitRows ?? []).find(h => h.id === id);
    const current = rowsByHabit.get(id)?.get(today)?.count ?? 0;
    const goal = habit?.goal ?? Infinity;
    // No upper clamp — going over goal is fine (13 glasses when the target is
    // 12 still means the habit is done), only floor at 0.
    const next = Math.max(0, current + delta);
    upsertToday(id, { count: next, done: next >= goal });
  }

  return { habits: merged, toggleHabit, incrementHabit };
}
