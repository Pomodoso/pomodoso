import type { RecurrenceRule } from '@pomodoso/types';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect } from 'react';

import { isResolvedStatus, isUpdatedToday } from '@/constants/taskStatus';
import { db } from '@/db/client';
import { pomodoroSession, task } from '@/db/schema';
import type { TaskStatus } from '@/db/schema';
import { cancelScheduledNotification } from '@/notifications';
import { activeOccurrence } from '@/utils/recurrence';
import { secondsBetween } from '@/utils/time';

import { useTodayDate } from './useTodayDate';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function parseRecurrence(raw: string | null): RecurrenceRule | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RecurrenceRule;
  } catch {
    return null;
  }
}

function parseCompletedDates(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useTasks() {
  const today = useTodayDate();
  const { data: tasks } = useLiveQuery(db.select().from(task).orderBy(asc(task.sortOrder)));
  const { data: sessions } = useLiveQuery(db.select().from(pomodoroSession));

  // Mirrors extension's "Add recurring tasks to Today" effect (App.tsx) —
  // runs whenever tasks/today change, materializing each recurring task's
  // active occurrence (if any, and not already completed for that
  // occurrence) into Today. Never touches isPriority — auto-materialization
  // only ever adds to Today, matching the extension exactly. Idempotent:
  // each pass skips tasks already isToday/isPriority, so it converges
  // immediately rather than looping.
  useEffect(() => {
    for (const t of tasks ?? []) {
      if (!t.recurrence || t.isToday || t.isPriority) continue;
      const rule = parseRecurrence(t.recurrence);
      if (!rule) continue;
      const occ = activeOccurrence(rule, today);
      if (!occ) continue;
      if (parseCompletedDates(t.completedDates).includes(occ)) continue;
      db.update(task).set({ isToday: true }).where(eq(task.id, t.id)).run();
    }
  }, [tasks, today]);

  // Real time-per-task, computed from completed sessions — falls back to the
  // task's stored `meta` placeholder ("Not started") for tasks with no
  // session history yet.
  const statsByTask = new Map<string, { pomos: number; seconds: number }>();
  for (const s of sessions ?? []) {
    // Breaks are carried-over from a task's focus session (see
    // useTimer.ts's startFollowUpSession) purely for display continuity —
    // spec 6.1: "Breaks are not logged in reports", so they're excluded here
    // even though they technically have a taskId.
    if (!s.taskId || !s.endedAt || s.kind !== 'focus') continue;
    // 'interrupted' counts toward seconds too — a stopwatch session always
    // ends this way (no natural deadline to reconcile), and a focus session
    // stopped early still logged real time (spec 6.1: "marked interrupted
    // with actual accumulated time"). Only a whole completed pomodoro counts
    // toward the pomo tally below.
    if (s.status !== 'completed' && s.status !== 'interrupted') continue;
    const entry = statsByTask.get(s.taskId) ?? { pomos: 0, seconds: 0 };
    entry.seconds += secondsBetween(s.startedAt, s.endedAt);
    if (s.mode === 'pomodoro' && s.status === 'completed') entry.pomos += 1;
    statsByTask.set(s.taskId, entry);
  }

  // Adds parsed convenience fields alongside the raw recurrence/completedDates
  // columns (still present via the spread) — consumers that need the raw
  // JSON (e.g. writing it back unchanged) still can, without re-parsing.
  const withMeta = (tasks ?? []).map(t => {
    const stats = statsByTask.get(t.id);
    const recurrenceRule = parseRecurrence(t.recurrence);
    const completedOccurrences = parseCompletedDates(t.completedDates);
    if (!stats) return { ...t, recurrenceRule, completedOccurrences };
    const time = formatDuration(stats.seconds);
    const meta = stats.pomos > 0 ? `${stats.pomos} pomo${stats.pomos === 1 ? '' : 's'} · ${time}` : time;
    return { ...t, meta, recurrenceRule, completedOccurrences };
  });

  function addTask(title: string, projectId: string | null = null): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const maxSortOrder = (tasks ?? []).reduce((max, t) => Math.max(max, t.sortOrder), -1);
    const now = new Date().toISOString();
    db.insert(task)
      .values({
        id: uid(),
        title: trimmed,
        ticketRef: null,
        meta: 'Not started',
        status: 'todo',
        projectId,
        isPriority: false,
        isToday: false,
        sortOrder: maxSortOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // Mirrors extension's updateTask intercept (App.tsx), extended to cover
  // 'cancelled' too (extension only special-cases 'done', but its own
  // recurring tasks never reach 'cancelled' via that path either — its
  // separate daily cleanup effect, which mobile doesn't replicate, is what
  // actually keeps a cancelled recurring task from getting stuck there). A
  // recurring task never reaches a resolved status permanently: resolving
  // today's occurrence (done OR cancelled) records it in completedDates and
  // resets status/isToday/isPriority to a clean slate — otherwise isToday
  // stays true forever and the materialization effect (which skips any task
  // already isToday) would never re-evaluate it for its next occurrence.
  function setTaskStatus(id: string, status: TaskStatus): void {
    const current = (tasks ?? []).find(t => t.id === id);
    if ((status === 'done' || status === 'cancelled') && current?.recurrence) {
      resolveRecurringOccurrence(id);
      return;
    }
    db.update(task).set({ status, updatedAt: new Date().toISOString() }).where(eq(task.id, id)).run();
  }

  function resolveRecurringOccurrence(id: string): void {
    const current = (tasks ?? []).find(t => t.id === id);
    const rule = current ? parseRecurrence(current.recurrence) : null;
    if (!current || !rule) return;
    // Record the occurrence being resolved, not the calendar day — a
    // carry-over task may be resolved on a later day than its (missed)
    // occurrence date; activeOccurrence resolves which one that was.
    const occ = activeOccurrence(rule, today) ?? today;
    const completed = new Set(parseCompletedDates(current.completedDates));
    completed.add(occ);
    db.update(task)
      .set({
        status: 'todo',
        isPriority: false,
        isToday: false,
        completedDates: JSON.stringify([...completed]),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(task.id, id))
      .run();
  }

  // Resets completedDates whenever the rule changes (including clearing
  // it) — but ONLY when the rule actually changes: those dates are tied to
  // the schedule that produced them, so an edited or newly (re)created rule
  // could otherwise land a real occurrence on a date the OLD schedule
  // happened to have completed, silently suppressing it from Today. But
  // wiping unconditionally on every save (even a no-op re-save of the same
  // rule) would make a completed carry-over occurrence reappear, forcing
  // the user to resolve it again — so only clear when the stored JSON
  // actually differs.
  function setRecurrence(id: string, rule: RecurrenceRule | null): void {
    const current = (tasks ?? []).find(t => t.id === id);
    const nextRecurrence = rule ? JSON.stringify(rule) : null;
    const ruleChanged = (current?.recurrence ?? null) !== nextRecurrence;
    db.update(task)
      .set({
        recurrence: nextRecurrence,
        ...(ruleChanged && { completedDates: '[]' }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(task.id, id))
      .run();
  }

  function updateTask(id: string, updates: { title?: string; projectId?: string | null }): void {
    db.update(task)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(task.id, id))
      .run();
  }

  // Priority/Today membership mirrors extension's separate taskOrders table
  // (priorityIds/todayIds) — mutually exclusive, and deliberately NOT
  // touching updatedAt: that field also drives useTaskHistory's fallback
  // grouping date for sessionless tasks, and bumping it here (tried and
  // reverted — see PR #37 review) would silently move a resolved task into
  // today's History group and leave it stuck there even after the flag is
  // removed. Instead, adding a resolved task to Priority/Today is simply
  // blocked — matches the extension, where that action (BacklogRow's
  // onAddToPriorities/onAddToTasks) only ever exists for backlog (non-
  // resolved) tasks in the first place. task/[id].tsx disables both rows
  // when the task is resolved so this UI-unreachable in normal flow.

  // Returns false (no-op) if adding would exceed maxPriorities, or if the
  // task is resolved — caller decides how to surface that.
  function togglePriority(id: string, maxPriorities: number): boolean {
    const current = (tasks ?? []).find(t => t.id === id);
    if (!current) return false;
    if (current.isPriority) {
      db.update(task).set({ isPriority: false }).where(eq(task.id, id)).run();
      return true;
    }
    if (isResolvedStatus(current.status)) return false;
    const priorityCount = (tasks ?? []).filter(
      t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)),
    ).length;
    if (priorityCount >= maxPriorities) return false;
    db.update(task).set({ isPriority: true, isToday: false }).where(eq(task.id, id)).run();
    return true;
  }

  // Returns false (no-op) if the task is resolved (see togglePriority).
  function toggleToday(id: string): boolean {
    const current = (tasks ?? []).find(t => t.id === id);
    if (!current) return false;
    if (current.isToday) {
      db.update(task).set({ isToday: false }).where(eq(task.id, id)).run();
      return true;
    }
    if (isResolvedStatus(current.status)) return false;
    db.update(task).set({ isToday: true, isPriority: false }).where(eq(task.id, id)).run();
    return true;
  }

  async function cancelLiveSessionNotifications(id: string): Promise<void> {
    const live = db
      .select()
      .from(pomodoroSession)
      .where(and(eq(pomodoroSession.taskId, id), inArray(pomodoroSession.status, ['active', 'paused'])))
      .all();
    for (const s of live) {
      if (!s.notificationId) continue;
      const cancelled = await cancelScheduledNotification(s.notificationId);
      if (!cancelled) {
        console.warn('Orphaned notification from a deleted task could not be cancelled:', s.notificationId);
      }
    }
  }

  async function removeTask(id: string): Promise<void> {
    // Queries fresh (not the render-time `sessions` snapshot) right before
    // the cascade below, so a session started for this task in between the
    // Delete tap and this call landing is still caught. Closing the actual
    // race window is on the caller: this must be awaited before navigating
    // away, or the UI would let the user reach a play button for a task
    // that's about to disappear while this is still in flight.
    await cancelLiveSessionNotifications(id);
    // Cascade so nothing is left pointing at a task that no longer exists.
    // Matters beyond tidiness: an orphaned row stuck at status
    // active/paused would permanently block every future session start —
    // startSession's atomic guard checks for ANY row in that state,
    // regardless of whether its task still exists.
    db.delete(pomodoroSession).where(eq(pomodoroSession.taskId, id)).run();
    db.delete(task).where(eq(task.id, id)).run();
  }

  return { tasks: withMeta, addTask, setTaskStatus, updateTask, togglePriority, toggleToday, setRecurrence, removeTask };
}
