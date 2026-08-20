import { asc, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRef } from 'react';

import { db } from '@/db/client';
import type { WorkspaceRow } from '@/db/schema';
import { workspace } from '@/db/schema';
import { uid } from '@/utils/id';

export interface WorkspaceInput {
  name: string;
  color: string;
}

// db/client.ts's initDb seeds one workspace synchronously at module load,
// unconditionally, before any component can mount — so `workspaces` is
// never empty in practice, and `workspace`/`workspaceId` (the oldest live
// one, by createdAt) is always resolvable. Free tier stays capped at this
// one (entitlements.features.multi_workspace gates adding more — see
// app/workspaces.tsx); addWorkspace itself doesn't enforce the cap, same
// division extension has between UI-level gating and the actual mutation.
export function useWorkspace(): {
  workspace: WorkspaceRow;
  workspaceId: string;
  workspaces: WorkspaceRow[];
  addWorkspace: (input: WorkspaceInput) => string;
  updateWorkspace: (id: string, input: WorkspaceInput) => void;
  removeWorkspace: (id: string) => void;
} {
  const { data: rows } = useLiveQuery(
    db.select().from(workspace).where(isNull(workspace.deletedAt)).orderBy(asc(workspace.createdAt)),
  );
  // Same useLiveQuery-starts-empty gap useSettings.ts documents — a
  // workspaceId is needed to insert a task/session, and code can run before
  // the live query's first async tick resolves (e.g. starting a timer
  // session right after mount).
  const syncFallbackRef = useRef<WorkspaceRow[] | null>(null);
  if (syncFallbackRef.current === null) {
    syncFallbackRef.current = db.select().from(workspace).where(isNull(workspace.deletedAt)).orderBy(asc(workspace.createdAt)).all();
  }
  const effectiveRows = rows.length > 0 ? rows : syncFallbackRef.current;
  const current = effectiveRows[0];
  if (!current) {
    // Unlike useSettings.ts (a genuinely absent setting is normal, falls
    // back to a default), there's no meaningful default workspace — and
    // initDb's seed is synchronous and unconditional, so reaching here
    // means that seeding didn't run at all. A real bug worth failing loud
    // on, not one to quietly thread `| null` through every insert call
    // site in the app for a case that can't happen in practice.
    throw new Error('No workspace found — db/client.ts initDb should have seeded one before mount');
  }

  function addWorkspace(input: WorkspaceInput): string {
    const id = uid();
    const now = new Date().toISOString();
    db.insert(workspace).values({ id, name: input.name.trim(), color: input.color, createdAt: now, updatedAt: now }).run();
    return id;
  }

  function updateWorkspace(id: string, input: WorkspaceInput): void {
    db.update(workspace)
      .set({ name: input.name.trim(), color: input.color, updatedAt: new Date().toISOString() })
      .where(eq(workspace.id, id))
      .run();
  }

  // No cascade to the workspace's own task/project/session rows — matches
  // removeProject's same known, documented gap (useProjects.ts), and in
  // practice unreachable today anyway: the UI (app/workspaces.tsx) disables
  // deleting the last workspace, and multi_workspace is Pro-gated, so a
  // free-tier user can never have a second workspace to delete down to one.
  function removeWorkspace(id: string): void {
    if (effectiveRows.length <= 1) return;
    const now = new Date().toISOString();
    db.update(workspace).set({ deletedAt: now, updatedAt: now }).where(eq(workspace.id, id)).run();
  }

  return { workspace: current, workspaceId: current.id, workspaces: effectiveRows, addWorkspace, updateWorkspace, removeWorkspace };
}
