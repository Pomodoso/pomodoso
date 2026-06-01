import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TimerMode, TicketRef, TimerStartPayload, TimerAttachPayload, SoundSettings, TimerSettings } from '@pomodoso/types';
import { DEFAULT_TIMER_SETTINGS, DEFAULT_SOUND_SETTINGS } from '@pomodoso/types';
import { playSound } from '../sounds';
import { useTimerState } from './useTimerState';
import { useLocalStorage } from './useStorage';
import { HomeState } from './HomeState';
import { TaskDetailState } from './TaskDetailState';
import { SettingsState } from './SettingsState';
import { LinkPickerState } from './LinkPickerState';
import { NotePickerState } from './NotePickerState';
import {
  db, now, localDate, migrateFromChromeStorageIfNeeded,
  type TaskRow, type TaskOrderRow, type ProjectRow, type WorkspaceRow, type DetectionRuleRow,
} from '../db';
import { syncAllConnectedWorkspaces } from '../calendarSync';

// ─── Re-exported types (consumed by HomeState, TaskDetailState, etc.) ─────────
export type { TaskStatus, TaskLink, TimeLogEntry, TaskRow as SelectedTask, ProjectRow as Project, WorkspaceRow as Workspace } from '../db';
export type TodayTask = TaskRow;
export type { TimerSettings, SoundSettings };

type WorkspaceOrder = { priorityIds: string[]; todayIds: string[] };
const INITIAL_WS_ORDER: WorkspaceOrder = { priorityIds: [], todayIds: [] };
const DEFAULT_WORKSPACE: WorkspaceRow = { id: 'default', name: 'Personal', color: '#4A6FA5', updatedAt: now() };
const INITIAL_RULES: DetectionRuleRow[] = [
  { id: 'r-linear', name: 'Linear', urlPattern: 'linear\\.app\\/[^/]+\\/issue\\/', active: true, kind: 'preset', presetId: 'linear', updatedAt: now() },
  { id: 'r-github', name: 'GitHub', urlPattern: 'github\\.com\\/[^/]+\\/[^/]+\\/(pull|issues)\\/', active: true, kind: 'preset', presetId: 'github', updatedAt: now() },
  { id: 'r-arxiv', name: 'arXiv', urlPattern: 'arxiv\\.org\\/abs\\/', active: true, kind: 'preset', presetId: 'arxiv', updatedAt: now() },
];

