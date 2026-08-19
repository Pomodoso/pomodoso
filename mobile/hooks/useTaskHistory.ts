import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useState } from 'react';

import { db } from '@/db/client';
import type { TaskStatus } from '@/db/schema';
import { pomodoroSession, task } from '@/db/schema';
import { isResolvedStatus } from '@/constants/taskStatus';
import { secondsBetween } from '@/utils/time';

// Ports extension's TaskHistoryView (HomeState.tsx) — day-grouped work
// history reached from the Tasks tab. Deliberate simplifications for
// mobile's simpler model: no projects/meetings (don't exist yet), no
// per-workspace weekStart setting (hardcoded Monday), no custom date range
// (just This week / this month, the two extension defaults) — these can
// follow later if actually needed, not built ahead of a real use case.

export type HistoryRange = 'week' | 'month';

export interface HistoryTaskRow {
  id: string;
  title: string;
  ticketRef: string | null;
  status: TaskStatus;
  projectId: string | null;
}

export interface HistoryDay {
  date: string; // YYYY-MM-DD
  label: string;
  totalMinutes: number;
  tasks: HistoryTaskRow[];
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString('en-CA');
}

// Extension: weekStartDate — most recent occurrence of the configured
// week-start weekday. Mobile has no per-workspace setting for this yet, so
// Monday is hardcoded (day 0 in extension's 0=Mon..6=Sun convention).
function mostRecentMonday(): string {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // JS getDay is 0=Sun..6=Sat; shift to 0=Mon..6=Sun
  return daysAgo(dow);
}

function formatDayLabel(dateStr: string): string {
  if (dateStr === todayStr()) return 'Today';
  if (dateStr === daysAgo(1)) return 'Yesterday';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function useTaskHistory() {
  const [range, setRange] = useState<HistoryRange>('week');
  const { data: tasks } = useLiveQuery(db.select().from(task));
  const { data: sessions } = useLiveQuery(db.select().from(pomodoroSession));

  // Only completed/interrupted focus sessions represent real logged time —
  // breaks and never-ended sessions don't belong in a work-history view.
  const loggedFor = (taskId: string) =>
    (sessions ?? []).filter(
      s => s.taskId === taskId && s.kind === 'focus' && (s.status === 'completed' || s.status === 'interrupted') && s.endedAt,
    );

  // Same inclusion rule as the extension: a resolved (done/cancelled) task
  // always shows, even with zero logged time; anything else only shows if
  // it actually has logged time (a still-open task you worked on is history
  // too, not just finished ones).
  const historyTasks = (tasks ?? []).filter(t => isResolvedStatus(t.status) || loggedFor(t.id).length > 0);

  const dayGroups = new Map<string, HistoryTaskRow[]>();
  const minutesByTaskAndDay = new Map<string, number>(); // `${taskId}:${date}` -> minutes

  for (const t of historyTasks) {
    const logs = loggedFor(t.id);
    // Bucketed under the day of its MOST RECENT session — matches the
    // extension exactly, including its quirk: if a task was also worked on
    // earlier days, those earlier days' minutes for THIS task don't count
    // toward those earlier days' totals (only toward the bucketed day).
    // Replicated as-is for parity rather than "fixed", since the goal here
    // is matching the extension's actual behavior.
    const effectiveDate =
      logs.length > 0
        ? new Date(logs.reduce((max, s) => (s.startedAt > max ? s.startedAt : max), '')).toLocaleDateString('en-CA')
        : new Date(t.updatedAt).toLocaleDateString('en-CA');

    const minutesOnDay = Math.floor(
      logs
        .filter(s => new Date(s.startedAt).toLocaleDateString('en-CA') === effectiveDate)
        .reduce((sum, s) => sum + secondsBetween(s.startedAt, s.endedAt!), 0) / 60,
    );
    minutesByTaskAndDay.set(`${t.id}:${effectiveDate}`, minutesOnDay);

    const bucket = dayGroups.get(effectiveDate) ?? [];
    bucket.push({ id: t.id, title: t.title, ticketRef: t.ticketRef, status: t.status, projectId: t.projectId });
    dayGroups.set(effectiveDate, bucket);
  }

  const allDays: HistoryDay[] = Array.from(dayGroups.entries())
    .map(([date, dayTasks]) => ({
      date,
      label: formatDayLabel(date),
      totalMinutes: dayTasks.reduce((sum, t) => sum + (minutesByTaskAndDay.get(`${t.id}:${date}`) ?? 0), 0),
      tasks: dayTasks,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const cutoff = range === 'week' ? mostRecentMonday() : daysAgo(30);
  const days = allDays.filter(d => d.date >= cutoff);

  const hasAny = allDays.length > 0;
  const hasFiltered = days.length > 0;
  const grandTotalMinutes = days.reduce((sum, d) => sum + d.totalMinutes, 0);

  return { range, setRange, days, hasAny, hasFiltered, grandTotalMinutes };
}
