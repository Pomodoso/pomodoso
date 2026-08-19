import { asc, eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { project } from '@/db/schema';
import { PROJECT_PALETTE } from '@/constants/projectPalette';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// No soft delete / sync tombstone here (CLAUDE.md rule 4 applies to the real
// shared data model — mobile's task/habits/session tables are still a spike
// without deleted_at either, see schema.ts comments; this stays consistent
// with that, not a one-off shortcut).
export function useProjects() {
  const { data: projects } = useLiveQuery(db.select().from(project).orderBy(asc(project.name)));

  function addProject(name: string, color: string = PROJECT_PALETTE[0]): string {
    const id = uid();
    const now = new Date().toISOString();
    db.insert(project).values({ id, name: name.trim(), color, createdAt: now, updatedAt: now }).run();
    return id;
  }

  function updateProject(id: string, updates: { name?: string; color?: string }): void {
    db.update(project)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(project.id, id))
      .run();
  }

  function removeProject(id: string): void {
    db.delete(project).where(eq(project.id, id)).run();
  }

  return { projects: projects ?? [], addProject, updateProject, removeProject };
}
