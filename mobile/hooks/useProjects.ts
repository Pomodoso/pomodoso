import { asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { project } from '@/db/schema';
import { PROJECT_PALETTE } from '@/constants/projectPalette';

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useProjects() {
  const { data: projects } = useLiveQuery(
    db.select().from(project).where(isNull(project.deletedAt)).orderBy(asc(project.name)),
  );

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

  // Soft delete (CLAUDE.md rule 4) — see schema.ts for the Fase B sync
  // columns this now participates in. Tasks referencing this project keep
  // their dangling projectId either way (pre-existing gap, not introduced
  // here — same as before this change, when the row was hard-deleted).
  function removeProject(id: string): void {
    const now = new Date().toISOString();
    db.update(project).set({ deletedAt: now, updatedAt: now }).where(eq(project.id, id)).run();
  }

  return { projects: projects ?? [], addProject, updateProject, removeProject };
}
