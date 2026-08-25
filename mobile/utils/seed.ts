import { eq, inArray, isNull, not, and } from 'drizzle-orm';

import { db } from '@/db/client';
import { habits, habitHistory, meeting, pomodoroSession, project, settings, task, workspace, SEED_IDS_KEY, type SeedIds } from '@/db/schema';

// The demo content initDb writes on first launch — a 'Personal' workspace,
// four habits with a fortnight of history, and seven tasks with invented
// ticket refs. It exists so the app doesn't open on an empty screen.
//
// It is not the user's data, and treating it as if it were caused real
// damage: signing in on a fresh install pushed "Fix flaky retry test in sync
// engine" and friends straight into a real account, alongside habits nobody
// created. It also made the first-sign-in prompt fire every single time,
// because "does this device have local data?" was answered by rows the app
// had written to itself.
//
// So initDb records what it seeded, and everything that asks "is there
// anything here worth keeping?" consults this instead of counting rows.
// The registry itself is written by db/client.ts's initDb, which owns the
// only writes to these tables.

const EMPTY: SeedIds = { workspace: [], habits: [], habitHistory: [], task: [] };

export function readSeedIds(): SeedIds {
  const raw = db.select().from(settings).where(eq(settings.key, SEED_IDS_KEY)).all()[0]?.value;
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<SeedIds>;
    return {
      workspace: parsed.workspace ?? [],
      habits: parsed.habits ?? [],
      habitHistory: parsed.habitHistory ?? [],
      task: parsed.task ?? [],
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Whether this device holds anything the user actually made.
 *
 * Seeded rows don't count — but a seeded row the user *edited* does, which
 * is what the createdAt/updatedAt comparison catches. Renaming the seeded
 * workspace or ticking off a demo task makes it theirs, and losing that
 * silently would be as bad as uploading the fixtures.
 *
 * Installs that predate seed tracking have no registry, so every row reads
 * as user data. That errs toward asking rather than assuming, which is the
 * safe direction: the worst case is one extra prompt.
 */
export function hasUserData(): boolean {
  const seeded = readSeedIds();

  const unseeded = <T extends { id: unknown }>(
    table: typeof task | typeof workspace | typeof habits | typeof habitHistory,
    ids: string[],
  ): boolean => {
    const rows = ids.length
      ? db.select({ id: table.id }).from(table).where(not(inArray(table.id, ids))).limit(1).all()
      : db.select({ id: table.id }).from(table).limit(1).all();
    return rows.length > 0;
  };

  if (unseeded(task, seeded.task)) return true;
  if (unseeded(workspace, seeded.workspace)) return true;
  if (unseeded(habits, seeded.habits)) return true;
  if (unseeded(habitHistory, seeded.habitHistory)) return true;

  // Never seeded at all — anything here is the user's by definition.
  if (db.select({ id: project.id }).from(project).limit(1).all().length > 0) return true;
  if (db.select({ id: meeting.id }).from(meeting).limit(1).all().length > 0) return true;
  if (db.select({ id: pomodoroSession.id }).from(pomodoroSession).limit(1).all().length > 0) return true;

  // A seeded row whose updatedAt has moved past its createdAt was edited.
  // habitHistory has no createdAt, so ticking a demo habit isn't caught
  // here — it lands in the account on a merge, which is the harmless
  // direction and not worth a column for.
  return editedSeedRow(task, seeded.task) || editedSeedRow(workspace, seeded.workspace) || editedSeedRow(habits, seeded.habits);
}

function editedSeedRow(table: typeof task | typeof workspace | typeof habits, ids: string[]): boolean {
  if (ids.length === 0) return false;
  return db
    .select({ id: table.id })
    .from(table)
    .where(and(inArray(table.id, ids), not(eq(table.updatedAt, table.createdAt))))
    .limit(1)
    .all()
    .length > 0;
}

/** Ids that must never be pushed: seeded and still untouched. Anything the
 *  user edited has stopped being a fixture and syncs like normal data. */
export function untouchedSeedIds(): SeedIds {
  const seeded = readSeedIds();
  const stillPristine = (table: typeof task | typeof workspace | typeof habits, ids: string[]): string[] => {
    if (ids.length === 0) return [];
    return db
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), eq(table.updatedAt, table.createdAt)))
      .all()
      .map(r => r.id);
  };
  const pristineHabits = stillPristine(habits, seeded.habits);
  return {
    workspace: stillPristine(workspace, seeded.workspace),
    habits: pristineHabits,
    // Habit logs follow their habit: a log only exists because the habit
    // does, and pushing a fortnight of invented history for a habit that
    // was never pushed would strand it server-side.
    habitHistory: pristineHabits.length > 0 ? seeded.habitHistory : [],
    task: stillPristine(task, seeded.task),
  };
}

/**
 * Drops the demo content once the account has supplied real content of its
 * own — the automatic half of "use my account only", for the case where
 * there was never anything to ask about.
 *
 * Only runs when the user made nothing themselves, so nothing of theirs can
 * be caught by it. Hard deletes, not tombstones: these rows were never
 * pushed, so there is nothing on the server for a tombstone to describe, and
 * writing one would propagate a deletion of rows that only ever existed here.
 */
export function dropSeedIfSupersededBy(pulledRows: number): boolean {
  if (pulledRows === 0 || hasUserData()) return false;
  const seeded = readSeedIds();
  if (seeded.task.length === 0 && seeded.workspace.length === 0 && seeded.habits.length === 0) return false;

  if (seeded.task.length) db.delete(task).where(inArray(task.id, seeded.task)).run();
  if (seeded.habitHistory.length) db.delete(habitHistory).where(inArray(habitHistory.id, seeded.habitHistory)).run();
  if (seeded.habits.length) db.delete(habits).where(inArray(habits.id, seeded.habits)).run();
  // The workspace goes last and only if nothing still references it —
  // pulled tasks may have been assigned to it by an earlier merge.
  for (const id of seeded.workspace) {
    const stillUsed = db.select({ id: task.id }).from(task).where(and(eq(task.workspaceId, id), isNull(task.deletedAt))).limit(1).all();
    if (stillUsed.length === 0) db.delete(workspace).where(eq(workspace.id, id)).run();
  }
  return true;
}
