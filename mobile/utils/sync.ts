import type { SyncEntity } from '@pomodoso/api';
import { habitDaysFromServer, habitFrequency, pullScope, readPullCursor, writeExtra, writePullCursor } from '@pomodoso/types';
import { pullEntities, pushEntities, TokenApiClient } from '@pomodoso/api';
import { and, asc, eq, isNull, or, lt, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { habits, habitHistory, meeting, pomodoroSession, project, settings, task, taskOrder, workspace } from '@/db/schema';
import type { MeetingRow } from '@/db/schema';
import { API_URL, getMobileSupabase } from '@/lib/supabase';
import { uid, habitLogId } from '@/utils/id';
import {
  discardLocalData,
  needsSyncChoice,
  recordSyncChoice,
  requestSyncChoice,
  resolveSyncChoice,
  type SyncChoice,
} from '@/utils/syncChoice';
import { creditedStart } from '@/utils/time';

// Ports extension's syncEngine.ts (push/pull/LWW) for the tables mobile
// actually has. Deliberately NOT ported yet, both documented gaps rather
// than silent omissions:
//   - user_setting (SYNCED_SETTINGS): extension bundles focus/short/long
//     break + longBreakEvery into one `timer_settings` wire shape; mobile
//     stores them as separate local keys (useSettings.ts). Needs a mapping
//     layer at the sync boundary, not a quick add — separate PR.
//   - task_order (priority_ids/today_ids per workspace): extension models
//     Today/Priorities as an ordered list per workspace; mobile models it
//     as isPriority/isToday booleans directly on the task row, with no
//     ordering concept at all (display order is sortOrder). Reconciling
//     these two shapes is real design work, not a mechanical port —
//     separate PR. Until then, priority/today membership stays device-local.
// pull() still handles both tables by simply ignoring them (no case in the
// switch), rather than crashing on an entity type it doesn't recognize —
// another client (extension/web) sharing this account may still push them.

const SYNC_LAST_PULL_KEY = 'sync_last_pull';
const DEVICE_ID_KEY = 'device_id';

function nowIso(): string {
  return new Date().toISOString();
}

/** Records that this workspace's Today/Priorities membership changed, so the
 *  next push sends it.
 *
 *  Called from the toggles rather than inferred, because membership lives on
 *  the task rows and those deliberately don't bump their own `updatedAt`
 *  when it changes — there would otherwise be nothing to notice. */
export function markTaskOrderDirty(workspaceId: string): void {
  const ts = nowIso();
  db.insert(taskOrder)
    .values({ workspaceId, updatedAt: ts, syncedAt: null })
    .onConflictDoUpdate({ target: taskOrder.workspaceId, set: { updatedAt: ts } })
    .run();
}

/** Task ids in one workspace that are in Today (or Priorities), ordered the
 *  way the user sees them. `sortOrder` carries the position; the wire wants
 *  an array, so the two translate through here in both directions. */
function orderedIds(workspaceId: string, list: 'today' | 'priority'): string[] {
  return db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNull(task.deletedAt),
        eq(list === 'today' ? task.isToday : task.isPriority, true),
      ),
    )
    .orderBy(asc(task.sortOrder))
    .all()
    .map(r => r.id);
}

/** Writes a server-sent order onto the task rows it names.
 *
 *  Everything in the workspace is cleared first: an id absent from both
 *  arrays means "not in Today or Priorities", and without the reset a task
 *  removed from Today on another device would stay there forever here.
 *  Membership is mutually exclusive, matching togglePriority/toggleToday.
 *
 *  `sortOrder` is only rewritten for tasks the arrays actually name —
 *  backlog rows keep their own ordering, which this record says nothing
 *  about. `task.updatedAt` is deliberately untouched (see db/schema.ts). */
function applyTaskOrder(workspaceId: string, priorityIds: string[], todayIds: string[]): void {
  db.update(task)
    .set({ isPriority: false, isToday: false })
    .where(eq(task.workspaceId, workspaceId))
    .run();

  const write = (ids: string[], field: 'isPriority' | 'isToday'): void => {
    ids.forEach((id, index) => {
      db.update(task)
        .set({ [field]: true, sortOrder: index })
        .where(and(eq(task.id, id), eq(task.workspaceId, workspaceId)))
        .run();
    });
  };
  write(priorityIds, 'isPriority');
  write(todayIds, 'isToday');
}

