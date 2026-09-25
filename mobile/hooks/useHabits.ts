import { eq, isNull, sql } from 'drizzle-orm';
import {
  CHALLENGE_BADGE_KIND,
  challengeAwardId,
  challengeDaysOf,
  challengeEarnsBadge,
  challengeKeepGoing,
  challengeProgress,
  challengeRecordCompletion,
  challengeStartOver,
  sameSchedule,
  habitStreakLabel,
} from '@pomodoso/types';
import type { ChallengeProgress, ChallengeState } from '@pomodoso/types';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect } from 'react';

import { db } from '@/db/client';
import { achievements, habitHistory, habits } from '@/db/schema';
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
  /** The challenge run and its progress, or null for a plain habit. */
  challenge: { state: ChallengeState; progress: ChallengeProgress } | null;
  weekFilled: boolean[]; // 7 entries, Monday..Sunday, current calendar week
}

/** The JSON string[] column, tolerant of anything that isn't one. */
function parseSkippedDays(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
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

    // A challenge is a run, not a view of the streak: it has a start date,
    // forgiven days and a recorded finish. The fallback start date covers the
    // moment before the effect below writes one — it is a default for this
    // render, never a substitute for storing it, because a stored date is what
    // stops the run restarting tomorrow.
    let challenge: HabitWithProgress['challenge'] = null;
    if (h.challengeLengthDays) {
      const state: ChallengeState = {
        lengthDays: h.challengeLengthDays,
        startedAt: h.challengeStartedAt ?? today,
        completedAt: h.challengeCompletedAt ?? null,
        skippedDays: parseSkippedDays(h.challengeSkippedDays),
      };
      const runDays = challengeDaysOf(
        state.startedAt,
        today,
        date => days.length === 0 || days.includes(toMondayFirstDow(new Date(date + 'T12:00:00'))),
        date => isDone(h.kind, h.goal, byDate.get(date)),
      );
      challenge = { state, progress: challengeProgress(state, runDays, today) };
    }

    return {
      ...h,
      days,
      count: todayRow?.count ?? 0,
      done: isDone(h.kind, h.goal, todayRow),
      scheduledToday: isScheduledToday(days),
      streakLabel: habitStreakLabel(pastStreak),
      daysDone,
      challenge,
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
    recordCompletionIfFinished(id);
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
    recordCompletionIfFinished(id);
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
    const previous = (habitRows ?? []).find(r => r.id === id);
    const nextDays = input.days.length === 7 ? [] : input.days;
    // The run survives an edit only while the challenge it belongs to is
    // untouched — same length, same schedule, still on. This is a partial
    // update, so without clearing them the run fields simply persist, and the
    // run would then be scored against a schedule it never ran under: widening
    // Mon–Fri to every day retroactively turns past weekends into missed days.
    // The reconciling effect above stamps the new run's start date.
    const keepsSameRun = Boolean(input.challengeLengthDays)
      && previous?.challengeLengthDays === input.challengeLengthDays
      && sameSchedule(parseDays(previous?.days ?? '[]'), nextDays);
    db.update(habits)
      .set({
        name: input.name.trim(),
        icon: input.icon,
        kind: input.kind,
        goal: input.goal,
        unit: input.unit,
        unitAmount: input.unitAmount,
        days: JSON.stringify(nextDays),
        challengeLengthDays: input.challengeLengthDays,
        ...(keepsSameRun ? {} : {
          challengeStartedAt: null,
          challengeCompletedAt: null,
          // The column is NOT NULL with '[]' as its default, so an empty run
          // is the empty list, not null — the same value keepAsHabit writes.
          challengeSkippedDays: '[]',
        }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(habits.id, id))
      .run();
    triggerSync();
  }

  // Habits are user-global (CLAUDE.md rule 6), so their order is too: one
  // sequence shared by every workspace and by "All". `orderedIds` is the full
  // list — callers that render a subset (Today shows only what's scheduled)
  // must re-slot it into the full order before calling, or the habits off
  // screen would be dropped from the ordering entirely.
  function reorderHabits(orderedIds: string[]): void {
    const current = new Map((habitRows ?? []).map(h => [h.id, h.sortOrder]));
    const now = new Date().toISOString();
    const changed = orderedIds.filter((id, index) => current.has(id) && current.get(id) !== index);
    if (changed.length === 0) return;
    db.transaction(tx => {
      orderedIds.forEach((id, index) => {
        if (current.get(id) === index) return;
        tx.update(habits).set({ sortOrder: index, updatedAt: now }).where(eq(habits.id, id)).run();
      });
    });
    triggerSync();
  }

  // A run can reach its length without any new toggle here — a backfilled
  // history, or logs pulled from another device, can already satisfy it. The
  // card would show "complete" while nothing was ever recorded, and "Go again"
  // would then reset the run and lose the medal it had actually earned.
  // Reconciling on read closes that: idempotent, because completedAt gates
  // re-entry and the award id is derived from the run.
  useEffect(() => {
    for (const habit of merged) {
      if (habit.challenge?.progress.complete && !habit.challenge.state.completedAt) {
        recordCompletionIfFinished(habit.id);
      }
    }
  }, [merged]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run needs its start date on disk, not merely defaulted at read time.
  //
  // The fallback above reads as a harmless default and is fatal without this:
  // nothing else writes the field for a challenge created here, so tomorrow it
  // resolves against the new today and the run starts over. The card sits on
  // "Day 1 of 21" forever. Only habits the migration backfilled ever had a
  // start date, which is why every run that got tested worked.
  useEffect(() => {
    // Reads the raw rows, not `merged`: the merged view has already had the
    // fallback applied, so it can no longer tell a stored date from a defaulted
    // one — which is precisely the distinction this is here to act on.
    for (const row of habitRows ?? []) {
      if (row.challengeLengthDays && row.challengeStartedAt == null) {
        db.update(habits)
          .set({ challengeStartedAt: today, updatedAt: new Date().toISOString() })
          .where(eq(habits.id, row.id))
          .run();
      }
    }
  }, [habitRows, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Challenge actions ──────────────────────────────────────────────────────
  function writeChallenge(id: string, next: ChallengeState): void {
    db.update(habits)
      .set({
        challengeStartedAt: next.startedAt,
        challengeCompletedAt: next.completedAt,
        challengeSkippedDays: JSON.stringify(next.skippedDays),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(habits.id, id))
      .run();
    triggerSync();
  }

  function keepChallengeGoing(id: string): void {
    const habit = merged.find(h => h.id === id);
    if (!habit?.challenge) return;
    writeChallenge(id, challengeKeepGoing(habit.challenge.state, habit.challenge.progress.missedDays));
  }

  function startChallengeOver(id: string): void {
    const habit = merged.find(h => h.id === id);
    if (!habit?.challenge) return;
    // The date is read now rather than taken from the render that drew the
    // button: a confirmation can sit open across midnight, and a replacement
    // run that starts yesterday has a missed day before you could have done it.
    writeChallenge(id, challengeStartOver(habit.challenge.state, todayStr()));
  }

  /** Drops the challenge framing; the habit carries on with its ordinary streak. */
  function keepChallengeAsHabit(id: string): void {
    db.update(habits)
      .set({
        challengeLengthDays: null,
        challengeStartedAt: null,
        challengeCompletedAt: null,
        challengeSkippedDays: '[]',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(habits.id, id))
      .run();
    triggerSync();
  }

  /**
   * Records a finish, and awards the medal when the run earned one.
   *
   * Reads the habit back out of SQLite rather than trusting `merged`: the
   * toggle that triggered this hasn't reached the live query yet, and that is
   * the very day that decides completion.
   */
  function recordCompletionIfFinished(id: string): void {
    const row = db.select().from(habits).where(eq(habits.id, id)).all()[0];
    if (!row?.challengeLengthDays || row.challengeCompletedAt) return;
    const day = todayStr();
    const state: ChallengeState = {
      lengthDays: row.challengeLengthDays,
      startedAt: row.challengeStartedAt ?? day,
      completedAt: null,
      skippedDays: parseSkippedDays(row.challengeSkippedDays),
    };
    const rows = db.select().from(habitHistory).where(eq(habitHistory.habitId, id)).all();
    const byDate = new Map(rows.map(r => [r.date, { count: r.count, done: r.done }]));
    const days = parseDays(row.days);
    const runDays = challengeDaysOf(
      state.startedAt,
      day,
      date => days.length === 0 || days.includes(toMondayFirstDow(new Date(date + 'T12:00:00'))),
      date => isDone(row.kind, row.goal, byDate.get(date)),
    );
    if (!challengeProgress(state, runDays, day).complete) return;

    // One transaction: the completion marker gates re-entry, so committing it
    // before the award means an interrupted or failed insert leaves the run
    // permanently medal-less — every later attempt returns early because
    // challengeCompletedAt is already set.
    const stamp = new Date().toISOString();
    const next = challengeRecordCompletion(state, day);
    const earnsBadge = challengeEarnsBadge(state);
    db.transaction(tx => {
      tx.update(habits)
        .set({
          challengeStartedAt: next.startedAt,
          challengeCompletedAt: next.completedAt,
          challengeSkippedDays: JSON.stringify(next.skippedDays),
          updatedAt: stamp,
        })
        .where(eq(habits.id, id))
        .run();
      // Append-only: "Go again" clears the run's completion so the habit can
      // start another, which would quietly decrement a badge already earned.
      if (!earnsBadge) return;
      tx.insert(achievements)
        // Derived from the run, not random: this is read-then-write, so two
        // quick taps — or two devices finishing the same run — would otherwise
        // mint two medals for one challenge. A stable id makes the second a
        // no-op.
        .values({
          id: challengeAwardId(id, state.startedAt),
          kind: CHALLENGE_BADGE_KIND,
          earnedOn: day,
          habitId: id,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .onConflictDoNothing()
        .run();
    });
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

  return {
    habits: merged, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit, reorderHabits,
    keepChallengeGoing, startChallengeOver, keepChallengeAsHabit,
  };
}