export function App() {
  const { timerState, detectedTicket, selectedText, clearSelection, loading: timerLoading, start, attachTask, detachTask, pausePomo, resumePomo, completePomo, startBreak, snooze, stop, clearPendingSegment, extendBreak, startNextPomo } = useTimerState();

  // ── Migration: chrome.storage.local → IndexedDB (runs once) ──────────────
  const [migrated, setMigrated] = useState(false);
  useEffect(() => {
    migrateFromChromeStorageIfNeeded().finally(() => setMigrated(true));
  }, []);

  // ── Dexie reactive queries ─────────────────────────────────────────────────
  const allTasksArr    = useLiveQuery(() => db.tasks.filter(t => !t.deletedAt).toArray(), [migrated]);
  const taskOrdersArr  = useLiveQuery(() => db.taskOrders.toArray(), [migrated]);
  const projectsArr    = useLiveQuery(() => db.projects.filter(p => !p.deletedAt).toArray(), [migrated]);
  const workspacesArr  = useLiveQuery(() => db.workspaces.filter(w => !w.deletedAt).toArray(), [migrated]);

  // ── Seed default workspace if none exist ──────────────────────────────────
  useEffect(() => {
    if (!migrated || workspacesArr === undefined) return;
    if (workspacesArr.length === 0) {
      void db.workspaces.put({ ...DEFAULT_WORKSPACE, updatedAt: now() });
    }
  }, [migrated, workspacesArr]);
  const rulesArr       = useLiveQuery(() => db.detectionRules.filter(r => !r.deletedAt).toArray(), [migrated]);
  const timerSettingsRow    = useLiveQuery(() => db.settings.get('timer_settings'), [migrated]);
  const soundSettingsRow    = useLiveQuery(() => db.settings.get('sound_settings'), [migrated]);
  const timezoneRow         = useLiveQuery(() => db.settings.get('timezone'), [migrated]);
  const maxPrioritiesRow    = useLiveQuery(() => db.settings.get('max_priorities'), [migrated]);
  const weekStartRow        = useLiveQuery(() => db.settings.get('week_start'), [migrated]);
  const workDaysRow         = useLiveQuery(() => db.settings.get('work_days'), [migrated]);

  // ── Derive plain objects from query results ────────────────────────────────
  const allTasks: Record<string, TaskRow> = {};
  for (const t of allTasksArr ?? []) allTasks[t.id] = t;

  const wsOrdersMap: Record<string, WorkspaceOrder> = {};
  for (const o of taskOrdersArr ?? []) wsOrdersMap[o.wsId] = { priorityIds: o.priorityIds, todayIds: o.todayIds };

  const projects    = projectsArr   ?? [DEFAULT_WORKSPACE as unknown as ProjectRow];
  const workspaces  = workspacesArr ?? [DEFAULT_WORKSPACE];
  const rules       = rulesArr      ?? INITIAL_RULES;
  const timerSettings: TimerSettings  = (timerSettingsRow?.value as TimerSettings  | undefined) ?? { ...DEFAULT_TIMER_SETTINGS };
  const soundSettings: SoundSettings = (soundSettingsRow?.value as SoundSettings | undefined) ?? { ...DEFAULT_SOUND_SETTINGS };
  const timezone: string = (timezoneRow?.value as string | undefined) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const maxPriorities: number = (maxPrioritiesRow?.value as number | undefined) ?? 3;
  // 0=Mon…6=Sun convention (matches habit days). Defaults: week starts Monday, work days Mon–Fri.
  const weekStart: number   = (weekStartRow?.value as number | undefined) ?? 0;
  const workDays: number[]  = (workDaysRow?.value as number[] | undefined) ?? [0, 1, 2, 3, 4];

  // ── Local (device-only) state ──────────────────────────────────────────────
  const [activeWsId, setActiveWsId]             = useLocalStorage<string>('pom_active_ws', 'default');
  const [lastSeenDate, setLastSeenDate, lastSeenDateLoading] = useLocalStorage<string>('pom_last_seen_date', '');

  // ── Loading state ──────────────────────────────────────────────────────────
  const dbLoading = !migrated || allTasksArr === undefined || taskOrdersArr === undefined ||
    projectsArr === undefined || workspacesArr === undefined || rulesArr === undefined;
  const loading = timerLoading || dbLoading || lastSeenDateLoading;

  // ── Calendar sync on popup open ───────────────────────────────────────────
  useEffect(() => {
    if (!migrated) return;
    void syncAllConnectedWorkspaces(timezone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrated]);

  // ── Transient UI state ─────────────────────────────────────────────────────
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialPage, setSettingsInitialPage] = useState<'main' | 'calendar'>('main');
  const [linkingTicket, setLinkingTicket] = useState<TicketRef | null>(null);
  const [addingNoteText, setAddingNoteText] = useState<string | null>(null);

  // ── After a fresh calendar connect: open Settings > Calendar so the user can select calendars
  useEffect(() => {
    if (!migrated) return;
    chrome.storage.local.get('calendar_just_connected').then(result => {
      const wsId = result['calendar_just_connected'] as string | undefined;
      if (!wsId) return;
      chrome.storage.local.remove('calendar_just_connected');
      setActiveWsId(wsId);
      setSettingsInitialPage('calendar');
      setShowSettings(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrated]);

  // ── Day rollover: remove completed tasks from Today ───────────────────────
  useEffect(() => {
    if (dbLoading || lastSeenDateLoading) return;
    const today = localDate(timezone);
    if (lastSeenDate === today) return;
    setLastSeenDate(today);
    if (!lastSeenDate) return; // first run — just record today, don't purge
    void (async () => {
      const orders = await db.taskOrders.toArray();
      for (const order of orders) {
        const isDone = async (id: string) => {
          const t = await db.tasks.get(id);
          return t?.status === 'done' || t?.status === 'cancelled';
        };
        const newPriorityIds = (await Promise.all(order.priorityIds.map(async id => ({ id, done: await isDone(id) })))).filter(x => !x.done).map(x => x.id);
        const newTodayIds    = (await Promise.all(order.todayIds.map(async id => ({ id, done: await isDone(id) })))).filter(x => !x.done).map(x => x.id);
        if (newPriorityIds.length !== order.priorityIds.length || newTodayIds.length !== order.todayIds.length) {
          await db.taskOrders.put({ wsId: order.wsId, priorityIds: newPriorityIds, todayIds: newTodayIds });
        }
      }
    })();
  }, [dbLoading, lastSeenDateLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending segment handler ────────────────────────────────────────────────
  // Use a stable key instead of the object reference as the dep — the 1-second poller
  // returns a new object each tick, so depending on the object would log the same
  // segment twice (once from the message response, once from the next poll hit before
  // clearPendingSegment round-trips back to storage).
  const pendingSegmentKey = timerState.pendingSegment
    ? `${timerState.pendingSegment.taskId}:${timerState.pendingSegment.startedAt}`
    : null;
  useEffect(() => {
    if (!pendingSegmentKey) return;
    const seg = timerState.pendingSegment!;
    void logTimeSegment(seg.taskId, seg.durationSeconds, seg.startedAt);
    void clearPendingSegment();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSegmentKey]);

  // ── Workspace key ──────────────────────────────────────────────────────────
  const wsKey = activeWsId;

  const getActiveWsOrder = useCallback(async (): Promise<WorkspaceOrder> => {
    if (wsKey === 'all') {
      // Merge from all workspaces
      const orders = await db.taskOrders.filter(o => o.wsId !== 'all').toArray();
      return {
        priorityIds: [...new Set(orders.flatMap(o => o.priorityIds))],
        todayIds:    [...new Set(orders.flatMap(o => o.todayIds))],
      };
    }
    return await db.taskOrders.get(wsKey) ?? INITIAL_WS_ORDER;
  }, [wsKey]);

  const patchWsOrder = useCallback(async (updater: (o: WorkspaceOrder) => WorkspaceOrder) => {
    const cur = await getActiveWsOrder();
    await db.taskOrders.put({ wsId: wsKey, ...updater(cur) });
  }, [wsKey, getActiveWsOrder]);

  // ── Derived list data (for rendering) ────────────────────────────────────
  const wsOrders = wsOrdersMap;

  const mergedAllOrder = (): WorkspaceOrder => {
    // Always derive IDs from individual workspace orders — never stale.
    const priorityIds = [...new Set(
      Object.entries(wsOrders).filter(([k]) => k !== 'all').flatMap(([, o]) => o.priorityIds),
    )];
    const todayIds = [...new Set(
      Object.entries(wsOrders).filter(([k]) => k !== 'all').flatMap(([, o]) => o.todayIds),
    )];
    // Apply any user-defined ordering from the 'all' key (drag-drop in 'all' mode).
    // Tasks added in workspace-specific views are appended at the end.
    const saved = wsOrders['all'];
    if (!saved) return { priorityIds, todayIds };
    const applyOrder = (ids: string[], savedOrder: string[]) => {
      const idSet = new Set(ids);
      const ordered = savedOrder.filter(id => idSet.has(id));
      const extra = ids.filter(id => !new Set(savedOrder).has(id));
      return [...ordered, ...extra];
    };
    return {
      priorityIds: applyOrder(priorityIds, saved.priorityIds),
      todayIds:    applyOrder(todayIds, saved.todayIds),
    };
  };

  const activeWsOrder: WorkspaceOrder = activeWsId === 'all'
    ? mergedAllOrder()
    : (wsOrders[activeWsId] ?? INITIAL_WS_ORDER);

  const priorityIds = activeWsOrder.priorityIds;
  const todayIds    = activeWsOrder.todayIds;

  const todayPriorities = priorityIds.map(id => allTasks[id]).filter((t): t is TaskRow => !!t);
  const todayTasks      = todayIds.map(id => allTasks[id]).filter((t): t is TaskRow => !!t);

  const backlog = Object.values(allTasks).filter(t => {
    if (t.status === 'done' || t.status === 'cancelled') return false;
    if (priorityIds.includes(t.id) || todayIds.includes(t.id)) return false;
    if (activeWsId === 'all') return true;
    return t.workspaceId === activeWsId || t.workspaceId == null;
  });

  const detectedExistingTasks = detectedTicket
    ? Object.values(allTasks).filter(t => {
        if (t.deletedAt) return false;
        if (t.ticketId === detectedTicket.external_id) return true;
        const url = detectedTicket.external_url;
        return t.links?.some(l => l.url === url || l.url.startsWith(url) || url.startsWith(l.url));
      })
    : [];

  const [tabUrl, setTabUrl] = useState('');
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) setTabUrl(tab.url);
    });
  }, []);

  const detectedIds = new Set(detectedExistingTasks.map(t => t.id));
  const linkedTasks = tabUrl
    ? Object.values(allTasks).filter(t => {
        if (t.deletedAt) return false;
        if (detectedIds.has(t.id)) return false;
        if (priorityIds.includes(t.id) || todayIds.includes(t.id)) return false;
        return t.links?.some(l => l.url === tabUrl || l.url.startsWith(tabUrl) || tabUrl.startsWith(l.url));
      })
    : [];

  const isInToday = (id: string) => priorityIds.includes(id) || todayIds.includes(id);

  // ── Task mutations ─────────────────────────────────────────────────────────

  const addToPriorities = useCallback(async (task: TaskRow) => {
    if (priorityIds.length >= maxPriorities || priorityIds.includes(task.id)) return;
    // In 'all' mode, anchor the task to its own workspace order.
    const targetWsId = wsKey === 'all' ? (task.workspaceId ?? 'default') : wsKey;
    await db.transaction('rw', [db.tasks, db.taskOrders], async () => {
      const existing = await db.tasks.get(task.id);
      if (!existing) await db.tasks.put({ ...task, updatedAt: now() });
      const cur = await db.taskOrders.get(targetWsId) ?? { wsId: targetWsId, priorityIds: [], todayIds: [] };
      await db.taskOrders.put({
        wsId: targetWsId,
        priorityIds: [...cur.priorityIds, task.id],
        todayIds: cur.todayIds.filter(id => id !== task.id),
      });
    });
  }, [priorityIds, wsKey]);

  const addToTasks = useCallback(async (task: TaskRow) => {
    if (isInToday(task.id)) return;
    const targetWsId = wsKey === 'all' ? (task.workspaceId ?? 'default') : wsKey;
    await db.transaction('rw', [db.tasks, db.taskOrders], async () => {
      const existing = await db.tasks.get(task.id);
      if (!existing) await db.tasks.put({ ...task, updatedAt: now() });
      const cur = await db.taskOrders.get(targetWsId) ?? { wsId: targetWsId, priorityIds: [], todayIds: [] };
      await db.taskOrders.put({ wsId: targetWsId, priorityIds: cur.priorityIds, todayIds: [...cur.todayIds, task.id] });
    });
  }, [isInToday, wsKey]);

  const removeFromToday = useCallback(async (taskId: string) => {
    if (wsKey === 'all') {
      // Remove from every workspace order that contains this task.
      const orders = await db.taskOrders.filter(o => o.wsId !== 'all').toArray();
      for (const order of orders) {
        if (order.priorityIds.includes(taskId) || order.todayIds.includes(taskId)) {
          await db.taskOrders.put({
            wsId: order.wsId,
            priorityIds: order.priorityIds.filter(id => id !== taskId),
            todayIds:    order.todayIds.filter(id => id !== taskId),
          });
        }
      }
    } else {
      await patchWsOrder(o => ({
        priorityIds: o.priorityIds.filter(id => id !== taskId),
        todayIds:    o.todayIds.filter(id => id !== taskId),
      }));
    }
  }, [wsKey, patchWsOrder]);

  const reorderToday = useCallback(async (newPriorityIds: string[], newTodayIds: string[]) => {
    await db.taskOrders.put({ wsId: wsKey, priorityIds: newPriorityIds, todayIds: newTodayIds });
  }, [wsKey]);

  const updateTask = useCallback(async (id: string, updates: Partial<TaskRow>) => {
    await db.tasks.update(id, { ...updates, updatedAt: now() });
    setSelectedTask(prev => prev?.id === id ? { ...prev, ...updates } : prev);

    if (updates.workspaceId !== undefined) {
      const newWsId = updates.workspaceId ?? 'default';
      await db.transaction('rw', [db.taskOrders], async () => {
        // Scan every order — remove the task from any workspace that isn't the new one
        const allOrders = await db.taskOrders.toArray();
        let wasInPriorities = false;
        let wasInToday = false;
        for (const order of allOrders) {
          if (order.wsId === newWsId) continue;
          const inP = order.priorityIds.includes(id);
          const inT = order.todayIds.includes(id);
          if (!inP && !inT) continue;
          wasInPriorities = wasInPriorities || inP;
          wasInToday = wasInToday || inT;
          await db.taskOrders.put({
            wsId: order.wsId,
            priorityIds: order.priorityIds.filter(i => i !== id),
            todayIds: order.todayIds.filter(i => i !== id),
          });
        }
        if (!wasInPriorities && !wasInToday) return;
        const newOrder = await db.taskOrders.get(newWsId) ?? { wsId: newWsId, priorityIds: [], todayIds: [] };
        await db.taskOrders.put({
          wsId: newWsId,
          priorityIds: wasInPriorities ? [...newOrder.priorityIds, id] : newOrder.priorityIds,
          todayIds: wasInToday ? [...newOrder.todayIds, id] : newOrder.todayIds,
        });
      });
    }
  }, [allTasks]);

  const deleteTask = useCallback(async (id: string) => {
    await db.transaction('rw', [db.tasks, db.taskOrders], async () => {
      await db.tasks.update(id, { deletedAt: now(), updatedAt: now() });
      const orders = await db.taskOrders.toArray();
      for (const order of orders) {
        if (order.priorityIds.includes(id) || order.todayIds.includes(id)) {
          await db.taskOrders.put({
            wsId: order.wsId,
            priorityIds: order.priorityIds.filter(i => i !== id),
            todayIds:    order.todayIds.filter(i => i !== id),
          });
        }
      }
    });
  }, []);

  // ── Time logging ───────────────────────────────────────────────────────────
  const logTimeSegment = useCallback(async (taskId: string, durationSeconds: number, startedAt: string) => {
    if (durationSeconds <= 0) return;
    await db.transaction('rw', db.tasks, async () => {
      const task = await db.tasks.get(taskId);
      if (!task) return;
      const newEntry = { id: crypto.randomUUID(), startedAt, durationSeconds, mode: timerState.mode };
      await db.tasks.update(taskId, { timeLogs: [...(task.timeLogs ?? []), newEntry], updatedAt: now() });
    });
  }, [timerState.mode]);

  // ── Session actions ────────────────────────────────────────────────────────

  const handleDoneTask = useCallback(async () => {
    const { taskId, taskSegmentStartedAt } = timerState;
    if (!taskId) { await detachTask(); return; }
    const elapsed = taskSegmentStartedAt ? Math.floor((Date.now() - taskSegmentStartedAt) / 1000) : 0;
    await db.transaction('rw', db.tasks, async () => {
      const task = await db.tasks.get(taskId);
      if (!task) return;
      const timeLogs = elapsed > 0 && taskSegmentStartedAt
        ? [...(task.timeLogs ?? []), { id: crypto.randomUUID(), startedAt: new Date(taskSegmentStartedAt).toISOString(), durationSeconds: elapsed, mode: timerState.mode }]
        : task.timeLogs;
      await db.tasks.update(taskId, { status: 'done', timeLogs, updatedAt: now() });
    });
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, status: 'done' } : prev);
    playSound('task-done', soundSettings);
    await detachTask();
    // detachTask causes the background to create a pendingSegment for the same segment
    // we just logged above — clear it immediately so it doesn't get double-written.
    await clearPendingSegment();
  }, [timerState, detachTask, clearPendingSegment, soundSettings]);

  const handleDetachTask = useCallback(async () => {
    await detachTask();
  }, [detachTask]);

  const handleFinishStopwatch = useCallback(async (closeTask: boolean) => {
    const { taskId, taskSegmentStartedAt } = timerState;
    if (taskId) {
      const elapsed = taskSegmentStartedAt ? Math.floor((Date.now() - taskSegmentStartedAt) / 1000) : 0;
      await db.transaction('rw', db.tasks, async () => {
        const task = await db.tasks.get(taskId);
        if (!task) return;
        const timeLogs = elapsed > 0 && taskSegmentStartedAt
          ? [...(task.timeLogs ?? []), { id: crypto.randomUUID(), startedAt: new Date(taskSegmentStartedAt).toISOString(), durationSeconds: elapsed, mode: timerState.mode }]
          : task.timeLogs;
        const updates: Partial<TaskRow> = { timeLogs, updatedAt: now() };
        if (closeTask) updates.status = 'done';
        await db.tasks.update(taskId, updates);
      });
      if (closeTask) setSelectedTask(prev => prev?.id === taskId ? { ...prev, status: 'done' } : prev);
    }
    await stop();
  }, [timerState, stop]);

  const handleStartTimer = useCallback(async (payload: TimerStartPayload) => {
    if (timerState.status === 'active' && timerState.mode === 'pomodoro' && payload.mode === 'pomodoro') {
      await handleAttachTask({ taskId: payload.taskId, taskTitle: payload.taskTitle, ticketId: payload.ticketId, ticketExternalId: payload.ticketExternalId });
      return;
    }
    await start(payload);
    if (payload.mode === 'pomodoro') playSound('focus-start', soundSettings);
    if (payload.taskId) await updateTask(payload.taskId, { status: 'in_progress' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState, start, soundSettings, updateTask]);

  const handleAttachTask = useCallback(async (payload: TimerAttachPayload) => {
    await attachTask(payload);
    await updateTask(payload.taskId, { status: 'in_progress' });
  }, [attachTask, updateTask]);

  const handleCancelTimer = useCallback(async () => { await stop(); }, [stop]);

  // ── Project mutations ──────────────────────────────────────────────────────
  const addProject = useCallback(async (project: Omit<ProjectRow, keyof import('../db').SyncMeta>) => {
    await db.projects.put({ ...project, updatedAt: now() } as ProjectRow);
  }, []);

  const updateProject = useCallback(async (id: string, updates: Partial<ProjectRow>) => {
    await db.projects.update(id, { ...updates, updatedAt: now() });
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await db.projects.update(id, { deletedAt: now(), updatedAt: now() });
  }, []);

  // ── Workspace mutations ────────────────────────────────────────────────────
  const addWorkspace = useCallback(async (name: string, color: string): Promise<WorkspaceRow> => {
    const ws: WorkspaceRow = { id: crypto.randomUUID(), name, color, updatedAt: now() };
    await db.workspaces.put(ws);
    return ws;
  }, []);

  const deleteWorkspace = useCallback(async (id: string) => {
    await db.transaction('rw', [db.workspaces, db.tasks, db.taskOrders], async () => {
      await db.workspaces.update(id, { deletedAt: now(), updatedAt: now() });
      await db.taskOrders.delete(id);
      // Unassign tasks from this workspace
      const affected = await db.tasks.where('workspaceId').equals(id).toArray();
      for (const t of affected) {
        await db.tasks.update(t.id, { workspaceId: null, updatedAt: now() });
      }
    });
    if (activeWsId === id) setActiveWsId('default');
  }, [activeWsId, setActiveWsId]);

  const updateWorkspace = useCallback(async (id: string, name: string, color: string) => {
    await db.workspaces.update(id, { name, color, updatedAt: now() });
  }, []);

  // ── Rule mutations ─────────────────────────────────────────────────────────
  const addRule = useCallback(async (rule: DetectionRuleRow) => {
    await db.detectionRules.put({ ...rule, updatedAt: now() });
  }, []);

  const toggleRule = useCallback(async (id: string) => {
    const rule = await db.detectionRules.get(id);
    if (!rule) return;
    await db.detectionRules.update(id, { active: !rule.active, updatedAt: now() });
  }, []);

  const deleteRule = useCallback(async (id: string) => {
    await db.detectionRules.update(id, { deletedAt: now(), updatedAt: now() });
  }, []);

  const updateRule = useCallback(async (id: string, name: string, urlPattern: string) => {
    await db.detectionRules.update(id, { name, urlPattern, updatedAt: now() });
  }, []);

  // ── Settings mutations ─────────────────────────────────────────────────────
  const updateTimerSettings = useCallback(async (updates: Partial<TimerSettings>) => {
    const current = (await db.settings.get('timer_settings'))?.value as TimerSettings ?? { ...DEFAULT_TIMER_SETTINGS };
    await db.settings.put({ key: 'timer_settings', value: { ...current, ...updates } });
  }, []);

  const updateSoundSettings = useCallback(async (updates: Partial<SoundSettings>) => {
    const current = (await db.settings.get('sound_settings'))?.value as SoundSettings ?? { ...DEFAULT_SOUND_SETTINGS };
    await db.settings.put({ key: 'sound_settings', value: { ...current, ...updates } });
  }, []);

  const updateTimezone = useCallback(async (tz: string) => {
    await db.settings.put({ key: 'timezone', value: tz });
  }, []);

  const updateMaxPriorities = useCallback(async (n: number) => {
    await db.settings.put({ key: 'max_priorities', value: n });
  }, []);

  const updateWeekStart = useCallback(async (day: number) => {
    await db.settings.put({ key: 'week_start', value: day });
  }, []);

  const updateWorkDays = useCallback(async (days: number[]) => {
    await db.settings.put({ key: 'work_days', value: days });
  }, []);

  // ── Ticket / selection actions ─────────────────────────────────────────────
  const linkTicketToTask = useCallback(async (ticket: TicketRef, task: TaskRow) => {
    const existing = allTasks[task.id];
    if (!existing) return;
    const link = { url: ticket.external_url, label: ticket.external_id || ticket.title };
    const newLinks = [...(existing.links ?? []).filter(l => l.url !== link.url), link];
    await updateTask(task.id, { links: newLinks });
    setLinkingTicket(null);
    setSelectedTask({ ...existing, links: newLinks });
  }, [allTasks, updateTask]);

  const addToBacklog = useCallback(async (ticket: TicketRef) => {
    const existing = Object.values(allTasks).find(t => t.ticketId === ticket.external_id);
    if (existing) { setSelectedTask(existing); return; }
    const newTask: TaskRow = {
      id: crypto.randomUUID(),
      title: ticket.title,
      ticketId: ticket.external_id,
      projectId: null,
      workspaceId: activeWsId === 'all' ? null : activeWsId,
      status: 'todo',
      links: [{ url: ticket.external_url, label: ticket.external_id || ticket.title }],
      updatedAt: now(),
    };
    await db.tasks.put(newTask);
    setSelectedTask(newTask);
  }, [allTasks, activeWsId]);

  const createFollowup = useCallback(async (parentId: string) => {
    const parent = allTasks[parentId];
    const newTask: TaskRow = {
      id: crypto.randomUUID(),
      title: '',
      ticketId: parent?.ticketId ?? null,
      projectId: parent?.projectId ?? null,
      workspaceId: parent?.workspaceId ?? null,
      status: 'todo',
      parentId,
      updatedAt: now(),
    };
    await db.tasks.put(newTask);
    setSelectedTask(newTask);
  }, [allTasks]);

  const createTask = useCallback(async (title: string) => {
    const newTask: TaskRow = {
      id: crypto.randomUUID(),
      title: title.trim(),
      ticketId: null,
      projectId: null,
      workspaceId: activeWsId === 'all' ? null : activeWsId,
      status: 'todo',
      updatedAt: now(),
    };
    await db.tasks.put(newTask);
    setSelectedTask(newTask);
  }, [activeWsId]);

  const TITLE_MAX = 128;

  const createFromText = useCallback(async (text: string) => {
    const truncated = text.length > TITLE_MAX;
    const newTask: TaskRow = {
      id: crypto.randomUUID(),
      title: truncated ? text.slice(0, TITLE_MAX) + '…' : text,
      ticketId: null,
      projectId: null,
      workspaceId: activeWsId === 'all' ? null : activeWsId,
      status: 'todo',
      updatedAt: now(),
      ...(truncated ? { description: text } : {}),
    };
    await db.tasks.put(newTask);
    setSelectedTask(newTask);
    clearSelection();
  }, [activeWsId, clearSelection]);

  const addTextToNotes = useCallback(async (task: TaskRow, text: string) => {
    const existing = allTasks[task.id];
    if (!existing) return;
    const ts = new Date().toLocaleString('sv-SE', { timeZone: timezone, hour12: false }).slice(0, 16);
    const entry = `[${ts}] ${text}`;
    const newDescription = existing.description ? `${existing.description}\n\n${entry}` : entry;
    await updateTask(task.id, { description: newDescription });
    setAddingNoteText(null);
    setSelectedTask({ ...existing, description: newDescription });
    clearSelection();
  }, [allTasks, updateTask, clearSelection]);

  if (loading) {
    return (
      <PopupShell center>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</span>
      </PopupShell>
    );
  }

  if (addingNoteText) {
    return (
      <PopupShell>
        <NotePickerState
          text={addingNoteText}
          allTasks={allTasks}
          onAdd={(task) => void addTextToNotes(task, addingNoteText)}
          onBack={() => setAddingNoteText(null)}
        />
      </PopupShell>
    );
  }

  if (linkingTicket) {
    return (
      <PopupShell>
        <LinkPickerState
          ticket={linkingTicket}
          allTasks={allTasks}
          onLink={(task) => void linkTicketToTask(linkingTicket, task)}
          onBack={() => setLinkingTicket(null)}
        />
      </PopupShell>
    );
  }

  if (showSettings) {
    return (
      <PopupShell>
        <SettingsState
          rules={rules}
          timerSettings={timerSettings}
          workspaces={workspaces}
          soundSettings={soundSettings}
          timezone={timezone}
          maxPriorities={maxPriorities}
          activeWsId={activeWsId}
          initialPage={settingsInitialPage}
          onBack={() => { setShowSettings(false); setSettingsInitialPage('main'); }}
          onAddRule={(rule) => void addRule(rule as DetectionRuleRow)}
          onToggleRule={(id) => void toggleRule(id)}
          onDeleteRule={(id) => void deleteRule(id)}
          onUpdateRule={(id, name, urlPattern) => void updateRule(id, name, urlPattern)}
          onUpdateTimerSettings={(updates) => void updateTimerSettings(updates)}
          onAddWorkspace={(name, color) => { void addWorkspace(name, color); }}
          onUpdateWorkspace={(id, name, color) => void updateWorkspace(id, name, color)}
          onDeleteWorkspace={(id) => void deleteWorkspace(id)}
          onUpdateSoundSettings={(updates) => void updateSoundSettings(updates)}
          onUpdateTimezone={(tz) => void updateTimezone(tz)}
          onUpdateMaxPriorities={(n) => void updateMaxPriorities(n)}
          weekStart={weekStart}
          workDays={workDays}
          onUpdateWeekStart={(d) => void updateWeekStart(d)}
          onUpdateWorkDays={(d) => void updateWorkDays(d)}
        />
      </PopupShell>
    );
  }

  if (selectedTask) {
    return (
      <PopupShell>
        <TaskDetailState
          key={selectedTask.id}
          task={selectedTask}
          projects={projects}
          workspaces={workspaces}
          activeWsId={activeWsId}
          timezone={timezone}
          isInToday={isInToday(selectedTask.id)}
          isInPriorities={priorityIds.includes(selectedTask.id)}
          prioritiesFull={priorityIds.length >= maxPriorities}
          onBack={() => setSelectedTask(null)}
          onDelete={() => { void deleteTask(selectedTask.id); setSelectedTask(null); }}
          onMoveToBacklog={() => { void removeFromToday(selectedTask.id); setSelectedTask(null); }}
          onAddToPriorities={() => { void addToPriorities(selectedTask); setSelectedTask(null); }}
          onAddToTasks={() => { void addToTasks(selectedTask); setSelectedTask(null); }}
          onUpdateTask={(updates) => void updateTask(selectedTask.id, updates)}
          onAddProject={(p) => void addProject(p)}
          onUpdateProject={(id, updates) => void updateProject(id, updates)}
          onDeleteProject={(id) => void deleteProject(id)}
          onStart={async (payload) => { setSelectedTask(null); await handleStartTimer(payload); }}
          onSelectTask={setSelectedTask}
          onCreateFollowup={(parentId) => void createFollowup(parentId)}
        />
      </PopupShell>
    );
  }

  return (
    <PopupShell>
      <HomeState
        timerState={timerState}
        timerSettings={timerSettings}
        detectedTicket={detectedTicket}
        detectedExistingTasks={detectedExistingTasks}
        linkedTasks={linkedTasks}
        onSelectLinkedTask={setSelectedTask}
        todayPriorities={todayPriorities}
        todayTasks={todayTasks}
        backlog={backlog}
        projects={projects}
        prioritiesFull={priorityIds.length >= maxPriorities}
        workspaces={workspaces}
        activeWsId={activeWsId}
        timezone={timezone}
        maxPriorities={maxPriorities}
        weekStart={weekStart}
        workDays={workDays}
        onSetActiveWs={setActiveWsId}
        onAddToPriorities={(task) => void addToPriorities(task)}
        onAddToTasks={(task) => void addToTasks(task)}
        onRemoveFromToday={(id) => void removeFromToday(id)}
        onSelectTask={setSelectedTask}
        onStartTimer={handleStartTimer}
        onAttachTask={handleAttachTask}
        onDoneTask={handleDoneTask}
        onDetachTask={handleDetachTask}
        onFinishStopwatch={(closeTask) => handleFinishStopwatch(closeTask)}
        onPausePomo={pausePomo}
        onResumePomo={resumePomo}
        onCompletePomo={completePomo}
        onStartBreak={startBreak}
        onSnooze={snooze}
        onExtendBreak={extendBreak}
        onStartNextPomo={startNextPomo}
        onCancelTimer={handleCancelTimer}
        onUpdateTaskStatus={(taskId, status) => void updateTask(taskId, { status })}
        onAddToBacklog={(ticket) => void addToBacklog(ticket)}
        onLinkToTask={(ticket) => setLinkingTicket(ticket)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenCalendarSettings={() => { setSettingsInitialPage('calendar'); setShowSettings(true); }}
        selectedText={selectedText}
        onCreateFromText={(text) => void createFromText(text)}
        onAddTextToNotes={(text) => setAddingNoteText(text)}
        onCreateTask={(title) => void createTask(title)}
        onCreateFollowup={(parentId) => void createFollowup(parentId)}
        onReorderToday={(p, t) => void reorderToday(p, t)}
      />
    </PopupShell>
  );
}

function KofiFooter() {
  return (
    <div style={{ flexShrink: 0, padding: '5px 0 6px', borderTop: '1px solid var(--color-border)', textAlign: 'center' }}>
      <button
        onClick={() => void chrome.tabs.create({ url: 'https://ko-fi.com/carpedev' })}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-text-faint)', fontFamily: 'inherit' }}
      >
        ☕ Buy me a coffee
      </button>
    </div>
  );
}

function PopupShell({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className="popup-root">
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...(center ? { alignItems: 'center', justifyContent: 'center' } : {}) }}>
        {children}
      </div>
      <KofiFooter />
    </div>
  );
}
