import { isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRef } from 'react';

import { db } from '@/db/client';
import type { WorkspaceRow } from '@/db/schema';
import { workspace } from '@/db/schema';

// Exactly one workspace exists for now — db/client.ts's initDb seeds it
// synchronously at module load, unconditionally, before any component can
// mount. No switcher UI yet (Fase B3 adds real multi-workspace selection);
// this just exposes "the" workspace so every task/project/session insert
// has a workspaceId to write.
export function useWorkspace(): { workspace: WorkspaceRow; workspaceId: string } {
  const { data: rows } = useLiveQuery(db.select().from(workspace).where(isNull(workspace.deletedAt)));
  // Same useLiveQuery-starts-empty gap useSettings.ts documents — a
  // workspaceId is needed to insert a task/session, and code can run before
  // the live query's first async tick resolves (e.g. starting a timer
  // session right after mount).
  const syncFallbackRef = useRef<WorkspaceRow[] | null>(null);
  if (syncFallbackRef.current === null) {
    syncFallbackRef.current = db.select().from(workspace).where(isNull(workspace.deletedAt)).all();
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

  return { workspace: current, workspaceId: current.id };
}
