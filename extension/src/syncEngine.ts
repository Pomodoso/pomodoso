import { TokenApiClient, pushEntities, pullEntities } from '@pomodoso/api';
import type { SyncEntity } from '@pomodoso/api';
import { db, now, setApplyingRemote, getDeviceId, normalizeWorkspaces, habitLogId } from './db';
import { ensureFreshSession } from './supabaseClient';
import type {
  TaskRow, ProjectRow, WorkspaceRow,
  HabitRow, HabitHistoryRow, TaskOrderRow, TimeLogEntry, DetectionRuleRow,
} from './db';
import type { TimerMode } from '@pomodoso/types';

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

export type SyncStatus = 'disconnected' | 'connected' | 'syncing' | 'offline' | 'error';

// ─── Module-level sync config (set by initSync) ────────────────────────────────
let _config: { token: string; apiUrl: string } | null = null;
let _onStatus: ((s: SyncStatus) => void) | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function initSync(
  token: string,
  apiUrl: string,
  onStatus: (s: SyncStatus) => void,
) {
  _config = { token, apiUrl };
  _onStatus = onStatus;
}

export function clearSync() {
  _config = null;
  _onStatus = null;
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
}

/** Debounced — batches rapid changes (1.5s window).
 *
 *  Also hands the request to the background service worker: the popup dies the
 *  moment the user clicks away, killing this debounce timer — the background
 *  copy survives and guarantees the push happens. */
export function triggerSync(debounceMs = 1500) {
  if (!_config) return;
  notifyBackgroundSync();
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    runSync();
  }, debounceMs);
}

function notifyBackgroundSync() {
  try {
    chrome.runtime.sendMessage({ type: 'sync.request' }).catch(() => {});
  } catch { /* not in an extension context (tests) */ }
}

/** Immediate sync — for Sync Now button. */
export function syncNow() {
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  runSync();
}

/** Network failures (no internet / server unreachable) are not errors the user
 *  should worry about — data stays local and sync retries later. */
function classifyError(err: unknown): SyncStatus {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';
  if (err instanceof TypeError) return 'offline'; // fetch network failure
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return 'offline';
  return 'error';
}