function getSetting(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).all()[0]?.value;
}

function putSetting(key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

// Generated once per install, persisted locally — never itself synced as a
// syncable entity, only carried inside other entities' `device_id` field
// (matches extension's getDeviceId, db.ts).
function getDeviceId(): string {
  const existing = getSetting(DEVICE_ID_KEY);
  if (existing) {
    try {
      return JSON.parse(existing) as string;
    } catch {
      // fall through to regenerate
    }
  }
  const id = uid();
  putSetting(DEVICE_ID_KEY, JSON.stringify(id));
  return id;
}

function toEntity(
  table: string,
  id: string,
  updatedAt: string,
  deletedAt: string | null,
  data: Record<string, unknown>,
): SyncEntity {
  return { table, id, data, updated_at: updatedAt, deleted_at: deletedAt };
}

function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function taskExtra(t: typeof task.$inferSelect): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  writeExtra(extra, 'description', t.description);
  writeExtra(extra, 'links', parseJsonArray(t.links));
  writeExtra(extra, 'noteEntries', parseJsonArray(t.noteEntries));
  writeExtra(extra, 'recurrence', t.recurrence ? (JSON.parse(t.recurrence) as unknown) : null);
  writeExtra(extra, 'completedDates', parseJsonArray(t.completedDates));
  // No preferredMode column on mobile — deliberately not written, so the
  // extension's value survives rather than being blanked.
  return extra;
}

function habitExtra(h: typeof habits.$inferSelect): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  writeExtra(extra, 'createdAt', h.createdAt);
  writeExtra(extra, 'unit', h.unit);
  writeExtra(extra, 'unitAmount', h.unitAmount);
  // Explicitly null when disabled so the clear travels — writeExtra now gives
  // every field that property, which is what this used to special-case.
  writeExtra(extra, 'challengeLengthDays', h.challengeLengthDays);
  return extra;
}

