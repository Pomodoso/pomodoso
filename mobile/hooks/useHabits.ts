import { eq, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { habitHistory, habits } from '@/db/schema';
import { isScheduledToday, parseDays, toMondayFirstDow } from '@/constants/habitDays';
import { useTodayDate } from './useTodayDate';

export interface HabitWithProgress {
  id: string;
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  goal: number | null;
  unit: string | null;
  unitAmount: number | null;
  days: number[];
  sortOrder: number;
  count: number;
  done: boolean;
  scheduledToday: boolean;
  streakLabel: string;
}

function todayStr(): string {
  // Local calendar date, not UTC — habit_history.date is a local date, and a
  // UTC-based key rolls the day over at the wrong local time.
  return new Date().toLocaleDateString('en-CA');
}

function dateOffset(daysAgo: number): { date: string; dow: number } {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return { date: d.toLocaleDateString('en-CA'), dow: toMondayFirstDow(d) };
}

function isDone(kind: 'boolean' | 'counter', goal: number | null, row: { count: number; done: boolean } | undefined): boolean {
  if (!row) return false;
  return kind === 'counter' ? row.count >= (goal ?? 0) : row.done;
}

function streakLabel(
  kind: 'boolean' | 'counter',
  goal: number | null,
  days: number[],
  historyByDate: Map<string, { count: number; done: boolean }>,
): string {
  let streak = 0;
  for (let i = 1; i < 365; i++) {
    const { date, dow } = dateOffset(i);
    // Not scheduled that day — skip without breaking the streak, matching
    // the extension's "every day" default semantics of [] and the general
    // expectation that a Mon/Wed/Fri habit isn't "missed" on a Tuesday.
    if (days.length > 0 && !days.includes(dow)) continue;
    if (isDone(kind, goal, historyByDate.get(date))) {
      streak++;
    } else {
      break;
    }
  }
  return streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet';
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface HabitInput {
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  goal: number | null;
  unit: string | null;
  unitAmount: number | null;
  days: number[];
}

export function useHabits() {
  const today = useTodayDate();

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
    const days = parseDays(h.days);
    return {
      ...h,
      days,
      count: todayRow?.count ?? 0,
      done: isDone(h.kind, h.goal, todayRow),
      scheduledToday: isScheduledToday(days),
      streakLabel: streakLabel(h.kind, h.goal, days, byDate),
    };
  });

  // Both mutations below are a single atomic INSERT ... ON CONFLICT DO UPDATE
  // that reads/writes in the same SQLite statement, rather than a JS
  // read-then-write — otherwise two rapid taps racing on the same render-time
  // snapshot either drop an increment or double-insert the first row.

  function toggleHabit(id: string): void {
    // Recompute today's date here rather than closing over the render-time
    // `today` — a screen left open across local midnight would otherwise
    // keep writing to yesterday's row.
    const day = todayStr();
    db.insert(habitHistory)
      .values({ id: `${id}-${day}`, habitId: id, date: day, count: 0, done: true })
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
    const day = todayStr();
    db.insert(habitHistory)
      .values({ id: `${id}-${day}`, habitId: id, date: day, count: Math.max(0, delta), done: false })
      .onConflictDoUpdate({
        target: habitHistory.id,
        set: { count: sql`max(0, ${habitHistory.count} + ${delta})` },
      })
      .run();
  }

  function addHabit(input: HabitInput): void {
    const maxSortOrder = (habitRows ?? []).reduce((max, h) => Math.max(max, h.sortOrder), -1);
    db.insert(habits)
      .values({
        id: uid(),
        name: input.name.trim(),
        icon: input.icon,
        kind: input.kind,
        goal: input.goal,
        unit: input.unit,
        unitAmount: input.unitAmount,
        days: JSON.stringify(input.days.length === 7 ? [] : input.days),
        sortOrder: maxSortOrder + 1,
      })
      .run();
  }

  function updateHabit(id: string, input: HabitInput): void {
    db.update(habits)
      .set({
        name: input.name.trim(),
        icon: input.icon,
        kind: input.kind,
        goal: input.goal,
        unit: input.unit,
        unitAmount: input.unitAmount,
        days: JSON.stringify(input.days.length === 7 ? [] : input.days),
      })
      .where(eq(habits.id, id))
      .run();
  }

  function removeHabit(id: string): void {
    // Cascade — an orphaned habit_history row is harmless on its own (no
    // atomic-guard invariant like pomodoro_session's), but there's no reason
    // to keep it around once the habit it belongs to is gone.
    db.delete(habitHistory).where(eq(habitHistory.habitId, id)).run();
    db.delete(habits).where(eq(habits.id, id)).run();
  }

  return { habits: merged, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit };
}
