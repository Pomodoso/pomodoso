import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { pomodoroSession, task } from '@/db/schema';
import type { TaskStatus } from '@/db/schema';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function secondsBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function formatDuration(totalSeconds: number): string {
  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function useTasks() {
  const { data: tasks } = useLiveQuery(db.select().from(task).orderBy(asc(task.sortOrder)));
  const { data: sessions } = useLiveQuery(db.select().from(pomodoroSession));

  // Real time-per-task, computed from completed sessions — falls back to the
  // task's stored `meta` placeholder ("Not started") for tasks with no
  // session history yet.
  const statsByTask = new Map<string, { pomos: number; seconds: number }>();
  for (const s of sessions ?? []) {
    if (!s.taskId || s.status !== 'completed' || !s.endedAt) continue;
    const entry = statsByTask.get(s.taskId) ?? { pomos: 0, seconds: 0 };
    entry.seconds += secondsBetween(s.startedAt, s.endedAt);
    if (s.mode === 'pomodoro' && s.kind === 'focus') entry.pomos += 1;
    statsByTask.set(s.taskId, entry);
  }

  const withMeta = (tasks ?? []).map(t => {
    const stats = statsByTask.get(t.id);
    if (!stats) return t;
    const time = formatDuration(stats.seconds);
    const meta = stats.pomos > 0 ? `${stats.pomos} pomo${stats.pomos === 1 ? '' : 's'} · ${time}` : time;
    return { ...t, meta };
  });

  function addTask(title: string): void {
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
        isPriority: false,
        sortOrder: maxSortOrder + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  function setTaskStatus(id: string, status: TaskStatus): void {
    db.update(task).set({ status, updatedAt: new Date().toISOString() }).where(eq(task.id, id)).run();
  }

  return { tasks: withMeta, addTask, setTaskStatus };
}