// Same key names as the extension's meetingExtra — the backend's `extra`
// column is an opaque passthrough blob, so both clients must agree on them.
function meetingExtra(m: MeetingRow): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  writeExtra(extra, 'notes', m.notes);
  writeExtra(extra, 'description', m.description);
  writeExtra(extra, 'recurringEventId', m.recurringEventId);
  writeExtra(extra, 'recurringLabel', m.recurringLabel);
  writeExtra(extra, 'calendarId', m.calendarId);
  writeExtra(extra, 'calendarName', m.calendarName);
  writeExtra(extra, 'calendarColor', m.calendarColor);
  return extra;
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function push(client: TokenApiClient): Promise<void> {
  const entities: SyncEntity[] = [];
  const deviceId = getDeviceId();

  const workspaces = db
    .select()
    .from(workspace)
    .where(or(isNull(workspace.syncedAt), lt(workspace.syncedAt, workspace.updatedAt)))
    .all();
  for (const w of workspaces) {
    entities.push(toEntity('workspace', w.id, w.updatedAt, w.deletedAt, { name: w.name, color: w.color }));
  }

  const projects = db
    .select()
    .from(project)
    .where(or(isNull(project.syncedAt), lt(project.syncedAt, project.updatedAt)))
    .all();
  for (const p of projects) {
    entities.push(
      toEntity('project', p.id, p.updatedAt, p.deletedAt, {
        name: p.name,
        color: p.color,
        workspace_id: p.workspaceId,
        end_date: null,
      }),
    );
  }

  const tasks = db
    .select()
    .from(task)
    .where(or(isNull(task.syncedAt), lt(task.syncedAt, task.updatedAt)))
    .all();
  for (const t of tasks) {
    entities.push(
      toEntity('task', t.id, t.updatedAt, t.deletedAt, {
        title: t.title,
        status: t.status,
        notes: '',
        workspace_id: t.workspaceId,
        project_id: t.projectId,
        parent_id: null,
        ticket_id: t.ticketRef,
        extra: taskExtra(t),
      }),
    );
  }

  // Only completed focus-time entries sync, matching what extension's own
  // wire usage actually is (it only ever sends kind:'focus'/status:
  // 'completed', even though the backend schema is more permissive) —
  // active/paused/interrupted sessions and breaks stay device-local.
  // Already-deleted-but-never-synced sessions are simply never pushed —
  // the backend's pomodoro_session table has no deleted_at column at all
  // (confirmed via its pull SELECT, which hardcodes deleted_at: None), so
  // there's nothing meaningful to push for a session soft-deleted after it
  // already synced either; that's a known, extension-inherited gap, not
  // introduced here.
  const sessions = db
    .select()
    .from(pomodoroSession)
    .where(
      and(
        eq(pomodoroSession.status, 'completed'),
        eq(pomodoroSession.kind, 'focus'),
        isNull(pomodoroSession.deletedAt),
        isNotNull(pomodoroSession.endedAt),
        or(isNull(pomodoroSession.syncedAt), lt(pomodoroSession.syncedAt, pomodoroSession.updatedAt)),
      ),
    )
    .all();
  for (const s of sessions) {
    // creditedStart, not startedAt: a session whose task was swapped
    // mid-pomodoro already banked the earlier stretch as its own row, and
    // pushing the full span would credit it twice on every other device.
    const startedAt = creditedStart(s);
    const durationSeconds = Math.round((new Date(s.endedAt!).getTime() - new Date(startedAt).getTime()) / 1000);
    entities.push(
      toEntity('pomodoro_session', s.id, s.updatedAt, null, {
        workspace_id: s.workspaceId,
        task_id: s.taskId,
        ticket_id: null,
        mode: s.mode,
        started_at: startedAt,
        duration_seconds: durationSeconds,
        kind: 'focus',
        status: 'completed',
        device_id: deviceId,
      }),
    );
  }

  // User-global (not workspace-scoped, CLAUDE.md rule 6).
  const habitRows = db
    .select()
    .from(habits)
    .where(or(isNull(habits.syncedAt), lt(habits.syncedAt, habits.updatedAt)))
    .all();
  for (const h of habitRows) {
    entities.push(
      toEntity('habit', h.id, h.updatedAt, h.deletedAt, {
        name: h.name,
        icon: h.icon,
        kind: h.kind,
        target_count: h.goal,
        extra: habitExtra(h),
        ...habitFrequency(JSON.parse(h.days) as number[]),
      }),
    );
  }

  const historyRows = db
    .select()
    .from(habitHistory)
    .where(or(isNull(habitHistory.syncedAt), lt(habitHistory.syncedAt, habitHistory.updatedAt)))
    .all();
  for (const r of historyRows) {
    entities.push(
      toEntity('habit_log', r.id, r.updatedAt, null, {
        habit_id: r.habitId,
        date: r.date,
        value: r.count || (r.done ? 1 : 0),
        completed_at: null,
      }),
    );
  }

  // Workspace-scoped, like tasks (CLAUDE.md rule 6) — the one part of
  // calendar integration (Fase B6) that's genuinely cross-device. The
  // Google OAuth connection itself is deliberately NOT synced (see
  // backgroundSync-adjacent calendar utils, once B6b lands) — matches the
  // extension's real behavior, not ADR 0002's stale claim that
  // calendar_connections round-trips through SYNCED_SETTINGS.
  const meetings = db
    .select()
    .from(meeting)
    .where(or(isNull(meeting.syncedAt), lt(meeting.syncedAt, meeting.updatedAt)))
    .all();
  for (const m of meetings) {
    entities.push(
      toEntity('meeting', m.id, m.updatedAt, m.deletedAt, {
        workspace_id: m.workspaceId,
        title: m.title,
        time: m.time,
        duration_minutes: m.durationMinutes,
        logged_minutes: m.loggedMinutes,
        logged: m.logged,
        track_mode: m.trackMode,
        project_id: m.projectId,
        google_event_id: m.googleEventId,
        extra: meetingExtra(m),
      }),
    );
  }

  // Today / Priorities membership. The arrays are derived from the task
  // rows at push time rather than stored — the booleans are the source of
  // truth on this client, and keeping a second copy would let the two
  // drift. Only the timestamps live in task_order (see db/schema.ts).
  const dirtyOrders = db
    .select()
    .from(taskOrder)
    .where(or(isNull(taskOrder.syncedAt), lt(taskOrder.syncedAt, taskOrder.updatedAt)))
    .all();
  for (const o of dirtyOrders) {
    entities.push(
      toEntity('task_order', o.workspaceId, o.updatedAt, null, {
        workspace_id: o.workspaceId,
        priority_ids: orderedIds(o.workspaceId, 'priority'),
        today_ids: orderedIds(o.workspaceId, 'today'),
      }),
    );
  }

  // Device heartbeat — registers this install, same pattern as extension's.
  entities.push(
    toEntity('device', deviceId, nowIso(), null, {
      kind: 'mobile',
      name: 'Mobile',
      browser: 'Mobile',
      version: '',
      synced: true,
    }),
  );

  if (entities.length === 0) return;
  await pushEntities(client, { entities });

  // Stamp syncedAt only on rows whose updatedAt still matches what was read
  // at the top of this function (per-row, not a bulk `id IN (...)`) — a row
  // edited again while pushEntities' request was in flight now has a newer
  // updatedAt than its own snapshot, so this condition correctly skips it,
  // leaving it dirty for the next sync. Stamping unconditionally (matching
  // extension's own syncEngine.ts, which has this same race) would mark it
  // synced anyway, silently dropping that edit until the row changes again
  // (Greptile P1).
  const ts = nowIso();
  for (const w of workspaces) {
    db.update(workspace)
      .set({ syncedAt: ts })
      .where(and(eq(workspace.id, w.id), eq(workspace.updatedAt, w.updatedAt)))
      .run();
  }
  for (const p of projects) {
    db.update(project)
      .set({ syncedAt: ts })
      .where(and(eq(project.id, p.id), eq(project.updatedAt, p.updatedAt)))
      .run();
  }
  for (const t of tasks) {
    db.update(task)
      .set({ syncedAt: ts })
      .where(and(eq(task.id, t.id), eq(task.updatedAt, t.updatedAt)))
      .run();
  }
  for (const s of sessions) {
    db.update(pomodoroSession)
      .set({ syncedAt: ts })
      .where(and(eq(pomodoroSession.id, s.id), eq(pomodoroSession.updatedAt, s.updatedAt)))
      .run();
  }
  for (const h of habitRows) {
    db.update(habits)
      .set({ syncedAt: ts })
      .where(and(eq(habits.id, h.id), eq(habits.updatedAt, h.updatedAt)))
      .run();
  }
  for (const r of historyRows) {
    db.update(habitHistory)
      .set({ syncedAt: ts })
      .where(and(eq(habitHistory.id, r.id), eq(habitHistory.updatedAt, r.updatedAt)))
      .run();
  }
  for (const m of meetings) {
    db.update(meeting)
      .set({ syncedAt: ts })
      .where(and(eq(meeting.id, m.id), eq(meeting.updatedAt, m.updatedAt)))
      .run();
  }
  for (const o of dirtyOrders) {
    db.update(taskOrder)
      .set({ syncedAt: ts })
      .where(and(eq(taskOrder.workspaceId, o.workspaceId), eq(taskOrder.updatedAt, o.updatedAt)))
      .run();
  }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pull(client: TokenApiClient, scope: string): Promise<void> {
  const since = readPullCursor(getSetting(SYNC_LAST_PULL_KEY), scope);
  const response = await pullEntities(client, since);

  // task_order names task ids, so it has to land after the tasks it names —
  // otherwise a first sync (where both arrive in the same batch, in whatever
  // order the server listed them) would apply an order against rows that
  // don't exist yet and silently drop Today membership.
  const ordered = [...response.entities].sort(
    (a, b) => Number(a.table === 'task_order') - Number(b.table === 'task_order'),
  );
  for (const entity of ordered) {
    applyEntity(entity);
  }

  putSetting(SYNC_LAST_PULL_KEY, writePullCursor(scope, response.server_time));
}

function applyEntity(entity: SyncEntity): void {
  const { table, id, data, updated_at, deleted_at } = entity;
  const syncedAt = updated_at;

  switch (table) {
    case 'workspace': {
      const existing = db.select().from(workspace).where(eq(workspace.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      db.insert(workspace)
        .values({
          id,
          name: String(data.name ?? 'Workspace'),
          color: String(data.color ?? '#6366f1'),
          // The server's real created_at when it sends one. Falling back to
          // updated_at makes every synced workspace look brand new, and
          // useWorkspace picks the oldest when no active one is stored — so
          // the fallback pinned the device to its own seeded workspace and
          // the account's real ones could never become active.
          createdAt: existing?.createdAt ?? (data.created_at as string | undefined) ?? updated_at,
          updatedAt: updated_at,
          deletedAt: deleted_at,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: workspace.id,
          set: { name: String(data.name ?? 'Workspace'), color: String(data.color ?? '#6366f1'), updatedAt: updated_at, deletedAt: deleted_at, syncedAt },
        })
        .run();
      break;
    }

    case 'project': {
      const existing = db.select().from(project).where(eq(project.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const workspaceId = (data.workspace_id as string | null) ?? existing?.workspaceId;
      if (!workspaceId) return; // can't satisfy the NOT NULL FK — skip rather than crash
      const row = {
        id,
        workspaceId,
        name: String(data.name ?? ''),
        color: String(data.color ?? '#6366f1'),
        createdAt: existing?.createdAt ?? updated_at,
        updatedAt: updated_at,
        deletedAt: deleted_at,
        syncedAt,
      };
      db.insert(project)
        .values(row)
        .onConflictDoUpdate({ target: project.id, set: { ...row, id: undefined, createdAt: undefined } as never })
        .run();
      break;
    }

    case 'task': {
      const existing = db.select().from(task).where(eq(task.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const workspaceId = (data.workspace_id as string | null) ?? existing?.workspaceId;
      if (!workspaceId) return; // can't satisfy the NOT NULL FK — skip rather than crash
      const extra = (data.extra ?? {}) as Record<string, unknown>;
      // The `'key' in extra` checks below are the read side of the shared
      // wire contract (shared/types sync-wire.ts): a present key wins even
      // when null or empty, an absent one leaves the local value alone.
      const description = 'description' in extra ? (extra.description as string | null) : existing?.description;
      const links = 'links' in extra ? JSON.stringify(extra.links) : (existing?.links ?? '[]');
      const noteEntries = 'noteEntries' in extra ? JSON.stringify(extra.noteEntries) : (existing?.noteEntries ?? '[]');
      const recurrence = 'recurrence' in extra ? JSON.stringify(extra.recurrence) : (existing?.recurrence ?? null);
      const completedDates = 'completedDates' in extra ? JSON.stringify(extra.completedDates) : (existing?.completedDates ?? '[]');
      db.insert(task)
        .values({
          id,
          workspaceId,
          title: String(data.title ?? ''),
          ticketRef: (data.ticket_id as string | null) ?? null,
          meta: existing?.meta ?? null,
          status: (data.status as typeof task.$inferSelect.status) ?? 'todo',
          projectId: (data.project_id as string | null) ?? null,
          isPriority: existing?.isPriority ?? false,
          isToday: existing?.isToday ?? false,
          recurrence,
          completedDates,
          description,
          links,
          noteEntries,
          sortOrder: existing?.sortOrder ?? 0,
          createdAt: existing?.createdAt ?? updated_at,
          updatedAt: updated_at,
          deletedAt: deleted_at,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: task.id,
          set: {
            workspaceId,
            title: String(data.title ?? ''),
            ticketRef: (data.ticket_id as string | null) ?? null,
            status: (data.status as typeof task.$inferSelect.status) ?? 'todo',
            projectId: (data.project_id as string | null) ?? null,
            recurrence,
            completedDates,
            description,
            links,
            noteEntries,
            updatedAt: updated_at,
            deletedAt: deleted_at,
            syncedAt,
          },
        })
        .run();
      break;
    }

    case 'pomodoro_session': {
      // Mobile has a real sessions table (unlike extension, which merges
      // this into the owning task's embedded timeLogs) — a pulled session
      // is just a normal upsert-by-id.
      const existing = db.select().from(pomodoroSession).where(eq(pomodoroSession.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const workspaceId = (data.workspace_id as string | null) ?? existing?.workspaceId;
      if (!workspaceId) return;
      const startedAt = String(data.started_at ?? updated_at);
      const durationSeconds = Number(data.duration_seconds ?? 0);
      const endedAt = new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString();
      const row = {
        id,
        workspaceId,
        mode: (data.mode as typeof pomodoroSession.$inferSelect.mode) ?? 'pomodoro',
        kind: 'focus' as const,
        taskId: (data.task_id as string | null) ?? null,
        plannedDurationSeconds: null,
        startedAt,
        pausedAt: null,
        endedAt,
        status: 'completed' as const,
        notificationId: null,
        // A pulled historical session never has a live prompt to resolve —
        // leaving this false would make it show up in mostRecentUnresolved
        // (useTimer.ts) and surface a stale "want a break?" banner for a
        // session that finished on another device.
        promptResolved: true,
        updatedAt: updated_at,
        deletedAt: deleted_at,
        syncedAt,
      };
      db.insert(pomodoroSession)
        .values(row)
        .onConflictDoUpdate({ target: pomodoroSession.id, set: { ...row, id: undefined } as never })
        .run();
      break;
    }

    case 'task_order': {
      const existing = db.select().from(taskOrder).where(eq(taskOrder.workspaceId, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      applyTaskOrder(
        id,
        Array.isArray(data.priority_ids) ? (data.priority_ids as string[]) : [],
        Array.isArray(data.today_ids) ? (data.today_ids as string[]) : [],
      );
      db.insert(taskOrder)
        .values({ workspaceId: id, updatedAt: updated_at, syncedAt })
        .onConflictDoUpdate({
          target: taskOrder.workspaceId,
          set: { updatedAt: updated_at, syncedAt },
        })
        .run();
      break;
    }

    case 'habit': {
      const existing = db.select().from(habits).where(eq(habits.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const days = habitDaysFromServer(String(data.frequency ?? 'daily'), data.frequency_days as string | null | undefined);
      const hExtra = (data.extra ?? {}) as Record<string, unknown>;
      const row = {
        id,
        name: String(data.name ?? ''),
        icon: String(data.icon ?? 'star'),
        kind: (data.kind as typeof habits.$inferSelect.kind) ?? 'boolean',
        goal: data.target_count != null ? (data.target_count as number) : null,
        unit: 'unit' in hExtra ? (hExtra.unit as string | null) : (existing?.unit ?? null),
        unitAmount: 'unitAmount' in hExtra ? (hExtra.unitAmount as number | null) : (existing?.unitAmount ?? null),
        challengeLengthDays: 'challengeLengthDays' in hExtra ? (hExtra.challengeLengthDays as number | null) : (existing?.challengeLengthDays ?? null),
        days: JSON.stringify(days),
        sortOrder: existing?.sortOrder ?? 0,
        // Immutable, so unlike the other extras it falls back to the
        // existing/local value (then updated_at) rather than dropping.
        createdAt: (hExtra.createdAt as string | undefined) ?? existing?.createdAt ?? updated_at,
        updatedAt: updated_at,
        deletedAt: deleted_at,
        syncedAt,
      };
      db.insert(habits)
        .values(row)
        .onConflictDoUpdate({ target: habits.id, set: { ...row, id: undefined, createdAt: undefined } as never })
        .run();
      break;
    }

    case 'habit_log': {
      const habitId = String(data.habit_id ?? '');
      const date = String(data.date ?? '');
      if (!habitId || !date) return;
      // Looked up by the recomputed deterministic id, not the wire entity's
      // own `id` — the upsert below always targets habitLogId(habitId,
      // date) regardless of what the server sent, so the LWW guard has to
      // check the SAME row it's about to write, or a server id that happens
      // to differ would miss the real local row entirely and let a stale
      // server value overwrite newer local progress unchecked (Greptile P1).
      const localId = habitLogId(habitId, date);
      const existing = db.select().from(habitHistory).where(eq(habitHistory.id, localId)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const value = Number(data.value ?? 0);
      db.insert(habitHistory)
        .values({
          id: localId,
          habitId,
          date,
          count: value,
          done: value > 0,
          updatedAt: updated_at,
          deletedAt: null,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: habitHistory.id,
          set: { count: value, done: value > 0, updatedAt: updated_at, syncedAt },
        })
        .run();
      break;
    }

    case 'meeting': {
      const existing = db.select().from(meeting).where(eq(meeting.id, id)).all()[0];
      if (existing && existing.updatedAt >= updated_at) return;
      const workspaceId = (data.workspace_id as string | null) ?? existing?.workspaceId;
      if (!workspaceId) return; // can't satisfy the NOT NULL FK — skip rather than crash
      const mExtra = (data.extra ?? {}) as Record<string, unknown>;
      const row = {
        id,
        workspaceId,
        title: String(data.title ?? ''),
        time: String(data.time ?? updated_at),
        durationMinutes: Number(data.duration_minutes ?? 0),
        trackMode: (data.track_mode as MeetingRow['trackMode']) ?? 'once',
        logged: Boolean(data.logged ?? false),
        loggedMinutes: data.logged_minutes != null ? Number(data.logged_minutes) : null,
        projectId: (data.project_id as string | null) ?? null,
        notes: String(mExtra.notes ?? ''),
        description: mExtra.description !== undefined ? String(mExtra.description) : null,
        recurringLabel: mExtra.recurringLabel ? String(mExtra.recurringLabel) : null,
        googleEventId: (data.google_event_id as string | null) ?? null,
        recurringEventId: mExtra.recurringEventId ? String(mExtra.recurringEventId) : null,
        calendarId: mExtra.calendarId ? String(mExtra.calendarId) : null,
        calendarName: mExtra.calendarName ? String(mExtra.calendarName) : null,
        calendarColor: mExtra.calendarColor ? String(mExtra.calendarColor) : null,
        createdAt: existing?.createdAt ?? updated_at,
        updatedAt: updated_at,
        deletedAt: deleted_at,
        syncedAt,
      };
      db.insert(meeting)
        .values(row)
        .onConflictDoUpdate({ target: meeting.id, set: { ...row, id: undefined, createdAt: undefined } as never })
        .run();
      break;
    }

    // 'device', 'user_setting', 'task_order', 'detection_rule': no local
    // table/handling for these yet (device is push-only even on extension;
    // the rest are documented gaps at the top of this file) — ignored, not
    // an error.
    default:
      break;
  }
}

// ─── Workspace normalization ────────────────────────────────────────────────
// Ported from extension's db.ts normalizeWorkspaces/migrateWorkspaceData.
// Every client seeds its OWN workspace on first run (db/client.ts's initDb)
// — with no server-side identity to converge on, a laptop's extension and a
// phone's fresh mobile install both end up pushing a same-named "Personal"
// workspace as a genuinely different row, and nothing before this reconciled
// them. This runs after every pull (when it can see workspaces other devices
// pushed) and merges same-named ones into the one with the lexicographically
// smallest id — deterministic, so every device converges on the same
// "winner" independently without needing to coordinate.
//
// Narrower than extension's port: mobile has no taskOrder table yet (task_order
// is a documented gap at the top of this file) and habits are user-global,
// not workspace-scoped (schema.ts) — so there's nothing habit- or
// priority-order-related to carry over, just the four workspace-scoped
// entity tables below.
function wsNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function migrateWorkspaceData(fromId: string, toId: string): boolean {
  const ts = nowIso();
  let moved = 0;
  moved += db.update(task).set({ workspaceId: toId, updatedAt: ts }).where(eq(task.workspaceId, fromId)).run().changes;
  moved += db.update(project).set({ workspaceId: toId, updatedAt: ts }).where(eq(project.workspaceId, fromId)).run().changes;
  moved += db.update(meeting).set({ workspaceId: toId, updatedAt: ts }).where(eq(meeting.workspaceId, fromId)).run().changes;
  moved += db
    .update(pomodoroSession)
    .set({ workspaceId: toId, updatedAt: ts })
    .where(eq(pomodoroSession.workspaceId, fromId))
    .run().changes;
  return moved > 0;
}

/** Merges same-named workspaces into the one with the smallest id and
 *  re-homes anything still pointing at a tombstoned workspace whose name has
 *  a living successor. Returns true when something changed (caller should
 *  push the result). */
function normalizeWorkspaces(): boolean {
  const all = db.select().from(workspace).all();
  const alive = all.filter(w => !w.deletedAt);
  let changed = false;

  const groups = new Map<string, typeof alive>();
  for (const w of alive) {
    const key = wsNameKey(w.name);
    const existing = groups.get(key);
    if (existing) existing.push(w);
    else groups.set(key, [w]);
  }

  const canonicalByName = new Map<string, (typeof alive)[number]>();
  for (const [key, group] of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const canonical = group[0];
    if (!canonical) continue;
    canonicalByName.set(key, canonical);
    for (const dup of group.slice(1)) {
      if (migrateWorkspaceData(dup.id, canonical.id)) changed = true;
      db.update(workspace).set({ deletedAt: nowIso(), updatedAt: nowIso() }).where(eq(workspace.id, dup.id)).run();
      changed = true;
    }
  }

  for (const dead of all.filter(w => w.deletedAt)) {
    const target = canonicalByName.get(wsNameKey(dead.name));
    if (!target || target.id === dead.id) continue;
    if (migrateWorkspaceData(dead.id, target.id)) changed = true;
  }

  return changed;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** One push+pull cycle. No-ops quietly if not signed in or API_URL isn't
 *  configured — callers don't need to check auth state first. Entitlement
 *  itself is enforced server-side (403 if the account isn't sync-eligible);
 *  this doesn't duplicate that check client-side. */
export async function syncNow(): Promise<void> {
  if (!API_URL) return;
  const supabase = getMobileSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  const client = new TokenApiClient(API_URL, session.access_token);
  // Scoped so the cursor can't outlive the account or the backend it was
  // issued by — switching either invalidates it into a full pull.
  const scope = pullScope(session.user.id, API_URL);

  // A device with local data signing into an account for the first time has
  // to say whether to combine the two or take the account's copy. Gating
  // here rather than at the call sites is the point: every automatic trigger
  // (mutation debounce, foreground, cold start, 60s poll, background fetch)
  // funnels through this one function, and any of them merging while the
  // dialog is still open would decide the question for the user.
  if (needsSyncChoice(scope)) {
    requestSyncChoice(scope);
    return;
  }

  await push(client);
  await pull(client, scope);
  // Same-named workspaces from other installs/devices converge into one
  // canonical id; if that moved anything, push the result right away
  // (mirrors extension's syncAll).
  if (normalizeWorkspaces()) {
    await push(client);
  }
}

/** Records the user's answer to the first-sign-in question and syncs.
 *
 *  'cloud' erases local rows *before* the first push, which is the whole
 *  point — pushing first would put them in the account and make the choice
 *  meaningless. The pull cursor is left alone: it is already scoped to this
 *  account and backend, so a first sign-in has none to reuse and the pull
 *  that follows is a full one. */
export async function resolveSyncChoiceAndSync(scope: string, choice: SyncChoice): Promise<void> {
  if (choice === 'cloud') discardLocalData();
  recordSyncChoice(scope, choice);
  resolveSyncChoice();
  await syncNow();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced, error-swallowing trigger for automatic sync points (every
 *  mutation call site, matching extension's own ~25 triggerSync() calls
 *  throughout App.tsx; also foreground/background-fetch triggers, Fase
 *  B5b). Same 1.5s window as extension's triggerSync — batches rapid
 *  changes (e.g. typing in a text field) into one push instead of one per
 *  keystroke. Deliberately silent on failure (network offline, not signed
 *  in, not entitled) — an automatic background trigger popping an error
 *  Alert would be wrong UX; the manual "Sync now" button in Settings calls
 *  syncNow() directly instead, so it can surface a real failure to the user
 *  who explicitly asked for it. */
export function triggerSync(debounceMs = 1500): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow().catch(err => console.warn('[sync] triggerSync failed', err));
  }, debounceMs);
}
