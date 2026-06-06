import { TokenApiClient, pushEntities, pullEntities } from '@pomodoso/api';
import type { SyncEntity } from '@pomodoso/api';
import { db, now } from './db';
import type {
  TaskRow, ProjectRow, WorkspaceRow,
  HabitRow, HabitHistoryRow,
} from './db';

// ─── Settings keys synced to server ───────────────────────────────────────────
const SYNCED_SETTINGS = [
  'timer_settings',
  'sound_settings',
  'timezone',
  'max_priorities',
  'week_start',
  'work_days',
] as const;

const SYNC_LAST_PULL_KEY = 'sync_last_pull';

export type SyncStatus = 'disconnected' | 'connected' | 'syncing' | 'error';

// ─── Module-level sync config (set by initSync) ────────────────────────────────
let _config: { token: string; wsId: string; apiUrl: string } | null = null;
let _onStatus: ((s: SyncStatus) => void) | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initSync(
  token: string,
  wsId: string,
  apiUrl: string,
  onStatus: (s: SyncStatus) => void,
) {
  _config = { token, wsId, apiUrl };
  _onStatus = onStatus;
}

export function clearSync() {
  _config = null;
  _onStatus = null;
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
}

/** Debounced — batches rapid changes (1.5s window). */
export function triggerSync(debounceMs = 1500) {
  if (!_config) return;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    runSync();
  }, debounceMs);
}

/** Immediate sync — for Sync Now button. */
export function syncNow() {
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  runSync();
}

