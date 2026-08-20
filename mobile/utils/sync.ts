import type { SyncEntity } from '@pomodoso/api';
import { pullEntities, pushEntities, TokenApiClient } from '@pomodoso/api';
import { and, eq, isNull, or, lt, isNotNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { habits, habitHistory, pomodoroSession, project, settings, task, workspace } from '@/db/schema';
import { API_URL, getMobileSupabase } from '@/lib/supabase';
import { uid, habitLogId } from '@/utils/id';

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

// Ported verbatim from extension's syncEngine.ts.
function habitFrequency(days: number[]): { frequency: string; frequency_days: string | null } {
  if (!days || days.length === 0 || days.length === 7) return { frequency: 'daily', frequency_days: null };
  if (days.length === 5 && days.every((d, i) => d === i)) return { frequency: 'weekdays', frequency_days: null };
  return { frequency: 'custom', frequency_days: JSON.stringify(days) };
}

function habitDaysFromServer(frequency: string, frequencyDays?: string | null): number[] {
  if (frequency === 'daily') return [];
  if (frequency === 'weekdays') return [0, 1, 2, 3, 4];
  if (frequencyDays) {
    try {
      return JSON.parse(frequencyDays) as number[];
    } catch {
      return [];
    }
  }
  return [];
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
  if (t.description != null) extra.description = t.description;
  const links = parseJsonArray(t.links);
  if (links.length) extra.links = links;
  const noteEntries = parseJsonArray(t.noteEntries);
  if (noteEntries.length) extra.noteEntries = noteEntries;
  if (t.recurrence) extra.recurrence = JSON.parse(t.recurrence) as unknown;
  const completedDates = parseJsonArray(t.completedDates);
  if (completedDates.length) extra.completedDates = completedDates;
  return extra;
}

function habitExtra(h: typeof habits.$inferSelect): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (h.createdAt) extra.createdAt = h.createdAt;
  if (h.unit != null) extra.unit = h.unit;
  if (h.unitAmount != null) extra.unitAmount = h.unitAmount;
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
    const durationSeconds = Math.round((new Date(s.endedAt!).getTime() - new Date(s.startedAt).getTime()) / 1000);
    entities.push(
      toEntity('pomodoro_session', s.id, s.updatedAt, null, {
        workspace_id: s.workspaceId,
        task_id: s.taskId,
        ticket_id: null,
        mode: s.mode,
        started_at: s.startedAt,
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
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pull(client: TokenApiClient): Promise<void> {
  const since = getSetting(SYNC_LAST_PULL_KEY);
  const response = await pullEntities(client, since ? (JSON.parse(since) as string) : undefined);

  for (const entity of response.entities) {
    applyEntity(entity);
  }

  putSetting(SYNC_LAST_PULL_KEY, JSON.stringify(response.server_time));
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
          createdAt: existing?.createdAt ?? updated_at,
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

    // 'device', 'user_setting', 'task_order', 'meeting', 'detection_rule':
    // no local table/handling for these yet (device is push-only even on
    // extension; the rest are documented gaps at the top of this file) —
    // ignored, not an error.
    default:
      break;
  }
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
  await push(client);
  await pull(client);
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
