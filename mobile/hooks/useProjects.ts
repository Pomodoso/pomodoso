import { and, asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { project } from '@/db/schema';
import { PROJECT_PALETTE } from '@/constants/projectPalette';
import { uid } from '@/utils/id';
import { markFieldsChosen, PROJECT_END_DATE_UNRECOVERED } from '@/utils/recovery';
import { triggerSync } from '@/utils/sync';

import { useWorkspace } from './useWorkspace';

export function useProjects() {
  const { workspaceId, scopeId } = useWorkspace();
  // Scoped to the active workspace, matching extension's `inWs` (App.tsx).
  // A project picker offering another workspace's projects would let a task
  // end up referencing a project its own workspace doesn't contain.
  const { data: projects } = useLiveQuery(
    db
      .select()
      .from(project)
      .where(scopeId === null ? isNull(project.deletedAt) : and(isNull(project.deletedAt), eq(project.workspaceId, scopeId)))
      .orderBy(asc(project.name)),
    [scopeId],
  );

  // targetWorkspaceId is explicit for the same reason addTask's is: under
  // "All workspaces" the active one is a fallback, so a project created while
  // filing a task into workspace B would otherwise land in whichever
  // workspace happened to be oldest — and then not appear in B's picker.
  function addProject(name: string, color: string = PROJECT_PALETTE[0], targetWorkspaceId?: string): string {
    const id = uid();
    const now = new Date().toISOString();
    db.insert(project)
      .values({ id, workspaceId: targetWorkspaceId ?? workspaceId, name: name.trim(), color, createdAt: now, updatedAt: now })
      .run();
    triggerSync();
    return id;
  }

  // endDate: null clears it (active with no end); archiving is setting it to
  // yesterday, see projectArchiveEndDate.
  function updateProject(id: string, updates: { name?: string; color?: string; endDate?: string | null }): void {
    // Only a change to the end date is a choice: a rename, or a save that
    // leaves the date as it was, keeps the project waiting for its real date
    // (utils/recovery.ts).
    const current = (projects ?? []).find(p => p.id === id);
    if (updates.endDate !== undefined && updates.endDate !== (current?.endDate ?? null)) {
      markFieldsChosen(PROJECT_END_DATE_UNRECOVERED, id);
    }
    db.update(project)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(project.id, id))
      .run();
    triggerSync();
  }

  // Soft delete (CLAUDE.md rule 4) — see schema.ts for the Fase B sync
  // columns this now participates in. Tasks referencing this project keep
  // their dangling projectId either way (pre-existing gap, not introduced
  // here — same as before this change, when the row was hard-deleted).
  function removeProject(id: string): void {
    const now = new Date().toISOString();
    db.update(project).set({ deletedAt: now, updatedAt: now }).where(eq(project.id, id)).run();
    triggerSync();
  }

  return { projects: projects ?? [], addProject, updateProject, removeProject };
}