function runSync() {
  if (!_config || !_onStatus) return;
  const { token, wsId, apiUrl } = _config;
  _onStatus('syncing');
  void syncAll(token, wsId, apiUrl)
    .then(() => _onStatus?.('connected'))
    .catch((err) => {
      console.error('[sync]', err);
      _onStatus?.('error');
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function syncAll(
  accessToken: string,
  workspaceId: string,
  apiUrl: string,
): Promise<void> {
  const client = new TokenApiClient(apiUrl, accessToken);
  await push(client, workspaceId);
  await pull(client, workspaceId);
}

/** Push active timer beacon immediately (no debounce). */
export async function pushActiveTimer(
  startedAt: string,
  mode: string,
  taskId: string | null,
  timezone: string,
  durationSeconds: number | null,
) {
  if (!_config) return;
  const client = new TokenApiClient(_config.apiUrl, _config.token);
  const entity: SyncEntity = {
    table: 'user_setting',
    id: settingId('active_timer'),
    data: {
      key: 'active_timer',
      value: { started_at: startedAt, mode, task_id: taskId, timezone, duration_seconds: durationSeconds },
    },
    updated_at: now(),
    deleted_at: null,
  };
  await pushEntities(client, { workspace_id: _config.wsId, entities: [entity] }).catch(() => {});
}

/** Clear active timer beacon on stop. */
export async function clearActiveTimer() {
  if (!_config) return;
  const client = new TokenApiClient(_config.apiUrl, _config.token);
  const entity: SyncEntity = {
    table: 'user_setting',
    id: settingId('active_timer'),
    data: { key: 'active_timer', value: null },
    updated_at: now(),
    deleted_at: now(),
  };
  await pushEntities(client, { workspace_id: _config.wsId, entities: [entity] }).catch(() => {});
}

// ─── Push ─────────────────────────────────────────────────────────────────────

async function push(client: TokenApiClient, workspaceId: string): Promise<void> {
  const entities: SyncEntity[] = [];

  // Workspaces
  const workspaces = await db.workspaces
    .filter(w => !w.syncedAt || w.syncedAt < w.updatedAt)
    .toArray();
  for (const w of workspaces) {
    entities.push(toEntity('workspace', w.id, w.updatedAt, w.deletedAt ?? null, {
      name: w.name, color: w.color,
    }));
  }

  // Projects
  const projects = await db.projects
    .filter(p => !p.syncedAt || p.syncedAt < p.updatedAt)
    .toArray();
  for (const p of projects) {
    entities.push(toEntity('project', p.id, p.updatedAt, p.deletedAt ?? null, {
      name: p.name, color: p.color, workspace_id: p.workspaceId ?? workspaceId,
    }));
  }

  // Tasks
  const tasks = await db.tasks
    .filter(t => !t.syncedAt || t.syncedAt < t.updatedAt)
    .toArray();
  for (const t of tasks) {
    entities.push(toEntity('task', t.id, t.updatedAt, t.deletedAt ?? null, {
      title: t.title, status: t.status, notes: t.notes ?? '',
      workspace_id: t.workspaceId ?? workspaceId,
      project_id: t.projectId ?? null,
      parent_id: t.parentId ?? null,
      ticket_id: t.ticketId ?? null,
    }));
  }

  // Habits
  const habits = await db.habits
    .filter(h => !h.syncedAt || h.syncedAt < h.updatedAt)
    .toArray();
  for (const h of habits) {
    entities.push(toEntity('habit', h.id, h.updatedAt, h.deletedAt ?? null, {
      name: h.name, icon: h.icon, kind: h.kind,
      target_count: h.goal ?? null,
      workspace_id: h.workspaceId ?? workspaceId,
      ...habitFrequency(h.days),
    }));
  }

  // Habit history
  const history = await db.habitHistory
    .filter(r => !r.syncedAt || r.syncedAt < r.updatedAt)
    .toArray();
  for (const r of history) {
    const id = r.id ?? habitLogId(r.habitId, r.date);
    if (!r.id) await db.habitHistory.put({ ...r, id });
    entities.push(toEntity('habit_log', id, r.updatedAt, null, {
      habit_id: r.habitId, date: r.date,
      value: r.count ?? (r.done ? 1 : 0),
      completed_at: r.completedAt ?? null,
      workspace_id: workspaceId,
    }));
  }

  // Settings
  for (const key of SYNCED_SETTINGS) {
    const row = await db.settings.get(key);
    if (!row) continue;
    const syncedRow = await db.settings.get(`${key}_synced_at`);
    const syncedAt = syncedRow?.value as string | undefined;
    const updatedRow = await db.settings.get(`${key}_updated_at`);
    const updatedAt = (updatedRow?.value as string | undefined) ?? now();
    if (syncedAt && syncedAt >= updatedAt) continue;
    entities.push(toEntity('user_setting', settingId(key), updatedAt, null, {
      key, value: row.value,
    }));
  }

  if (entities.length === 0) return;

  await pushEntities(client, { workspace_id: workspaceId, entities });

  // Mark all as synced
  const ts = now();
  if (workspaces.length) await db.workspaces.where('id').anyOf(workspaces.map(w => w.id)).modify({ syncedAt: ts });
  if (projects.length)   await db.projects.where('id').anyOf(projects.map(p => p.id)).modify({ syncedAt: ts });
  if (tasks.length)      await db.tasks.where('id').anyOf(tasks.map(t => t.id)).modify({ syncedAt: ts });
  if (habits.length)     await db.habits.where('id').anyOf(habits.map(h => h.id)).modify({ syncedAt: ts });
  for (const r of history) {
    await db.habitHistory.where('[habitId+date]').equals([r.habitId, r.date]).modify({ syncedAt: ts });
  }
  for (const key of SYNCED_SETTINGS) {
    await db.settings.put({ key: `${key}_synced_at`, value: ts });
  }
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pull(client: TokenApiClient, workspaceId: string): Promise<void> {
  const sinceRow = await db.settings.get(SYNC_LAST_PULL_KEY);
  const since = sinceRow?.value as string | undefined;

  const response = await pullEntities(client, workspaceId, since);

  for (const entity of response.entities) {
    await applyEntity(entity, workspaceId);
  }

  await db.settings.put({ key: SYNC_LAST_PULL_KEY, value: response.server_time });
}

async function applyEntity(entity: SyncEntity, fallbackWsId: string): Promise<void> {
  const { table, id, data, updated_at, deleted_at } = entity;
  const syncedAt = updated_at;

  switch (table) {
    case 'workspace': {
      const existing = await db.workspaces.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const row: WorkspaceRow = {
        id,
        name: String(data['name'] ?? 'Workspace'),
        color: String(data['color'] ?? '#6366f1'),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.workspaces.put(row);
      break;
    }

    case 'project': {
      const existing = await db.projects.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const row: ProjectRow = {
        id,
        name: String(data['name'] ?? ''),
        color: String(data['color'] ?? '#6366f1'),
        workspaceId: String(data['workspace_id'] ?? fallbackWsId),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.projects.put(row);
      break;
    }

    case 'task': {
      const existing = await db.tasks.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const row: TaskRow = {
        ...(existing ?? {}),
        id,
        title: String(data['title'] ?? ''),
        status: (data['status'] as TaskRow['status']) ?? 'todo',
        notes: String(data['notes'] ?? ''),
        workspaceId: String(data['workspace_id'] ?? fallbackWsId),
        projectId: (data['project_id'] as string | null) ?? null,
        parentId: (data['parent_id'] as string | null) ?? null,
        ticketId: (data['ticket_id'] as string | null) ?? null,
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.tasks.put(row);
      break;
    }

    case 'habit': {
      const existing = await db.habits.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const days = habitDaysFromServer(
        String(data['frequency'] ?? 'daily'),
        data['frequency_days'] as string | null | undefined,
      );
      const row: HabitRow = {
        ...(existing ?? {}),
        id,
        name: String(data['name'] ?? ''),
        icon: (data['icon'] as HabitRow['icon']) ?? 'water',
        kind: (data['kind'] as HabitRow['kind']) ?? 'boolean',
        goal: (data['target_count'] as number | null) ?? undefined,
        days,
        streakLabel: existing?.streakLabel ?? '',
        workspaceId: String(data['workspace_id'] ?? fallbackWsId),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.habits.put(row);
      break;
    }

    case 'habit_log': {
      const habitId = String(data['habit_id'] ?? '');
      const date = String(data['date'] ?? '');
      if (!habitId || !date) return;
      const existing = await db.habitHistory.get([habitId, date]);
      if (existing && existing.updatedAt >= updated_at) return;
      const value = Number(data['value'] ?? 0);
      const row: HabitHistoryRow = {
        id,
        habitId, date,
        count: value,
        done: value > 0,
        completedAt: (data['completed_at'] as string | null) ?? undefined,
        updatedAt: updated_at, syncedAt,
      };
      await db.habitHistory.put(row);
      break;
    }

    case 'user_setting': {
      const key = String(data['key'] ?? '');
      if (!key) return;
      const value = data['value'];

      if (key === 'active_timer') {
        // Store as a local setting for the timer to check on open
        if (deleted_at || value === null) {
          await db.settings.delete('active_timer_remote');
        } else {
          const existing = await db.settings.get('active_timer_remote');
          if (!existing || (existing.value as { updated_at?: string })?.updated_at < updated_at) {
            await db.settings.put({ key: 'active_timer_remote', value: { ...value as object, updated_at } });
          }
        }
        return;
      }

      // Generic settings key — only apply if server version is newer
      if (!(SYNCED_SETTINGS as readonly string[]).includes(key)) return;
      const existingSyncedAt = (await db.settings.get(`${key}_synced_at`))?.value as string | undefined;
      if (existingSyncedAt && existingSyncedAt >= updated_at) return;
      await db.settings.put({ key, value });
      await db.settings.put({ key: `${key}_synced_at`, value: updated_at });
      break;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toEntity(
  table: string, id: string, updatedAt: string | undefined,
  deletedAt: string | null | undefined, data: Record<string, unknown>,
): SyncEntity {
  // Guard against old IndexedDB rows that predate the SyncMeta fields:
  // undefined updatedAt → JSON.stringify omits the key → serde "missing field" → 422.
  return { table, id, data, updated_at: updatedAt ?? now(), deleted_at: deletedAt ?? null };
}

function habitFrequency(days: number[]): { frequency: string; frequency_days: string | null } {
  if (!days || days.length === 0 || days.length === 7)
    return { frequency: 'daily', frequency_days: null };
  if (days.length === 5 && days.every((d, i) => d === i))
    return { frequency: 'weekdays', frequency_days: null };
  return { frequency: 'custom', frequency_days: JSON.stringify(days) };
}

function habitDaysFromServer(frequency: string, frequencyDays?: string | null): number[] {
  if (frequency === 'daily') return [];
  if (frequency === 'weekdays') return [0, 1, 2, 3, 4];
  if (frequencyDays) {
    try { return JSON.parse(frequencyDays) as number[]; } catch { return []; }
  }
  return [];
}

function habitLogId(habitId: string, date: string): string {
  const clean = (habitId + date.replace(/-/g, '')).replace(/-/g, '');
  const padded = clean.padEnd(32, '0').substring(0, 32);
  return `${padded.substring(0,8)}-${padded.substring(8,12)}-5${padded.substring(13,16)}-8${padded.substring(17,20)}-${padded.substring(20,32)}`;
}

function settingId(key: string): string {
  // Encode key as hex bytes so the UUID only contains valid hex chars (0-9, a-f).
  // Keys like "timer_settings" have non-hex chars ('t','i','_') that cause a 422
  // from the backend's uuid::Uuid deserializer if used directly.
  const hex = Array.from(key)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(32, '0')
    .substring(0, 32);
  return `${hex.substring(0,8)}-${hex.substring(8,12)}-5${hex.substring(13,16)}-8${hex.substring(17,20)}-${hex.substring(20,32)}`;
}