function runSync() {
  if (!_config || !_onStatus) return;
  const { token, apiUrl } = _config;
  _onStatus('syncing');
  void syncAll(token, apiUrl)
    .then(() => _onStatus?.('connected'))
    .catch((err) => {
      console.warn('[sync]', err);
      _onStatus?.(classifyError(err));
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function syncAll(
  accessToken: string,
  apiUrl: string,
): Promise<void> {
  const client = new TokenApiClient(apiUrl, accessToken);
  await push(client);
  await pull(client);
  // Same-named workspaces from other installs / imports converge into one
  // canonical id; if that moved anything, push the result right away.
  if (await normalizeWorkspaces()) {
    await push(client);
  }
}

/** Self-configuring sync for the background service worker. Refreshes the
 *  session if it's near expiry (keeping the extension signed in even with the
 *  popup closed) and reads entitlements from IndexedDB. Returns false when sync
 *  isn't possible (signed out, no entitlement) — the token is still refreshed in
 *  that case, which is what keeps Free users logged in. */
export async function performBackgroundSync(): Promise<boolean> {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (!apiUrl) return false;

  const session = await ensureFreshSession();
  if (!session?.access_token) return false;

  const ent = (await db.settings.get('entitlements'))?.value as
    | { features?: { sync?: boolean } }
    | undefined;
  if (!ent?.features?.sync) return false;

  await syncAll(session.access_token, apiUrl);
  return true;
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
  const deviceId = await getDeviceId();
  const entity: SyncEntity = {
    table: 'user_setting',
    id: settingId('active_timer'),
    data: {
      key: 'active_timer',
      value: { started_at: startedAt, mode, task_id: taskId, timezone, duration_seconds: durationSeconds, device_id: deviceId },
    },
    updated_at: now(),
    deleted_at: null,
  };
  await pushEntities(client, { entities: [entity] }).catch(() => {});
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
  await pushEntities(client, { entities: [entity] }).catch(() => {});
}

// ─── Push ─────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function push(client: TokenApiClient): Promise<void> {
  const entities: SyncEntity[] = [];

  // Tasks/habits with no workspace get pushed under a deterministic fallback:
  // the oldest (lowest-id) non-deleted workspace.
  const allWorkspaces = (await db.workspaces.filter(w => !w.deletedAt && UUID_RE.test(w.id)).toArray())
    .sort((a, b) => a.id.localeCompare(b.id));
  const fallbackWsId = allWorkspaces[0]?.id;

  // Workspaces (including tombstoned ones — deletions must propagate)
  const workspaces = await db.workspaces
    .filter(w => UUID_RE.test(w.id) && (!w.syncedAt || w.syncedAt < w.updatedAt))
    .toArray();
  for (const w of workspaces) {
    entities.push(toEntity('workspace', w.id, w.updatedAt, w.deletedAt ?? null, {
      name: w.name, color: w.color,
    }));
  }

  if (!fallbackWsId) {
    // No valid workspace yet (first run before the default-ws UUID migration) —
    // push nothing workspace-scoped; next sync picks it up.
    if (entities.length) await pushEntities(client, { entities });
    return;
  }

  const wsOf = (id: string | null | undefined): string =>
    id && UUID_RE.test(id) ? id : fallbackWsId;

  // Projects
  const projects = await db.projects
    .filter(p => !p.syncedAt || p.syncedAt < p.updatedAt)
    .toArray();
  for (const p of projects) {
    entities.push(toEntity('project', p.id, p.updatedAt, p.deletedAt ?? null, {
      name: p.name, color: p.color, workspace_id: wsOf(p.workspaceId),
      end_date: p.endDate ?? null,
    }));
  }

  // Tasks + their time logs (pomodoro sessions)
  const deviceId = await getDeviceId();
  const tasks = await db.tasks
    .filter(t => !t.syncedAt || t.syncedAt < t.updatedAt)
    .toArray();
  for (const t of tasks) {
    const ws = wsOf(t.workspaceId);
    entities.push(toEntity('task', t.id, t.updatedAt, t.deletedAt ?? null, {
      title: t.title, status: t.status, notes: t.notes ?? '',
      workspace_id: ws,
      project_id: t.projectId ?? null,
      parent_id: t.parentId ?? null,
      ticket_id: t.ticketId ?? null,
      extra: taskExtra(t),
    }));
    for (const log of t.timeLogs ?? []) {
      if (!UUID_RE.test(log.id)) continue;
      entities.push(toEntity('pomodoro_session', log.id, log.startedAt, null, {
        workspace_id: ws,
        task_id: t.id,
        ticket_id: t.ticketId ?? null,
        mode: log.mode,
        started_at: log.startedAt,
        duration_seconds: log.durationSeconds,
        kind: 'focus',
        status: 'completed',
        device_id: deviceId,
      }));
    }
  }

  // Habits
  const habits = await db.habits
    .filter(h => !h.syncedAt || h.syncedAt < h.updatedAt)
    .toArray();
  // Habits are user-global — not pinned to a workspace.
  for (const h of habits) {
    entities.push(toEntity('habit', h.id, h.updatedAt, h.deletedAt ?? null, {
      name: h.name, icon: h.icon, kind: h.kind,
      target_count: h.goal ?? null,
      workspace_id: h.workspaceId ?? null,
      extra: habitExtra(h),
      ...habitFrequency(h.days),
    }));
  }

  // Habit history (user-global)
  const history = await db.habitHistory
    .filter(r => !r.syncedAt || r.syncedAt < r.updatedAt)
    .toArray();
  for (const r of history) {
    // Always recompute the id from (habit, date) — heals any stored id that
    // predates the collision fix so it can't keep colliding on the server PK.
    const id = habitLogId(r.habitId, r.date);
    if (r.id !== id) await db.habitHistory.put({ ...r, id });
    entities.push(toEntity('habit_log', id, r.updatedAt, null, {
      habit_id: r.habitId, date: r.date,
      value: r.count ?? (r.done ? 1 : 0),
      completed_at: r.completedAt ?? null,
    }));
  }

  // Task orders (Today/Priorities membership — one row per workspace)
  const orders = await db.taskOrders
    .filter(o => UUID_RE.test(o.wsId) && (!o.syncedAt || !o.updatedAt || o.syncedAt < o.updatedAt))
    .toArray();
  for (const o of orders) {
    entities.push(toEntity('task_order', o.wsId, o.updatedAt, null, {
      workspace_id: o.wsId,
      priority_ids: o.priorityIds,
      today_ids: o.todayIds,
    }));
  }

  // Detection rules (user-global) — string ids, never gated through UUID_RE
  const rules = await db.detectionRules
    .filter(r => !r.syncedAt || r.syncedAt < r.updatedAt)
    .toArray();
  for (const r of rules) {
    entities.push(toEntity('detection_rule', r.id, r.updatedAt, r.deletedAt ?? null, {
      name: r.name, url_pattern: r.urlPattern, active: r.active,
      kind: r.kind, preset_id: r.presetId ?? null,
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

  // Device heartbeat — registers this install and reports version + last sync
  entities.push(toEntity('device', deviceId, now(), null, {
    kind: 'extension',
    name: detectBrowser(),
    browser: detectBrowser(),
    version: typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '',
    synced: true,
  }));

  await pushEntities(client, { entities });

  // Mark all as synced
  const ts = now();
  setApplyingRemote(true);
  try {
    if (workspaces.length) await db.workspaces.where('id').anyOf(workspaces.map(w => w.id)).modify({ syncedAt: ts });
    if (projects.length)   await db.projects.where('id').anyOf(projects.map(p => p.id)).modify({ syncedAt: ts });
    if (tasks.length)      await db.tasks.where('id').anyOf(tasks.map(t => t.id)).modify({ syncedAt: ts });
    if (habits.length)     await db.habits.where('id').anyOf(habits.map(h => h.id)).modify({ syncedAt: ts });
    if (rules.length)      await db.detectionRules.where('id').anyOf(rules.map(r => r.id)).modify({ syncedAt: ts });
    for (const r of history) {
      await db.habitHistory.where('[habitId+date]').equals([r.habitId, r.date]).modify({ syncedAt: ts });
    }
    for (const o of orders) {
      await db.taskOrders.where('wsId').equals(o.wsId).modify({ syncedAt: ts });
    }
    for (const key of SYNCED_SETTINGS) {
      await db.settings.put({ key: `${key}_synced_at`, value: ts });
    }
  } finally {
    setApplyingRemote(false);
  }
}

function taskExtra(t: TaskRow): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (t.description !== undefined) extra['description'] = t.description;
  if (t.links?.length) extra['links'] = t.links;
  if (t.noteEntries?.length) extra['noteEntries'] = t.noteEntries;
  if (t.preferredMode) extra['preferredMode'] = t.preferredMode;
  if (t.recurrence) extra['recurrence'] = t.recurrence;
  if (t.completedDates?.length) extra['completedDates'] = t.completedDates;
  return extra;
}

function habitExtra(h: HabitRow): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (h.unit !== undefined) extra['unit'] = h.unit;
  if (h.unitAmount !== undefined) extra['unitAmount'] = h.unitAmount;
  return extra;
}

function detectBrowser(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Brave/.test(ua)) return 'Brave';
  if (/Arc\//.test(ua)) return 'Arc';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pull(client: TokenApiClient): Promise<void> {
  const sinceRow = await db.settings.get(SYNC_LAST_PULL_KEY);
  const since = sinceRow?.value as string | undefined;

  const response = await pullEntities(client, since);

  setApplyingRemote(true);
  try {
    for (const entity of response.entities) {
      await applyEntity(entity);
    }
  } finally {
    setApplyingRemote(false);
  }

  await db.settings.put({ key: SYNC_LAST_PULL_KEY, value: response.server_time });
}

async function applyEntity(entity: SyncEntity): Promise<void> {
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
      const endDate = (data['end_date'] as string | null) ?? null;
      const row: ProjectRow = {
        id,
        name: String(data['name'] ?? ''),
        color: String(data['color'] ?? '#6366f1'),
        workspaceId: (data['workspace_id'] as string | null) ?? null,
        ...(endDate ? { endDate } : {}),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.projects.put(row);
      break;
    }

    case 'task': {
      const existing = await db.tasks.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const extra = (data['extra'] ?? {}) as Record<string, unknown>;
      const description = (extra['description'] as string | undefined) ?? existing?.description;
      const links = (extra['links'] as TaskRow['links']) ?? existing?.links;
      const noteEntries = (extra['noteEntries'] as TaskRow['noteEntries']) ?? existing?.noteEntries;
      const preferredMode = (extra['preferredMode'] as TaskRow['preferredMode']) ?? existing?.preferredMode;
      const recurrence = (extra['recurrence'] as TaskRow['recurrence']) ?? existing?.recurrence;
      const completedDates = (extra['completedDates'] as string[] | undefined) ?? existing?.completedDates;
      const row: TaskRow = {
        ...(existing ?? {}),
        id,
        title: String(data['title'] ?? ''),
        status: (data['status'] as TaskRow['status']) ?? 'todo',
        notes: String(data['notes'] ?? ''),
        workspaceId: (data['workspace_id'] as string | null) ?? null,
        projectId: (data['project_id'] as string | null) ?? null,
        parentId: (data['parent_id'] as string | null) ?? null,
        ticketId: (data['ticket_id'] as string | null) ?? null,
        ...(description !== undefined ? { description } : {}),
        ...(links !== undefined ? { links } : {}),
        ...(noteEntries !== undefined ? { noteEntries } : {}),
        ...(preferredMode !== undefined ? { preferredMode } : {}),
        ...(recurrence !== undefined ? { recurrence } : {}),
        ...(completedDates !== undefined ? { completedDates } : {}),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.tasks.put(row);
      break;
    }

    case 'pomodoro_session': {
      // Sessions from other devices merge into the owning task's timeLogs.
      const taskId = data['task_id'] as string | null;
      if (!taskId) return;
      const task = await db.tasks.get(taskId);
      if (!task) return;
      if ((task.timeLogs ?? []).some(l => l.id === id)) return;
      const entry: TimeLogEntry = {
        id,
        startedAt: String(data['started_at'] ?? updated_at),
        durationSeconds: Number(data['duration_seconds'] ?? 0),
        mode: ((data['mode'] as TimerMode) ?? 'pomodoro'),
      };
      const timeLogs = [...(task.timeLogs ?? []), entry]
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      // Deliberately not bumping updatedAt: merging remote sessions must not
      // mark the task dirty (the session is already on the server).
      await db.tasks.update(taskId, { timeLogs });
      break;
    }

    case 'task_order': {
      const existing = await db.taskOrders.get(id);
      if (existing?.updatedAt && existing.updatedAt >= updated_at) return;
      const row: TaskOrderRow = {
        wsId: id,
        priorityIds: ((data['priority_ids'] as string[]) ?? []),
        todayIds: ((data['today_ids'] as string[]) ?? []),
        updatedAt: updated_at,
        syncedAt,
      };
      await db.taskOrders.put(row);
      break;
    }

    case 'habit': {
      const existing = await db.habits.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const days = habitDaysFromServer(
        String(data['frequency'] ?? 'daily'),
        data['frequency_days'] as string | null | undefined,
      );
      const goal = (data['target_count'] as number | null) ?? existing?.goal;
      const hExtra = (data['extra'] ?? {}) as Record<string, unknown>;
      const unit = (hExtra['unit'] as string | undefined) ?? existing?.unit;
      const unitAmount = (hExtra['unitAmount'] as number | undefined) ?? existing?.unitAmount;
      const row: HabitRow = {
        ...(existing ?? {}),
        id,
        name: String(data['name'] ?? ''),
        icon: (data['icon'] as HabitRow['icon']) ?? 'water',
        kind: (data['kind'] as HabitRow['kind']) ?? 'boolean',
        ...(goal !== undefined ? { goal } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(unitAmount !== undefined ? { unitAmount } : {}),
        days,
        streakLabel: existing?.streakLabel ?? '',
        workspaceId: (data['workspace_id'] as string | null) ?? null,
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
      const completedAt = (data['completed_at'] as string | null) ?? undefined;
      const row: HabitHistoryRow = {
        id,
        habitId, date,
        count: value,
        done: value > 0,
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: updated_at, syncedAt,
      };
      await db.habitHistory.put(row);
      break;
    }

    case 'detection_rule': {
      const existing = await db.detectionRules.get(id);
      if (existing && existing.updatedAt >= updated_at) return;
      const row: DetectionRuleRow = {
        id,
        name: String(data['name'] ?? ''),
        urlPattern: String(data['url_pattern'] ?? ''),
        active: Boolean(data['active'] ?? true),
        kind: (data['kind'] as DetectionRuleRow['kind']) ?? 'custom',
        ...(data['preset_id'] ? { presetId: String(data['preset_id']) } : {}),
        updatedAt: updated_at, syncedAt,
        ...(deleted_at ? { deletedAt: deleted_at } : {}),
      };
      await db.detectionRules.put(row);
      break;
    }

    case 'user_setting': {
      const key = String(data['key'] ?? '');
      if (!key) return;
      const value = data['value'];

      if (key === 'active_timer') {
        // Store as a local setting so the popup can show "running on another device"
        if (deleted_at || value === null) {
          await db.settings.delete('active_timer_remote');
        } else {
          const beaconDevice = (value as { device_id?: string }).device_id;
          if (beaconDevice && beaconDevice === await getDeviceId()) {
            // Our own beacon echoed back — not a remote timer
            await db.settings.delete('active_timer_remote');
            return;
          }
          const existing = await db.settings.get('active_timer_remote');
          const existingUpdatedAt = (existing?.value as { updated_at?: string } | undefined)?.updated_at;
          if (!existingUpdatedAt || existingUpdatedAt < updated_at) {
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
