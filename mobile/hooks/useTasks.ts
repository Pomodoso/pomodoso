import type { RecurrenceRule } from '@pomodoso/types';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect } from 'react';

import { isResolvedStatus, isUpdatedToday } from '@/constants/taskStatus';
import { db } from '@/db/client';
import { pomodoroSession, task } from '@/db/schema';
import type { NoteEntry, TaskLink, TaskStatus } from '@/db/schema';
import { cancelScheduledNotification } from '@/notifications';
import { uid } from '@/utils/id';
import { activeOccurrence } from '@/utils/recurrence';
import { playSound } from '@/utils/sounds';
import { markTaskOrderDirty, triggerSync } from '@/utils/sync';
import { creditedStart, secondsBetween } from '@/utils/time';

import { useSettings } from './useSettings';
import { useTodayDate } from './useTodayDate';
import { useWorkspace } from './useWorkspace';

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

function parseLinks(raw: string): TaskLink[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNoteEntries(raw: string): NoteEntry[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useTasks() {
  const today = useTodayDate();
  const { settings: settingsValue } = useSettings();
  const { workspaceId, scopeId } = useWorkspace();
  // Scoped to the active workspace, matching extension's `inWs` (App.tsx).
  // scopeId is null under "All workspaces", which drops the predicate
  // entirely rather than filtering — the same escape hatch the extension's
  // `activeWsId === 'all'` gives.
  // Without this every list mixed all workspaces together — invisible while
  // a device only ever had its own seeded workspace, and immediately wrong
  // the moment sync brought the account's real ones down.
  const { data: tasks } = useLiveQuery(
    db
      .select()
      .from(task)
      .where(scopeId === null ? isNull(task.deletedAt) : and(isNull(task.deletedAt), eq(task.workspaceId, scopeId)))
      .orderBy(asc(task.sortOrder)),
    [scopeId],
  );
  const { data: sessions } = useLiveQuery(
    db
      .select()
      .from(pomodoroSession)
      .where(scopeId === null ? isNull(pomodoroSession.deletedAt) : and(isNull(pomodoroSession.deletedAt), eq(pomodoroSession.workspaceId, scopeId))),
    [scopeId],
  );

  // Mirrors extension's "Add recurring tasks to Today" effect (App.tsx) —
  // runs whenever tasks/today change, materializing each recurring task's
  // active occurrence (if any, and not already completed for that
  // occurrence) into Today. Never touches isPriority — auto-materialization
  // only ever adds to Today, matching the extension exactly. Idempotent:
  // each pass skips tasks already isToday/isPriority, so it converges
  // immediately rather than looping.
  useEffect(() => {
    // Which workspaces were actually touched, not just whether any were.
    // Under "All workspaces" this loop sees tasks from several at once, and
    // each one's order is its own synced record.
    const touched = new Set<string>();
    for (const t of tasks ?? []) {
      if (!t.recurrence || t.isToday || t.isPriority) continue;
      const rule = parseRecurrence(t.recurrence);
      if (!rule) continue;
      const occ = activeOccurrence(rule, today);
      if (!occ) continue;
      if (parseCompletedDates(t.completedDates).includes(occ)) continue;
      db.update(task).set({ isToday: true }).where(eq(task.id, t.id)).run();
      touched.add(t.workspaceId);
    }
    // Auto-materialization changes Today membership just as much as tapping
    // the row does, so it has to travel too — the extension's equivalent
    // writes straight into the synced todayIds. Guarded on having actually
    // changed something: the effect is idempotent and re-runs on every
    // tasks/today change, so stamping unconditionally would keep the order
    // permanently dirty and re-push it forever.
    if (touched.size > 0) {
      for (const ws of touched) markTaskOrderDirty(ws);
      triggerSync();
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
    entry.seconds += secondsBetween(creditedStart(s), s.endedAt);
    if (s.mode === 'pomodoro' && s.status === 'completed') entry.pomos += 1;
    statsByTask.set(s.taskId, entry);
  }

  // Adds parsed convenience fields alongside the raw JSON columns (still
  // present via the spread) — consumers that need the raw JSON (e.g.
  // writing it back unchanged) still can, without re-parsing.
  const withMeta = (tasks ?? []).map(t => {
    const stats = statsByTask.get(t.id);
    const recurrenceRule = parseRecurrence(t.recurrence);
    const completedOccurrences = parseCompletedDates(t.completedDates);
    const links = parseLinks(t.links);
    const noteEntries = parseNoteEntries(t.noteEntries);
    if (!stats) return { ...t, recurrenceRule, completedOccurrences, links, noteEntries };
    const time = formatDuration(stats.seconds);
    const meta = stats.pomos > 0 ? `${stats.pomos} pomo${stats.pomos === 1 ? '' : 's'} · ${time}` : time;
    return { ...t, meta, recurrenceRule, completedOccurrences, links, noteEntries };
  });

  // targetWorkspaceId is explicit because under "All workspaces" there is no
  // active one to infer from — falling back silently would drop the task into
  // whichever workspace happened to be the oldest.
  function addTask(title: string, projectId: string | null = null, targetWorkspaceId?: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const maxSortOrder = (tasks ?? []).reduce((max, t) => Math.max(max, t.sortOrder), -1);
    const now = new Date().toISOString();
    db.insert(task)
      .values({
        id: uid(),
        workspaceId: targetWorkspaceId ?? workspaceId,
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
    triggerSync();
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
    } else {
      const nowIso = new Date().toISOString();
      // Stamped when the task reaches a resolved status and cleared when it
      // leaves one, mirroring extension's HomeState.tsx. Reopening a task
      // should not leave it dated as finished.
      const resolvedNow = isResolvedStatus(status);
      db.update(task)
        .set({ status, updatedAt: nowIso, completedAt: resolvedNow ? (current?.completedAt ?? nowIso) : null })
        .where(eq(task.id, id))
        .run();
    }
    // Matches extension's App.tsx (line ~707): plays regardless of whether
    // the recurring or one-off path handled it above, but only for 'done' —
    // 'cancelled' never gets a sound in the extension either.
    if (status === 'done') playSound('task-done', settingsValue.soundSettings);
    triggerSync();
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
    triggerSync();
  }

  function updateTask(
    id: string,
    updates: {
      title?: string;
      projectId?: string | null;
      description?: string | null;
      ticketRef?: string | null;
      workspaceId?: string;
    },
  ): void {
    const current = (tasks ?? []).find(t => t.id === id);
    // Moving a task between workspaces drags two things with it that don't
    // survive the trip, so they're reset rather than left dangling:
    //   - the project, which belongs to exactly one workspace
    //   - Today/Priority membership, which is recorded per workspace in
    //     task_order; leaving the flags set would put the task in the new
    //     workspace's Today without it ever appearing in that order.
    // Both orders are marked dirty so the old workspace also learns the task
    // left its list.
    const moving = updates.workspaceId != null && current != null && updates.workspaceId !== current.workspaceId;
    const extra = moving ? { projectId: null, isToday: false, isPriority: false } : {};
    db.update(task)
      .set({ ...updates, ...extra, updatedAt: new Date().toISOString() })
      .where(eq(task.id, id))
      .run();
    if (moving && current && updates.workspaceId) {
      markTaskOrderDirty(current.workspaceId);
      markTaskOrderDirty(updates.workspaceId);
    }
    triggerSync();
  }

  function setLinks(id: string, links: TaskLink[]): void {
    db.update(task)
      .set({ links: JSON.stringify(links), updatedAt: new Date().toISOString() })
      .where(eq(task.id, id))
      .run();
    triggerSync();
  }

  function setNoteEntries(id: string, noteEntries: NoteEntry[]): void {
    db.update(task)
      .set({ noteEntries: JSON.stringify(noteEntries), updatedAt: new Date().toISOString() })
      .where(eq(task.id, id))
      .run();
    triggerSync();
  }

  // Retroactive time log, not a live timer session — mirrors extension's
  // handleAddTime (TaskDetailState.tsx): just hours+minutes, logged as
  // ending now. promptResolved must be true on insert: useTimer.ts's
  // mostRecentUnresolved picks the latest completed+unresolved session
  // regardless of mode, so an unresolved manual entry would otherwise
  // trigger Home's "want a break?" banner for a session that never ran.
  function addManualTime(taskId: string, durationSeconds: number): void {
    if (durationSeconds <= 0) return;
    const endedAt = new Date().toISOString();
    const startedAt = new Date(Date.now() - durationSeconds * 1000).toISOString();
    db.insert(pomodoroSession)
      .values({
        id: uid(),
        workspaceId,
        mode: 'manual',
        kind: 'focus',
        taskId,
        plannedDurationSeconds: null,
        startedAt,
        endedAt,
        status: 'completed',
        promptResolved: true,
        updatedAt: endedAt,
      })
      .run();
    triggerSync();
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
  // These still don't bump the task's own updatedAt (see the comment above),
  // so the write leaves nothing dirty on the task row. Membership travels as
  // its own per-workspace `task_order` record instead, which is what
  // markTaskOrderDirty stamps — that record is the only thing here that ever
  // needs pushing, and triggerSync sends it.
  function togglePriority(id: string, maxPriorities: number): boolean {
    const current = (tasks ?? []).find(t => t.id === id);
    if (!current) return false;
    if (current.isPriority) {
      db.update(task).set({ isPriority: false }).where(eq(task.id, id)).run();
      markTaskOrderDirty(current.workspaceId);
      triggerSync();
      return true;
    }
    if (isResolvedStatus(current.status)) return false;
    const priorityCount = (tasks ?? []).filter(
      t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)),
    ).length;
    if (priorityCount >= maxPriorities) return false;
    db.update(task).set({ isPriority: true, isToday: false }).where(eq(task.id, id)).run();
    markTaskOrderDirty(current.workspaceId);
    triggerSync();
    return true;
  }

  // Returns false (no-op) if the task is resolved (see togglePriority).
  function toggleToday(id: string): boolean {
    const current = (tasks ?? []).find(t => t.id === id);
    if (!current) return false;
    if (current.isToday) {
      db.update(task).set({ isToday: false }).where(eq(task.id, id)).run();
      markTaskOrderDirty(current.workspaceId);
      triggerSync();
      return true;
    }
    if (isResolvedStatus(current.status)) return false;
    db.update(task).set({ isToday: true, isPriority: false }).where(eq(task.id, id)).run();
    markTaskOrderDirty(current.workspaceId);
    triggerSync();
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
    // Soft delete (CLAUDE.md rule 4 — sync needs tombstones, never DELETE
    // FROM directly). Still a real cascade: a still-active/paused session
    // row left un-tombstoned would permanently block every future session
    // start regardless of its deletedAt — startSession's atomic guard
    // checks for ANY row in that state, tombstoned or not. Wrapped in a
    // transaction (not two separate calls) so a session started for this
    // task by another mounted timer instance between the two writes can't
    // slip through untombstoned — SQLite serializes writers, so nothing else
    // can insert into pomodoro_session for this taskId while this runs
    // (Greptile P1).
    const now = new Date().toISOString();
    db.transaction(tx => {
      tx.update(pomodoroSession).set({ deletedAt: now, updatedAt: now }).where(eq(pomodoroSession.taskId, id)).run();
      tx.update(task).set({ deletedAt: now, updatedAt: now }).where(eq(task.id, id)).run();
    });
    triggerSync();
  }

  return {
    tasks: withMeta,
    sessions: sessions ?? [],
    addTask,
    setTaskStatus,
    updateTask,
    togglePriority,
    toggleToday,
    setRecurrence,
    setLinks,
    setNoteEntries,
    addManualTime,
    removeTask,
  };
}
