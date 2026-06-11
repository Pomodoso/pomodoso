import Dexie, { type Table } from 'dexie';
import type { TimerMode, DetectionRule, SoundSettings, TimerSettings, RecurrenceRule } from '@pomodoso/types';
import { DEFAULT_TIMER_SETTINGS, DEFAULT_SOUND_SETTINGS } from '@pomodoso/types';
export type { RecurrenceRule };

// ─── Sync meta ────────────────────────────────────────────────────────────────
// Every syncable row carries these fields. When sync is activated (Phase 2),
// the engine reads WHERE syncedAt IS NULL OR syncedAt < updatedAt.
export interface SyncMeta {
  updatedAt: string;   // ISO — Last-Write-Wins authority
  deletedAt?: string;  // tombstone: soft-delete only, never physical DELETE
  syncedAt?: string;   // undefined = dirty (not yet pushed to backend)
}

export function now(): string {
  return new Date().toISOString();
}

// Returns YYYY-MM-DD in the given IANA timezone (e.g. 'America/Argentina/Buenos_Aires').
// daysOffset shifts by that many days before formatting (negative = past).
export function localDate(tz: string, daysOffset = 0): string {
  const d = daysOffset ? new Date(Date.now() + daysOffset * 86400_000) : new Date();
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

// ─── Task types ────────────────────────────────────────────────────────────────
export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'delayed' | 'cancelled';

export interface TaskLink {
  url: string;
  label: string;
}

export interface TimeLogEntry {
  id: string;
  startedAt: string;
  durationSeconds: number;
  mode: TimerMode;
}

export interface NoteEntry {
  id: string;
  createdAt: string;  // ISO
  content: string;
}

export interface TaskRow extends SyncMeta {
  id: string;
  title: string;
  ticketId: string | null;
  projectId: string | null;
  workspaceId: string | null;
  status: TaskStatus;
  preferredMode?: TimerMode;
  links?: TaskLink[];
  description?: string;
  notes?: string;        // legacy — superseded by noteEntries
  noteEntries?: NoteEntry[];
  timeLogs?: TimeLogEntry[];
  parentId?: string | null;
  recurrence?: RecurrenceRule;    // rule that makes this task repeat
  completedDates?: string[];      // YYYY-MM-DD list of days this recurring task was completed
}

export interface TaskOrderRow {
  wsId: string;
  priorityIds: string[];
  todayIds: string[];
  updatedAt?: string;  // stamped automatically by the Dexie hooks below
  syncedAt?: string;
}

// ─── Project types ─────────────────────────────────────────────────────────────
export interface ProjectRow extends SyncMeta {
  id: string;
  name: string;
  color: string;
  workspaceId?: string | null;
  endDate?: string;
}

// ─── Workspace types ───────────────────────────────────────────────────────────
export interface WorkspaceRow extends SyncMeta {
  id: string;
  name: string;
  color: string;
}

// ─── Habit types ───────────────────────────────────────────────────────────────
export type HabitKind = 'counter' | 'boolean';
export type HabitIconKind = 'water' | 'fitness' | 'book' | 'sleep' | 'run' | 'meditate' | 'journal';

export interface HabitRow extends SyncMeta {
  id: string;
  name: string;
  kind: HabitKind;
  icon: HabitIconKind;
  goal?: number;
  unit?: string;
  unitAmount?: number;
  streakLabel: string;
  days: number[];
  workspaceId?: string | null;
}

export interface HabitHistoryRow {
  id?: string;            // UUID — assigned on first sync, stable thereafter
  habitId: string;
  date: string;           // YYYY-MM-DD
  count?: number;
  goal?: number;
  done?: boolean;
  completedAt?: string;
  updatedAt: string;
  syncedAt?: string;
}

// ─── Meeting types ─────────────────────────────────────────────────────────────
export type MeetingTrackMode = 'once' | 'always' | 'off';

export interface MeetingRow extends SyncMeta {
  id: string;
  title: string;
  time: string;
  durationMinutes: number;
  recurringLabel?: string;
  trackMode: MeetingTrackMode;
  past: boolean;
  logged: boolean;
  loggedMinutes?: number;
  minutesUntil?: number;
  projectId: string | null;
  notes: string;
  description?: string;
  workspaceId?: string | null;
  googleEventId?: string;
  recurringEventId?: string;
}

// ─── Detection rule types ──────────────────────────────────────────────────────
export interface DetectionRuleRow extends SyncMeta {
  id: string;
  name: string;
  urlPattern: string;
  active: boolean;
  kind: DetectionRule['kind'];
  presetId?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export interface SettingRow {
  key: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

// ─── Database ─────────────────────────────────────────────────────────────────
export class PomoDB extends Dexie {
  tasks!:          Table<TaskRow>;
  taskOrders!:     Table<TaskOrderRow>;
  projects!:       Table<ProjectRow>;
  workspaces!:     Table<WorkspaceRow>;
  habits!:         Table<HabitRow>;
  habitHistory!:   Table<HabitHistoryRow>;
  meetings!:       Table<MeetingRow>;
  detectionRules!: Table<DetectionRuleRow>;
  settings!:       Table<SettingRow>;

  constructor() {
    super('pomodoso');
    this.version(1).stores({
      tasks:          'id, workspaceId, status, updatedAt, deletedAt, syncedAt',
      taskOrders:     'wsId',
      projects:       'id',
      workspaces:     'id',
      habits:         'id, workspaceId',
      habitHistory:   '[habitId+date], habitId, date',
      meetings:       'id, workspaceId',
      detectionRules: 'id',
      settings:       'key',
    });
    this.version(2).stores({
      projects: 'id, workspaceId',
    });
    this.version(3).stores({
      meetings: 'id, workspaceId, googleEventId',
    });
    // v4: clear legacy hand-created test meetings (calendar feature wasn't active before)
    this.version(4).stores({}).upgrade(tx => tx.table('meetings').clear());
    this.version(5).stores({
      tasks: 'id, workspaceId, status, updatedAt, deletedAt, syncedAt, parentId',
    });
    this.version(6).stores({
      meetings: 'id, workspaceId, googleEventId, recurringEventId',
    });
    this.version(7).stores({
      tasks: 'id, workspaceId, status, updatedAt, deletedAt, syncedAt, parentId, recurrenceTemplateId',
    });
    this.version(8).stores({
      tasks: 'id, workspaceId, status, updatedAt, deletedAt, syncedAt, parentId',
    });
    // v9: add id index to habitHistory for sync
    this.version(9).stores({
      habitHistory: '[habitId+date], habitId, date, id',
    });
    // v10: sync v2 — re-push everything once. Earlier sync builds reassigned
    // entities to the active workspace on the server and never pushed time logs
    // (pomodoro sessions), task orders, or rich task fields. Clearing syncedAt
    // and the pull cursor makes the next sync a full LWW push + pull.
    this.version(10).stores({}).upgrade(async tx => {
      const clearSynced = (t: { syncedAt?: string }) => { delete t.syncedAt; };
      await tx.table('tasks').toCollection().modify(clearSynced);
      await tx.table('projects').toCollection().modify(clearSynced);
      await tx.table('workspaces').toCollection().modify(clearSynced);
      await tx.table('habits').toCollection().modify(clearSynced);
      await tx.table('habitHistory').toCollection().modify(clearSynced);
      const settings = tx.table('settings');
      const keys = (await settings.toCollection().primaryKeys()) as string[];
      await settings.bulkDelete(keys.filter(k => k === 'sync_last_pull' || k.endsWith('_synced_at')));
    });
  }
}

export const db = new PomoDB();

// ─── Sync apply suppression ────────────────────────────────────────────────────
// While the sync engine applies rows pulled from the server, the auto-stamping
// hooks below must not mark those rows dirty again (it would ping-pong forever).
let applyingRemote = false;
export function setApplyingRemote(v: boolean): void { applyingRemote = v; }
export function isApplyingRemote(): boolean { return applyingRemote; }

// taskOrders is written from many call sites — stamp updatedAt centrally so
// every local reorder/membership change becomes dirty and gets pushed.
db.taskOrders.hook('creating', function (_pk, obj) {
  if (applyingRemote) return;
  (obj as TaskOrderRow).updatedAt = now();
});
db.taskOrders.hook('updating', function (mods) {
  if (applyingRemote) return undefined;
  const m = mods as Partial<TaskOrderRow>;
  if ('priorityIds' in m || 'todayIds' in m) return { updatedAt: now() };
  return undefined;
});

// ─── Workspace identity: merge duplicates by name ──────────────────────────────
// A workspace's identity is its (normalized) name. Different installs and
// backup imports create same-named workspaces under different UUIDs; every
// sync converges them: the lexicographically smallest UUID is canonical on
// every device, the rest migrate their data into it and get tombstoned.

const WS_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wsNameKey = (name: string) => name.trim().toLowerCase();

// Per-workspace calendar config lives in settings as Record<wsId, …> — it must
// follow the workspace when duplicates merge, or the connection appears "lost".
const WS_KEYED_SETTINGS = ['calendar_connections', 'calendar_lists', 'calendar_last_synced'];

async function migrateWorkspaceData(fromId: string, toId: string): Promise<boolean> {
  const ts = now();
  let moved = 0;

  moved += await db.tasks.where('workspaceId').equals(fromId)
    .modify({ workspaceId: toId, updatedAt: ts });
  moved += await db.projects.filter(p => p.workspaceId === fromId)
    .modify({ workspaceId: toId, updatedAt: ts });
  moved += await db.meetings.filter(m => m.workspaceId === fromId)
    .modify({ workspaceId: toId, updatedAt: ts });

  const habitIds: string[] = [];
  moved += await db.habits.filter(h => h.workspaceId === fromId).modify(h => {
    habitIds.push(h.id);
    h.workspaceId = toId;
    h.updatedAt = ts;
  });
  if (habitIds.length) {
    // Re-stamp their logs so they re-push under the new workspace
    await db.habitHistory.where('habitId').anyOf(habitIds).modify({ updatedAt: ts });
  }

  // Today/Priorities: merge the duplicate's order into the canonical one
  const dupOrder = await db.taskOrders.get(fromId);
  if (dupOrder) {
    const canonOrder = await db.taskOrders.get(toId);
    await db.taskOrders.put({
      wsId: toId,
      priorityIds: [...new Set([...(canonOrder?.priorityIds ?? []), ...dupOrder.priorityIds])],
      todayIds: [...new Set([...(canonOrder?.todayIds ?? []), ...dupOrder.todayIds])],
    });
    await db.taskOrders.delete(fromId);
    moved += 1;
  }

  // Calendar config keyed by workspace id
  for (const key of WS_KEYED_SETTINGS) {
    const row = await db.settings.get(key);
    const record = row?.value as Record<string, unknown> | undefined;
    if (record && record[fromId] !== undefined) {
      if (record[toId] === undefined) record[toId] = record[fromId];
      delete record[fromId];
      await db.settings.put({ key, value: record });
      moved += 1;
    }
  }

  return moved > 0;
}

/** Merges same-named workspaces into the one with the smallest UUID and
 *  re-homes anything still pointing at a tombstoned workspace whose name has a
 *  living successor. Returns true when something changed (caller should push). */
export async function normalizeWorkspaces(): Promise<boolean> {
  const all = await db.workspaces.toArray();
  const alive = all.filter(w => !w.deletedAt && WS_UUID_RE.test(w.id));
  let changed = false;

  // 1. Merge duplicates among living workspaces
  const groups = new Map<string, WorkspaceRow[]>();
  for (const w of alive) {
    const key = wsNameKey(w.name);
    const g = groups.get(key);
    if (g) g.push(w);
    else groups.set(key, [w]);
  }
  const canonicalByName = new Map<string, WorkspaceRow>();
  for (const [key, group] of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const canonical = group[0];
    if (!canonical) continue;
    canonicalByName.set(key, canonical);
    for (const dup of group.slice(1)) {
      await migrateWorkspaceData(dup.id, canonical.id);
      await db.workspaces.update(dup.id, { deletedAt: now(), updatedAt: now() });
      changed = true;
    }
  }

  // 2. Adopt orphans: entities still under a workspace that was tombstoned
  //    (possibly by another device) whose name has a living successor here.
  for (const dead of all.filter(w => w.deletedAt)) {
    const target = canonicalByName.get(wsNameKey(dead.name));
    if (!target || target.id === dead.id) continue;
    if (await migrateWorkspaceData(dead.id, target.id)) changed = true;
  }

  return changed;
}

// ─── Device identity ───────────────────────────────────────────────────────────
// One UUID per install, generated on first use. Excluded from backups so an
// imported backup doesn't clone another install's identity.
export async function getDeviceId(): Promise<string> {
  const row = await db.settings.get('device_id');
  if (row?.value) return row.value as string;
  const id = crypto.randomUUID();
  await db.settings.put({ key: 'device_id', value: id });
  return id;
}

// ─── Migration ────────────────────────────────────────────────────────────────
// Runs once on the first popup open after the Dexie migration is deployed.
// Reads from chrome.storage.local and writes everything to the new IndexedDB tables.
// After success, sets pom_db_migrated = true and removes the migrated keys.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyTaskStorage = { allTasks: Record<string, any>; wsOrders?: Record<string, any>; priorityIds?: string[]; todayIds?: string[] };

export async function migrateFromChromeStorageIfNeeded(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const migrated = await chrome.storage.local.get('pom_db_migrated');
  if (migrated['pom_db_migrated']) return;

  const ts = now();

  const old = await chrome.storage.local.get([
    'pom_tasks',
    'pom_habits',
    'pom_habit_log',
    'pom_habit_history',
    'pom_meetings',
    'pom_projects',
    'pom_workspaces',
    'pom_rules',
    'pom_timer_settings',
    'pom_sound_settings',
  ]);

  await db.transaction('rw', [
    db.tasks, db.taskOrders, db.projects, db.workspaces,
    db.habits, db.habitHistory, db.meetings, db.detectionRules, db.settings,
  ], async () => {
    // ── Tasks ──────────────────────────────────────────────────────────────────
    const taskStorage = old['pom_tasks'] as LegacyTaskStorage | undefined;
    if (taskStorage?.allTasks) {
      const rows: TaskRow[] = Object.values(taskStorage.allTasks).map((t: any) => ({
        ...t,
        updatedAt: t.updatedAt ?? ts,
      }));
      await db.tasks.bulkPut(rows);
    }
    if (taskStorage) {
      const wsOrders: Record<string, { priorityIds: string[]; todayIds: string[] }> =
        taskStorage.wsOrders ??
        { default: { priorityIds: taskStorage.priorityIds ?? [], todayIds: taskStorage.todayIds ?? [] } };
      const orderRows: TaskOrderRow[] = Object.entries(wsOrders).map(([wsId, o]) => ({
        wsId,
        priorityIds: o.priorityIds ?? [],
        todayIds: o.todayIds ?? [],
      }));
      await db.taskOrders.bulkPut(orderRows);
    }

    // ── Habits ─────────────────────────────────────────────────────────────────
    const habits = old['pom_habits'] as HabitRow[] | undefined;
    if (habits?.length) {
      await db.habits.bulkPut(habits.map((h: any) => ({ ...h, updatedAt: h.updatedAt ?? ts })));
    }

    // ── Habit history ──────────────────────────────────────────────────────────
    // Migrate pom_habit_history (Record<habitId, Record<date, HabitDayRecord>>)
    const habitHistory = old['pom_habit_history'] as Record<string, Record<string, any>> | undefined;
    if (habitHistory) {
      const rows: HabitHistoryRow[] = [];
      for (const [habitId, dateMap] of Object.entries(habitHistory)) {
        for (const [date, record] of Object.entries(dateMap)) {
          rows.push({ habitId, date, ...record, updatedAt: ts });
        }
      }
      if (rows.length) await db.habitHistory.bulkPut(rows);
    }
    // Also absorb today's habit_log if it has data not already in history
    const habitLog = old['pom_habit_log'] as { date: string; counters: Record<string, number>; done: Record<string, boolean> } | undefined;
    if (habitLog?.date) {
      const allIds = new Set([...Object.keys(habitLog.counters ?? {}), ...Object.keys(habitLog.done ?? {})]);
      for (const habitId of allIds) {
        const existing = await db.habitHistory.get([habitId, habitLog.date]);
        if (existing) continue; // history already has this record (from setHabitHistory)
        const count = habitLog.counters?.[habitId];
        const done = habitLog.done?.[habitId];
        await db.habitHistory.put({ habitId, date: habitLog.date, ...(count != null ? { count } : {}), ...(done != null ? { done } : {}), updatedAt: ts });
      }
    }

    // ── Meetings ───────────────────────────────────────────────────────────────
    const meetings = old['pom_meetings'] as MeetingRow[] | undefined;
    if (meetings?.length) {
      await db.meetings.bulkPut(meetings.map((m: any) => ({ ...m, updatedAt: m.updatedAt ?? ts })));
    }

    // ── Projects ───────────────────────────────────────────────────────────────
    const projects = old['pom_projects'] as ProjectRow[] | undefined;
    if (projects?.length) {
      await db.projects.bulkPut(projects.map((p: any) => ({ ...p, updatedAt: p.updatedAt ?? ts })));
    }

    // ── Workspaces ─────────────────────────────────────────────────────────────
    const workspaces = old['pom_workspaces'] as WorkspaceRow[] | undefined;
    if (workspaces?.length) {
      await db.workspaces.bulkPut(workspaces.map((w: any) => ({ ...w, updatedAt: w.updatedAt ?? ts })));
    }

    // ── Detection rules ────────────────────────────────────────────────────────
    const rules = old['pom_rules'] as DetectionRuleRow[] | undefined;
    if (rules?.length) {
      await db.detectionRules.bulkPut(rules.map((r: any) => ({ ...r, updatedAt: r.updatedAt ?? ts })));
    }

    // ── Settings ───────────────────────────────────────────────────────────────
    const timerSettings = old['pom_timer_settings'] as TimerSettings | undefined;
    if (timerSettings) {
      await db.settings.put({ key: 'timer_settings', value: timerSettings });
    }
    const soundSettings = old['pom_sound_settings'] as SoundSettings | undefined;
    if (soundSettings) {
      await db.settings.put({ key: 'sound_settings', value: soundSettings });
    }
  });

  // Mark as done and remove migrated keys from chrome.storage.local
  await chrome.storage.local.set({ pom_db_migrated: true });
  await chrome.storage.local.remove([
    'pom_tasks', 'pom_habits', 'pom_habit_log', 'pom_habit_history',
    'pom_meetings', 'pom_projects', 'pom_workspaces', 'pom_rules',
    'pom_timer_settings', 'pom_sound_settings',
  ]);
}

// ─── Settings helpers ──────────────────────────────────────────────────────────

export async function getTimerSettingsFromDb(): Promise<TimerSettings> {
  const row = await db.settings.get('timer_settings');
  return (row?.value as TimerSettings | undefined) ?? { ...DEFAULT_TIMER_SETTINGS };
}

export async function getSoundSettingsFromDb(): Promise<SoundSettings> {
  const row = await db.settings.get('sound_settings');
  return (row?.value as SoundSettings | undefined) ?? { ...DEFAULT_SOUND_SETTINGS };
}

export async function getTimezoneFromDb(): Promise<string> {
  const row = await db.settings.get('timezone');
  return (row?.value as string | undefined) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
