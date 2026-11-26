import { eq, inArray, isNull, not, and } from 'drizzle-orm';

import { db } from '@/db/client';
import { achievements, habits, habitHistory, meeting, plugin, pomodoroSession, project, settings, task, workspace, SEED_IDS_KEY, type SeedIds } from '@/db/schema';

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
 * Seeded rows don't count, unless the user edited or used them (see
 * untouchedSeedIds): renaming the seeded workspace, ticking off a demo task
 * or checking a demo habit makes it theirs, and losing that silently would be
 * as bad as uploading the fixtures.
 *
 * Installs that predate seed tracking have no registry, so every row reads
 * as user data. That errs toward asking rather than assuming, which is the
 * safe direction: the worst case is one extra prompt.
 */
export function hasUserData(): boolean {
  const untouched = untouchedSeedIds();

  const beyond = (
    table: typeof task | typeof workspace | typeof habits | typeof habitHistory,
    ids: string[],
  ): boolean => {
    const rows = ids.length
      ? db.select({ id: table.id }).from(table).where(not(inArray(table.id, ids))).limit(1).all()
      : db.select({ id: table.id }).from(table).limit(1).all();
    return rows.length > 0;
  };

  if (beyond(task, untouched.task)) return true;
  if (beyond(workspace, untouched.workspace)) return true;
  if (beyond(habits, untouched.habits)) return true;
  if (beyond(habitHistory, untouched.habitHistory)) return true;

  // Never seeded at all — anything here is the user's by definition.
  if (db.select({ id: project.id }).from(project).limit(1).all().length > 0) return true;
  if (db.select({ id: meeting.id }).from(meeting).limit(1).all().length > 0) return true;
  if (db.select({ id: plugin.id }).from(plugin).limit(1).all().length > 0) return true;
  return db.select({ id: pomodoroSession.id }).from(pomodoroSession).limit(1).all().length > 0;
}

/**
 * Ids that must never be pushed or exported: seeded and still untouched.
 *
 * Untouched means unedited *and* unused. A seeded row stops being a fixture
 * once the user edits it (updatedAt moves past createdAt) or once something
 * live of theirs points at it, because pushing that something without its
 * parent would strand it server-side:
 *   - a habit with a log the user wrote, or a demo log the user changed
 *     (initDb writes demo logs with the habit's createdAt as their
 *     updatedAt, so any other date means an edit), or an achievement;
 *   - a task with a pomodoro session;
 *   - a workspace holding any task, project, session or meeting that is
 *     itself going to be pushed.
 * A habit's demo logs follow the habit: excluded while it is, pushed with it
 * once it's adopted.
 *
 * Adopting a row by use also stamps it (see adoptUsedSeedRows), so this is
 * not a pure read.
 */
export function untouchedSeedIds(): SeedIds {
  const seeded = readSeedIds();
  if (seeded.workspace.length + seeded.habits.length + seeded.task.length === 0) return EMPTY;
  const { untouched, adopted } = seedState(seeded);
  adoptUsedSeedRows(seeded, adopted);
  return untouched;
}

interface SeedState {
  untouched: SeedIds;
  /** Seeded rows still carrying their seed dates but now in use. */
  adopted: { workspace: string[]; habits: string[]; task: string[] };
}

