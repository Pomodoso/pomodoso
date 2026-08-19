import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { task } from '@/db/schema';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useTasks() {
  const { data: tasks } = useLiveQuery(db.select().from(task).orderBy(asc(task.sortOrder)));

  function addTask(title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const maxSortOrder = (tasks ?? []).reduce((max, t) => Math.max(max, t.sortOrder), -1);
    db.insert(task)
      .values({
        id: uid(),
        title: trimmed,
        ticketRef: null,
        meta: 'Not started',
        done: false,
        isPriority: false,
        sortOrder: maxSortOrder + 1,
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  function toggleTaskDone(id: string, done: boolean): void {
    db.update(task).set({ done }).where(eq(task.id, id)).run();
  }

  return { tasks: tasks ?? [], addTask, toggleTaskDone };
}
