import { eq, isNull, sql } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { habitHistory, habits } from '@/db/schema';
import { isScheduledToday, parseDays, toMondayFirstDow } from '@/constants/habitDays';
import { habitLogId, uid } from '@/utils/id';
import { triggerSync } from '@/utils/sync';
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
  challengeLengthDays: number | null;
  sortOrder: number;
  count: number;
  done: boolean;
  scheduledToday: boolean;
  streakLabel: string;
  // Days completed toward challengeLengthDays, counting today once it's
  // done — see computeStreak's doc comment for why this differs from the
  // "past streak" the flame streakLabel shows.
  daysDone: number;
  weekFilled: boolean[]; // 7 entries, Monday..Sunday, current calendar week
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

// pastStreak = consecutive scheduled days completed up to (not including)
// today — the flame streakLabel's semantics, so a habit isn't "missed" the
// moment midnight hits before today's been done yet. daysDone adds today
// back in once it's actually done, so a 21-day challenge card ticks up the
// moment today is completed instead of waiting until tomorrow.
function computeStreak(
  kind: 'boolean' | 'counter',
  goal: number | null,
  days: number[],
  historyByDate: Map<string, { count: number; done: boolean }>,
): { pastStreak: number; daysDone: number } {
  const today = dateOffset(0);
  const scheduledToday = days.length === 0 || days.includes(today.dow);
  const doneToday = scheduledToday && isDone(kind, goal, historyByDate.get(today.date));

  // 3650 days (10 years), not 365 — a challenge longer than a year is
  // unusual but not implausible, and this is a handful of cheap Map lookups
  // either way, not worth capping tighter (mirrors extension's
  // computeHabitStreak, which hit the same off-by-a-year cap in review).
  let pastStreak = 0;
  for (let i = 1; i < 3650; i++) {
    const { date, dow } = dateOffset(i);
    // Not scheduled that day — skip without breaking the streak, matching
    // the extension's "every day" default semantics of [] and the general
    // expectation that a Mon/Wed/Fri habit isn't "missed" on a Tuesday.
    if (days.length > 0 && !days.includes(dow)) continue;
    if (isDone(kind, goal, historyByDate.get(date))) {
      pastStreak++;
    } else {
      break;
    }
  }
  return { pastStreak, daysDone: pastStreak + (doneToday ? 1 : 0) };
}

function formatStreakLabel(pastStreak: number): string {
  return pastStreak > 0 ? `🔥 ${pastStreak} day streak` : 'No streak yet';
}

function weekFilled(
  kind: 'boolean' | 'counter',
  goal: number | null,
  historyByDate: Map<string, { count: number; done: boolean }>,
): boolean[] {
  const { dow: todayDow } = dateOffset(0);
  const result: boolean[] = [];
  for (let dow = 0; dow < 7; dow++) {
    // A day later in the week than today hasn't happened yet — show
    // unfilled rather than looking up a future date's (nonexistent) row.
    if (dow > todayDow) {
      result.push(false);
      continue;
    }
    const { date } = dateOffset(todayDow - dow);
    result.push(isDone(kind, goal, historyByDate.get(date)));
  }
  return result;
}

export interface HabitInput {
  name: string;
  icon: string;
  kind: 'boolean' | 'counter';
  goal: number | null;
  unit: string | null;
  unitAmount: number | null;
  days: number[];
  challengeLengthDays: number | null;
}

export function useHabits() {
  const today = useTodayDate();

  const { data: habitRows } = useLiveQuery(
    db.select().from(habits).where(isNull(habits.deletedAt)).orderBy(habits.sortOrder),
  );
  const { data: historyRows } = useLiveQuery(db.select().from(habitHistory).where(isNull(habitHistory.deletedAt)));

  const rowsByHabit = new Map<string, Map<string, { count: number; done: boolean }>>();
  for (const row of historyRows ?? []) {
    if (!rowsByHabit.has(row.habitId)) rowsByHabit.set(row.habitId, new Map());
    rowsByHabit.get(row.habitId)!.set(row.date, { count: row.count, done: row.done });
  }

  const merged: HabitWithProgress[] = (habitRows ?? []).map(h => {
    const byDate = rowsByHabit.get(h.id) ?? new Map();
    const todayRow = byDate.get(today);
    const days = parseDays(h.days);
    const { pastStreak, daysDone } = computeStreak(h.kind, h.goal, days, byDate);
    return {
      ...h,
      days,
      count: todayRow?.count ?? 0,
      done: isDone(h.kind, h.goal, todayRow),
      scheduledToday: isScheduledToday(days),
      streakLabel: formatStreakLabel(pastStreak),
      daysDone,
      weekFilled: weekFilled(h.kind, h.goal, byDate),
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
    const now = new Date().toISOString();
    db.insert(habitHistory)
      .values({ id: habitLogId(id, day), habitId: id, date: day, count: 0, done: true, updatedAt: now })
      .onConflictDoUpdate({
        target: habitHistory.id,
        set: { done: sql`NOT ${habitHistory.done}`, updatedAt: now },
      })
      .run();
    triggerSync();
  }

  function incrementHabit(id: string, delta: number): void {
    // No upper clamp — going over goal is fine (13 glasses when the target is
    // 12 still means the habit is done), only floor at 0. `done` isn't
    // written here: for counter habits it's derived from count/goal (isDone
    // above), not stored.
    const day = todayStr();
    const now = new Date().toISOString();
    db.insert(habitHistory)
      .values({ id: habitLogId(id, day), habitId: id, date: day, count: Math.max(0, delta), done: false, updatedAt: now })
      .onConflictDoUpdate({
        target: habitHistory.id,
        set: { count: sql`max(0, ${habitHistory.count} + ${delta})`, updatedAt: now },
      })
      .run();
    triggerSync();
  }

  function addHabit(input: HabitInput): void {
    const maxSortOrder = (habitRows ?? []).reduce((max, h) => Math.max(max, h.sortOrder), -1);
    const now = new Date().toISOString();
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
        challengeLengthDays: input.challengeLengthDays,
        sortOrder: maxSortOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    triggerSync();
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
        challengeLengthDays: input.challengeLengthDays,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(habits.id, id))
      .run();
    triggerSync();
  }

  function removeHabit(id: string): void {
    // Soft delete (CLAUDE.md rule 4), wrapped in a transaction so both
    // tombstones commit together — an interruption between them would
    // otherwise leave habit_history gone-looking but the habit itself still
    // present, or vice versa.
    const now = new Date().toISOString();
    db.transaction(tx => {
      tx.update(habitHistory).set({ deletedAt: now, updatedAt: now }).where(eq(habitHistory.habitId, id)).run();
      tx.update(habits).set({ deletedAt: now, updatedAt: now }).where(eq(habits.id, id)).run();
    });
    triggerSync();
  }

  return { habits: merged, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit };
}