function seedState(seeded: SeedIds): SeedState {
  const seedHistory = new Set(seeded.habitHistory);

  // Only live rows count as use: a project created in the demo workspace and
  // then deleted doesn't make the workspace the user's.
  const seedHabits = seeded.habits.length
    ? db.select().from(habits).where(inArray(habits.id, seeded.habits)).all()
    : [];
  const habitCreatedAt = new Map(seedHabits.map(h => [h.id, h.createdAt]));
  const usedHabits = new Set<string>();
  for (const h of db
    .select({ id: habitHistory.id, habitId: habitHistory.habitId, updatedAt: habitHistory.updatedAt })
    .from(habitHistory)
    .where(isNull(habitHistory.deletedAt))
    .all()) {
    if (!seedHistory.has(h.id) || h.updatedAt !== habitCreatedAt.get(h.habitId)) usedHabits.add(h.habitId);
  }
  for (const a of db.select({ habitId: achievements.habitId }).from(achievements).where(isNull(achievements.deletedAt)).all()) {
    if (a.habitId) usedHabits.add(a.habitId);
  }
  const pristineHabits = seedHabits.filter(h => h.updatedAt === h.createdAt);
  const untouchedHabits = new Set(pristineHabits.filter(h => !usedHabits.has(h.id)).map(h => h.id));
  const untouchedHistory = seeded.habitHistory.length
    ? db
        .select({ id: habitHistory.id, habitId: habitHistory.habitId })
        .from(habitHistory)
        .where(inArray(habitHistory.id, seeded.habitHistory))
        .all()
        .filter(h => untouchedHabits.has(h.habitId))
        .map(h => h.id)
    : [];

  const seedTasks = seeded.task.length
    ? db.select({ id: task.id, createdAt: task.createdAt, updatedAt: task.updatedAt }).from(task).where(inArray(task.id, seeded.task)).all()
    : [];
  const usedTasks = new Set(
    db
      .select({ taskId: pomodoroSession.taskId })
      .from(pomodoroSession)
      .where(isNull(pomodoroSession.deletedAt))
      .all()
      .map(s => s.taskId)
      .filter((id): id is string => id !== null),
  );
  const pristineTasks = seedTasks.filter(t => t.updatedAt === t.createdAt);
  const untouchedTasks = new Set(pristineTasks.filter(t => !usedTasks.has(t.id)).map(t => t.id));

  const usedWorkspaces = new Set<string>([
    ...db
      .select({ id: task.id, workspaceId: task.workspaceId })
      .from(task)
      .where(isNull(task.deletedAt))
      .all()
      .filter(t => !untouchedTasks.has(t.id))
      .map(t => t.workspaceId),
    ...db.select({ workspaceId: project.workspaceId }).from(project).where(isNull(project.deletedAt)).all().map(r => r.workspaceId),
    ...db.select({ workspaceId: pomodoroSession.workspaceId }).from(pomodoroSession).where(isNull(pomodoroSession.deletedAt)).all().map(r => r.workspaceId),
    ...db.select({ workspaceId: meeting.workspaceId }).from(meeting).where(isNull(meeting.deletedAt)).all().map(r => r.workspaceId),
  ]);
  const pristineWorkspaces = seeded.workspace.length
    ? db
        .select({ id: workspace.id, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt })
        .from(workspace)
        .where(inArray(workspace.id, seeded.workspace))
        .all()
        .filter(w => w.updatedAt === w.createdAt)
    : [];

  return {
    untouched: {
      workspace: pristineWorkspaces.filter(w => !usedWorkspaces.has(w.id)).map(w => w.id),
      habits: [...untouchedHabits],
      habitHistory: untouchedHistory,
      task: [...untouchedTasks],
    },
    adopted: {
      workspace: pristineWorkspaces.filter(w => usedWorkspaces.has(w.id)).map(w => w.id),
      habits: pristineHabits.filter(h => usedHabits.has(h.id)).map(h => h.id),
      task: pristineTasks.filter(t => usedTasks.has(t.id)).map(t => t.id),
    },
  };
}

/**
 * Stamps demo rows the user has started using, so they sync like a fresh edit.
 *
 * A seeded row keeps its seed date until edited. Pushed with that date, other
 * devices' incremental pull (`updated_at > since`) would skip it while
 * receiving the newer log, session or task that points at it. Bumping
 * updatedAt makes it visible to them, and also makes the adoption stick: the
 * row is no longer pristine, so it never reads as demo again.
 *
 * Safe for tasks too: an adopted task has a session, and History groups a
 * task with sessions by its sessions, not by updatedAt. A habit's demo logs
 * are stamped with it, since they now sync too.
 */
function adoptUsedSeedRows(seeded: SeedIds, adopted: SeedState['adopted']): void {
  if (adopted.workspace.length + adopted.habits.length + adopted.task.length === 0) return;
  const ts = new Date().toISOString();
  db.transaction(tx => {
    if (adopted.workspace.length) tx.update(workspace).set({ updatedAt: ts }).where(inArray(workspace.id, adopted.workspace)).run();
    if (adopted.task.length) tx.update(task).set({ updatedAt: ts }).where(inArray(task.id, adopted.task)).run();
    if (adopted.habits.length) {
      tx.update(habits).set({ updatedAt: ts }).where(inArray(habits.id, adopted.habits)).run();
      if (seeded.habitHistory.length) {
        tx.update(habitHistory)
          .set({ updatedAt: ts })
          .where(and(inArray(habitHistory.id, seeded.habitHistory), inArray(habitHistory.habitId, adopted.habits)))
          .run();
      }
    }
  });
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

/**
 * "Start empty" on the welcome screen: removes the demo tasks and habits the
 * user hasn't touched. The workspace stays, since every screen needs one;
 * untouched, it is never pushed anyway.
 *
 * Hard deletes, for the same reason as dropSeedIfSupersededBy: these rows were
 * never pushed, so a tombstone would describe nothing on the server.
 */
export function dropUntouchedSeed(): void {
  const untouched = untouchedSeedIds();
  db.transaction(tx => {
    if (untouched.task.length) tx.delete(task).where(inArray(task.id, untouched.task)).run();
    if (untouched.habitHistory.length) tx.delete(habitHistory).where(inArray(habitHistory.id, untouched.habitHistory)).run();
    if (untouched.habits.length) tx.delete(habits).where(inArray(habits.id, untouched.habits)).run();
  });
}
