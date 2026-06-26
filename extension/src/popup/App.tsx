import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { TimerMode, TicketRef, TimerStartPayload, TimerAttachPayload, SoundSettings, TimerSettings } from '@pomodoso/types';
import { DEFAULT_TIMER_SETTINGS, DEFAULT_SOUND_SETTINGS } from '@pomodoso/types';
import { useAuth } from './useAuth';
import { playSound } from '../sounds';
import { useTimerState } from './useTimerState';
import { useLocalStorage } from './useStorage';
import { HomeState, type Tab } from './HomeState';
import { TaskDetailState } from './TaskDetailState';
import { SettingsState } from './SettingsState';
import { LinkPickerState } from './LinkPickerState';
import { NotePickerState } from './NotePickerState';
import {
  db, now, localDate, migrateFromChromeStorageIfNeeded,
  type TaskRow, type TaskOrderRow, type ProjectRow, type WorkspaceRow, type DetectionRuleRow,
} from '../db';
import { syncAllConnectedWorkspaces } from '../calendarSync';
import { detectTicketFromRules } from '../ticketRules';
import { syncAll, initSync, clearSync, triggerSync, syncNow, pushActiveTimer, clearActiveTimer } from '../syncEngine';
import { importDb } from '../backup';
import { shouldBeInTodayNow } from '../recurrence';

// ─── Re-exported types (consumed by HomeState, TaskDetailState, etc.) ─────────
export type { TaskStatus, TaskLink, TimeLogEntry, NoteEntry, TaskRow as SelectedTask, ProjectRow as Project, WorkspaceRow as Workspace } from '../db';
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
  const auth = useAuth();
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

  // ── Migrate 'default' workspace to a proper UUID (sync requires valid UUIDs) ──
  // Runs once when DB loads. Replaces the sentinel 'default' id with a real UUID
  // across all tables, then updates the persisted activeWsId.
  useEffect(() => {
    if (!migrated || workspacesArr === undefined) return;
    const defaultWs = workspacesArr.find(w => w.id === 'default');
    // Target: the 'default' workspace gets a fresh UUID; if there's no 'default'
    // workspace but stray 'default'-scoped rows exist (e.g. an older template
    // seed that orphaned its tasks/order), re-home them to the first real
    // workspace so they sync instead of getting stuck under a dead id.
    const firstReal = workspacesArr.find(w => !w.deletedAt && w.id !== 'default');
    if (!defaultWs && !firstReal) return;
    void (async () => {
      const targetId = defaultWs ? crypto.randomUUID() : firstReal!.id;
      // Nothing to do if there's no 'default' ws and no stray 'default' rows.
      if (!defaultWs) {
        const orphans = await db.tasks.where('workspaceId').equals('default').count();
        const orphanOrder = await db.taskOrders.get('default');
        if (orphans === 0 && !orphanOrder) return;
      }
      await db.transaction('rw', [db.workspaces, db.tasks, db.habits, db.meetings, db.taskOrders], async () => {
        if (defaultWs) await db.workspaces.put({ ...defaultWs, id: targetId, syncedAt: undefined });
        await db.tasks.filter(t => t.workspaceId === 'default').modify({ workspaceId: targetId, syncedAt: undefined });
        await db.habits.filter(h => h.workspaceId === 'default').modify({ workspaceId: targetId, syncedAt: undefined });
        await db.meetings.filter(m => m.workspaceId === 'default').modify({ workspaceId: targetId });
        const order = await db.taskOrders.get('default');
        if (order) {
          const existing = await db.taskOrders.get(targetId);
          await db.taskOrders.put({
            wsId: targetId,
            priorityIds: [...new Set([...(existing?.priorityIds ?? []), ...order.priorityIds])],
            todayIds: [...new Set([...(existing?.todayIds ?? []), ...order.todayIds])],
          });
          await db.taskOrders.delete('default');
        }
        if (defaultWs) await db.workspaces.delete('default');
      });
      if (defaultWs) setActiveWsId(targetId);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [onboarded, setOnboarded, onboardedLoading] = useLocalStorage<boolean>('pom_onboarded', false);

  // ── Loading state ──────────────────────────────────────────────────────────
  const dbLoading = !migrated || allTasksArr === undefined || taskOrdersArr === undefined ||
    projectsArr === undefined || workspacesArr === undefined || rulesArr === undefined;
  const loading = timerLoading || dbLoading || lastSeenDateLoading || onboardedLoading || auth.loading;

  // ── Active workspace vanished (merged into a duplicate / deleted remotely) ──
  useEffect(() => {
    if (dbLoading || workspacesArr === undefined) return;
    if (activeWsId === 'all' || activeWsId === 'default') return;
    if (workspacesArr.some(w => w.id === activeWsId)) return;
    const first = workspacesArr[0];
    if (first) setActiveWsId(first.id);
  }, [dbLoading, activeWsId, workspacesArr, setActiveWsId]);

  // ── First-launch onboarding ────────────────────────────────────────────────
  // Signed-in users (and anyone who already has local data, e.g. an imported
  // backup) skip the welcome choice entirely — their data arrives via sync, so
  // seeding would duplicate samples. Signed-out first-timers pick template vs
  // empty in the WelcomeScreen below.
  useEffect(() => {
    if (onboarded || dbLoading || onboardedLoading || auth.loading) return;
    if (auth.session) { setOnboarded(true); return; }
    void (async () => {
      if ((await db.tasks.count()) > 0) setOnboarded(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarded, dbLoading, onboardedLoading, auth.loading, auth.session]);

  // Seed the sample tasks/habits + preset detection rules when the user picks
  // "Use template" on first launch.
  const seedTemplate = useCallback(async () => {
    // Use the real workspace, not the 'default' sentinel — by the time the
    // welcome screen shows, the default workspace has already been migrated to a
    // UUID (and 'default' deleted), so seeding under 'default' would orphan the
    // tasks/order and they'd never sync. Fall back to the first real workspace.
    const realWs = workspacesArr?.find(w => !w.deletedAt && w.id !== 'default');
    const wsId = (activeWsId !== 'all' && activeWsId !== 'default') ? activeWsId : (realWs?.id ?? 'default');
    const t1 = crypto.randomUUID(), t2 = crypto.randomUUID();
    const t3 = crypto.randomUUID(), t4 = crypto.randomUUID(), t5 = crypto.randomUUID();
    const h1 = crypto.randomUUID(), h2 = crypto.randomUUID(), h3 = crypto.randomUUID();
    const ts = now();
    await db.transaction('rw', [db.tasks, db.taskOrders, db.habits, db.detectionRules], async () => {
      await db.tasks.bulkPut([
        {
          id: t1, title: 'Set up your workspace', status: 'todo', workspaceId: wsId, ticketId: null, projectId: null, updatedAt: ts,
          description: '- Open **Settings → Workspaces** (gear icon in the header)\n- Rename "Personal" to your main context (e.g. Work, Study…)\n- Add extra workspaces if you juggle multiple contexts\n- Switch between them from the header — each has its own tasks, habits, and calendar',
        },
        {
          id: t2, title: 'Try your first pomodoro', status: 'todo', workspaceId: wsId, ticketId: null, projectId: null, updatedAt: ts,
          description: '- Click ▶ next to any task in the Today tab\n- Choose **Pomodoro** (25 min focus) or **Log time** (stopwatch)\n- When the session ends you\'ll be prompted to take a break\n- Your time is logged automatically on the task — check it in the task detail',
        },
        {
          id: t3, title: 'Connect Google Calendar', status: 'todo', workspaceId: wsId, ticketId: null, projectId: null, updatedAt: ts,
          description: '- Open **Settings → Calendar**\n- Click **Connect Google Calendar** and sign in\n- Select which calendars to sync\n- Today\'s meetings will appear in the **Schedule** tab and in the Today view\n- Click ▶ on a meeting to log time against it',
        },
        {
          id: t4, title: 'Customize your habits', status: 'todo', workspaceId: wsId, ticketId: null, projectId: null, updatedAt: ts,
          description: '- Go to the **Habits** tab\n- Edit the sample habits (Drink Water, Read, Exercise) or delete them\n- Add your own with **+ Add** — choose between counter (e.g. glasses of water) or checkbox habits\n- Set which days each habit should appear so it only shows when relevant',
        },
        {
          id: t5, title: 'Add tasks from your backlog', status: 'todo', workspaceId: wsId, ticketId: null, projectId: null, updatedAt: ts,
          description: '- Go to **Tasks → Backlog**\n- Create tasks with the **+ Add task** button or the **+** in the header\n- Press **★** to pin a task as a priority for today (max 3)\n- Press **+ Today** to add it to your regular task list\n- Open any page on Linear, GitHub, Jira or arXiv — Pomodoso will detect the ticket automatically',
        },
      ]);
      await db.taskOrders.put({ wsId, priorityIds: [t1, t2], todayIds: [t3, t4, t5] });
      // Habits are user-global → no workspace.
      await db.habits.bulkPut([
        { id: h1, name: 'Drink Water', kind: 'counter', icon: 'water',   goal: 8,  unit: 'glasses', unitAmount: 1, streakLabel: 'New habit', days: [], workspaceId: null, createdAt: ts, updatedAt: ts },
        { id: h2, name: 'Read',        kind: 'counter', icon: 'book',    goal: 20, unit: 'min',     unitAmount: 1, streakLabel: 'New habit', days: [], workspaceId: null, createdAt: ts, updatedAt: ts },
        { id: h3, name: 'Exercise',    kind: 'boolean', icon: 'fitness',                                           streakLabel: 'New habit', days: [], workspaceId: null, createdAt: ts, updatedAt: ts },
      ]);
      await db.detectionRules.bulkPut(INITIAL_RULES.map(r => ({ ...r, updatedAt: ts })));
    });
    setOnboarded(true);
  }, [setOnboarded, activeWsId, workspacesArr]);

  // ── Calendar sync on popup open ───────────────────────────────────────────
  useEffect(() => {
    if (!migrated) return;
    void syncAllConnectedWorkspaces(timezone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrated]);

  // ── Add recurring tasks to Today when their scheduled time arrives ────────
  // Runs on every popup open. Tasks with a scheduled time only appear after
  // that time has passed; all-day tasks appear immediately.
  useEffect(() => {
    if (!migrated) return;
    void (async () => {
      const today = localDate(timezone);
      const recurring = await db.tasks.filter(t => !t.deletedAt && !!t.recurrence).toArray();
      for (const task of recurring) {
        if (!shouldBeInTodayNow(task.recurrence!, today)) continue;
        if ((task.completedDates ?? []).includes(today)) continue;
        const wsId = task.workspaceId ?? 'default';
        const order = await db.taskOrders.get(wsId);
        const todayIds = order?.todayIds ?? [];
        if (!todayIds.includes(task.id)) {
          await db.taskOrders.put({
            wsId,
            priorityIds: order?.priorityIds ?? [],
            todayIds: [...todayIds, task.id],
          });
        }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrated]);

  // ── Transient UI state ─────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialPage, setSettingsInitialPage] = useState<'main' | 'calendar' | 'account'>('main');
  const [linkingTicket, setLinkingTicket] = useState<TicketRef | null>(null);
  const [addingNoteText, setAddingNoteText] = useState<string | null>(null);

  // ── Sync ──────────────────────────────────────────────────────────────────────
  // Sync is user-global: every workspace and its data syncs, regardless of which
  // workspace is active in the UI (including the "All" view).
  const API_URL = import.meta.env.VITE_API_URL as string | undefined;
  const [syncStatus, setSyncStatus] = useState<'disconnected' | 'connected' | 'syncing' | 'offline' | 'error'>('disconnected');

  const canSync = Boolean(auth.session && auth.entitlements.features.sync && API_URL);
  // Paid users (any plan with sync) don't see the Ko-fi tip jar.
  const isPro = auth.entitlements.features.sync;

  useEffect(() => {
    if (!auth.session) { setSyncStatus('disconnected'); clearSync(); return; }
    if (!canSync) { setSyncStatus('connected'); return; }
    if (typeof navigator !== 'undefined' && !navigator.onLine) { setSyncStatus('offline'); }

    initSync(auth.session.access_token, API_URL!, setSyncStatus);

    // Initial sync on login / popup open
    setSyncStatus('syncing');
    void syncAll(auth.session.access_token, API_URL!)
      .then(() => setSyncStatus('connected'))
      .catch((err) => {
        console.warn('[sync]', err);
        const offline = (typeof navigator !== 'undefined' && !navigator.onLine) || err instanceof TypeError;
        setSyncStatus(offline ? 'offline' : 'error');
      });

    return () => clearSync();
  }, [auth.session?.access_token, canSync]);

  // Live offline/online transitions while the popup is open
  useEffect(() => {
    const onOffline = () => setSyncStatus(s => (s === 'disconnected' ? s : 'offline'));
    const onOnline = () => { if (canSync) syncNow(); };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [canSync]);

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

  // ── Day rollover: clean up Today for the new day ──────────────────────────
  useEffect(() => {
    if (dbLoading || lastSeenDateLoading) return;
    const today = localDate(timezone);
    if (lastSeenDate === today) return;
    setLastSeenDate(today);
    if (!lastSeenDate) return; // first run — just record today, don't purge
    void (async () => {
      const orders = await db.taskOrders.toArray();
      for (const order of orders) {
        const shouldRemove = async (id: string) => {
          const t = await db.tasks.get(id);
          if (!t) return true;
          // Recurring tasks are always cleared on rollover; the recurring effect
          // re-adds them if they're scheduled for the new day.
          if (t.recurrence) return true;
          return t.status === 'done' || t.status === 'cancelled';
        };
        const newPriorityIds = (await Promise.all(order.priorityIds.map(async id => ({ id, remove: await shouldRemove(id) })))).filter(x => !x.remove).map(x => x.id);
        const newTodayIds    = (await Promise.all(order.todayIds.map(async id => ({ id, remove: await shouldRemove(id) })))).filter(x => !x.remove).map(x => x.id);
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

  // The priorities cap is GLOBAL (max across all workspaces, not per-workspace).
  // Count the union of priority ids over every real workspace order regardless
  // of which view is active. Only count ids that map to an existing, still-open
  // task: deleted/orphaned ids and completed (done/cancelled) tasks shouldn't
  // occupy a slot, otherwise the cap fills up and blocks adding new priorities
  // even though the user sees fewer than the max.
  const totalPriorities = new Set(
    Object.entries(wsOrders)
      .filter(([k]) => k !== 'all')
      .flatMap(([, o]) => o.priorityIds)
      .filter(id => {
        const t = allTasks[id];
        return !!t && t.status !== 'done' && t.status !== 'cancelled';
      }),
  ).size;
  const prioritiesFull = totalPriorities >= maxPriorities;

  const todayPriorities = priorityIds.map(id => allTasks[id]).filter((t): t is TaskRow => !!t);
  const todayTasks      = todayIds.map(id => allTasks[id]).filter((t): t is TaskRow => !!t);

  const inWs = (t: TaskRow) =>
    activeWsId === 'all' || t.workspaceId === activeWsId || t.workspaceId == null;

  const recurringTemplates = Object.values(allTasks).filter(t =>
    !!t.recurrence && !t.deletedAt && inWs(t),
  );

  const backlog = Object.values(allTasks).filter(t => {
    if (t.status === 'done' || t.status === 'cancelled') return false;
    if (priorityIds.includes(t.id) || todayIds.includes(t.id)) return false;
    if (t.recurrence) return false; // templates live in Recurring section, not backlog
    return inWs(t);
  });

  const [tabUrl, setTabUrl] = useState('');
  const [tabTitle, setTabTitle] = useState('');
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.url) setTabUrl(tab.url);
      if (tab?.title) setTabTitle(tab.title);
    });
  }, []);

  // Rule-driven detection: custom rules (and presets without a native content
  // script, e.g. Jira/Notion) match the tab URL generically. Native provider
  // detections (Linear, GitHub…) take precedence — they extract richer data.
  const ruleTicket = !detectedTicket && tabUrl
    ? detectTicketFromRules(rules, tabUrl, tabTitle)
    : null;
  const activeTicket = detectedTicket ?? ruleTicket;

  // Whether the current page is already covered by an existing detection rule
  // (any active rule, including native presets like Linear/GitHub). When true we
  // don't offer to add a rule for it.
  const urlMatchesRule = /^https?:/i.test(tabUrl) && rules.some(r => {
    if (!r.active || r.deletedAt) return false;
    try { return new RegExp(r.urlPattern, 'i').test(tabUrl); } catch { return false; }
  });

  const detectedExistingTasks = activeTicket
    ? Object.values(allTasks).filter(t => {
        if (t.deletedAt) return false;
        if (activeTicket.external_id && t.ticketId === activeTicket.external_id) return true;
        const url = activeTicket.external_url;
        return t.links?.some(l => l.url === url || l.url.startsWith(url) || url.startsWith(l.url));
      })
    : [];

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

  // In 'all' mode a task's order lives in its own workspace. Re-read the task
  // from the DB so we pick up a workspaceId that was just auto-assigned (the
  // selectedTask prop can still be the stale null-workspace object a task is
  // created with in 'all' view). Never fall back to the orphaned 'default'
  // order — use the first real workspace, matching TaskDetailState's auto-assign.
  const orderWsFor = useCallback((task: TaskRow, existing?: TaskRow): string => {
    if (wsKey !== 'all') return wsKey;
    const realWs = workspacesArr?.find(w => !w.deletedAt && w.id !== 'default');
    return existing?.workspaceId ?? task.workspaceId ?? realWs?.id ?? 'default';
  }, [wsKey, workspacesArr]);

  const addToPriorities = useCallback(async (task: TaskRow) => {
    if (prioritiesFull || priorityIds.includes(task.id)) return;
    await db.transaction('rw', [db.tasks, db.taskOrders], async () => {
      const existing = await db.tasks.get(task.id);
      if (!existing) await db.tasks.put({ ...task, updatedAt: now() });
      const targetWsId = orderWsFor(task, existing);
      const cur = await db.taskOrders.get(targetWsId) ?? { wsId: targetWsId, priorityIds: [], todayIds: [] };
      await db.taskOrders.put({
        wsId: targetWsId,
        priorityIds: [...cur.priorityIds, task.id],
        todayIds: cur.todayIds.filter(id => id !== task.id),
      });
    });
    triggerSync();
  }, [prioritiesFull, priorityIds, orderWsFor]);

  const addToTasks = useCallback(async (task: TaskRow) => {
    if (isInToday(task.id)) return;
    await db.transaction('rw', [db.tasks, db.taskOrders], async () => {
      const existing = await db.tasks.get(task.id);
      if (!existing) await db.tasks.put({ ...task, updatedAt: now() });
      const targetWsId = orderWsFor(task, existing);
      const cur = await db.taskOrders.get(targetWsId) ?? { wsId: targetWsId, priorityIds: [], todayIds: [] };
      await db.taskOrders.put({ wsId: targetWsId, priorityIds: cur.priorityIds, todayIds: [...cur.todayIds, task.id] });
    });
    triggerSync();
  }, [isInToday, orderWsFor]);

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
    triggerSync();
  }, [wsKey, patchWsOrder]);

  const reorderToday = useCallback(async (newPriorityIds: string[], newTodayIds: string[]) => {
    if (wsKey !== 'all') {
      await db.taskOrders.put({ wsId: wsKey, priorityIds: newPriorityIds, todayIds: newTodayIds });
      triggerSync();
      return;
    }
    // In 'all' mode the 'all' key only controls display order within each section.
    // Section membership (priority vs tasks) lives in individual workspace orders,
    // so cross-section drags must update those directly.
    const allOrders = await db.taskOrders.filter(o => o.wsId !== 'all').toArray();
    const currentPrioritySet = new Set(allOrders.flatMap(o => o.priorityIds));
    const currentTaskSet = new Set(allOrders.flatMap(o => o.todayIds));
    const movedToPriority = newPriorityIds.filter(id => currentTaskSet.has(id));
    const movedToTasks = newTodayIds.filter(id => currentPrioritySet.has(id));
    if (movedToPriority.length > 0 || movedToTasks.length > 0) {
      for (const order of allOrders) {
        let pIds = [...order.priorityIds];
        let tIds = [...order.todayIds];
        let changed = false;
        for (const id of movedToPriority) {
          if (tIds.includes(id)) { tIds = tIds.filter(i => i !== id); if (!pIds.includes(id)) pIds = [...pIds, id]; changed = true; }
        }
        for (const id of movedToTasks) {
          if (pIds.includes(id)) { pIds = pIds.filter(i => i !== id); if (!tIds.includes(id)) tIds = [...tIds, id]; changed = true; }
        }
        if (changed) await db.taskOrders.put({ wsId: order.wsId, priorityIds: pIds, todayIds: tIds });
      }
    }
    await db.taskOrders.put({ wsId: 'all', priorityIds: newPriorityIds, todayIds: newTodayIds });
    triggerSync();
  }, [wsKey]);

  const markRecurringDoneToday = useCallback(async (taskId: string) => {
    const today = localDate(timezone);
    const completedDates = [...new Set([...(allTasks[taskId]?.completedDates ?? []), today])];
    await db.tasks.update(taskId, { completedDates, status: 'todo', updatedAt: now() });
    // Reset the open detail too: a recurring task is only "done for today", so its
    // status goes back to todo (otherwise the detail keeps showing it as Done).
    setSelectedTask(prev => prev?.id === taskId ? { ...prev, completedDates, status: 'todo' } : prev);
    // Remove from all workspace orders so it disappears from Today
    const orders = await db.taskOrders.toArray();
    for (const order of orders) {
      if (order.priorityIds.includes(taskId) || order.todayIds.includes(taskId)) {
        await db.taskOrders.put({
          wsId: order.wsId,
          priorityIds: order.priorityIds.filter(i => i !== taskId),
          todayIds: order.todayIds.filter(i => i !== taskId),
        });
      }
    }
    triggerSync();
  }, [allTasks, timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTask = useCallback(async (id: string, updates: Partial<TaskRow>) => {
    // Recurring tasks use completedDates instead of status:'done' so they reappear tomorrow.
    if (updates.status === 'done' && allTasks[id]?.recurrence) {
      await markRecurringDoneToday(id);
      return;
    }
    await db.tasks.update(id, { ...updates, updatedAt: now() });
    triggerSync();
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
    triggerSync();
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
    triggerSync();
  }, [timerState.mode]);

  // ── Session actions ────────────────────────────────────────────────────────

  const handleDoneTask = useCallback(async () => {
    const { taskId, taskSegmentStartedAt } = timerState;
    if (!taskId) { await detachTask(); return; }
    const elapsed = taskSegmentStartedAt ? Math.floor((Date.now() - taskSegmentStartedAt) / 1000) : 0;
    // Log the elapsed time first
    if (elapsed > 0 && taskSegmentStartedAt) {
      await db.transaction('rw', db.tasks, async () => {
        const task = await db.tasks.get(taskId);
        if (!task) return;
        const entry = { id: crypto.randomUUID(), startedAt: new Date(taskSegmentStartedAt).toISOString(), durationSeconds: elapsed, mode: timerState.mode };
        await db.tasks.update(taskId, { timeLogs: [...(task.timeLogs ?? []), entry], updatedAt: now() });
      });
    }
    // Recurring: mark done for today; one-off: mark permanently done
    if (allTasks[taskId]?.recurrence) {
      await markRecurringDoneToday(taskId);
    } else {
      await db.tasks.update(taskId, { status: 'done', updatedAt: now() });
      setSelectedTask(prev => prev?.id === taskId ? { ...prev, status: 'done' } : prev);
    }
    playSound('task-done', soundSettings);
    await detachTask();
    await clearPendingSegment();
    triggerSync();
  }, [timerState, detachTask, clearPendingSegment, soundSettings, allTasks, markRecurringDoneToday]);

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
        await db.tasks.update(taskId, { timeLogs, updatedAt: now() });
      });
      if (closeTask) {
        if (allTasks[taskId]?.recurrence) {
          await markRecurringDoneToday(taskId);
        } else {
          await db.tasks.update(taskId, { status: 'done', updatedAt: now() });
          setSelectedTask(prev => prev?.id === taskId ? { ...prev, status: 'done' } : prev);
        }
      }
    }
    await stop();
    void clearActiveTimer();
    triggerSync();
  }, [timerState, stop, allTasks, markRecurringDoneToday]);

  const handleStartTimer = useCallback(async (payload: TimerStartPayload) => {
    if (timerState.status === 'active' && timerState.mode === 'pomodoro' && payload.mode === 'pomodoro') {
      await handleAttachTask({ taskId: payload.taskId, taskTitle: payload.taskTitle, ticketId: payload.ticketId, ticketExternalId: payload.ticketExternalId });
      return;
    }
    await start(payload);
    if (payload.mode === 'pomodoro') playSound('focus-start', soundSettings);
    if (payload.taskId) await updateTask(payload.taskId, { status: 'in_progress' });
    void pushActiveTimer(
      new Date().toISOString(),
      payload.mode,
      payload.taskId,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      payload.mode === 'pomodoro' ? timerSettings.focusSeconds : null,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState, start, soundSettings, updateTask, timerSettings]);

  const handleAttachTask = useCallback(async (payload: TimerAttachPayload) => {
    await attachTask(payload);
    await updateTask(payload.taskId, { status: 'in_progress' });
  }, [attachTask, updateTask]);

  const handleCancelTimer = useCallback(async () => {
    await stop();
    void clearActiveTimer();
  }, [stop]);

  // ── Project mutations ──────────────────────────────────────────────────────
  const addProject = useCallback(async (project: Omit<ProjectRow, keyof import('../db').SyncMeta>) => {
    await db.projects.put({ ...project, updatedAt: now() } as ProjectRow);
    triggerSync();
  }, []);

  const updateProject = useCallback(async (id: string, updates: Partial<ProjectRow>) => {
    await db.projects.update(id, { ...updates, updatedAt: now() });
    triggerSync();
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    await db.projects.update(id, { deletedAt: now(), updatedAt: now() });
    triggerSync();
  }, []);

  // ── Workspace mutations ────────────────────────────────────────────────────
  const addWorkspace = useCallback(async (name: string, color: string): Promise<WorkspaceRow> => {
    const ws: WorkspaceRow = { id: crypto.randomUUID(), name, color, updatedAt: now() };
    await db.workspaces.put(ws);
    triggerSync();
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
    triggerSync();
  }, [activeWsId, setActiveWsId]);

  const updateWorkspace = useCallback(async (id: string, name: string, color: string) => {
    await db.workspaces.update(id, { name, color, updatedAt: now() });
    triggerSync();
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
    await db.settings.put({ key: 'timer_settings_updated_at', value: now() });
    triggerSync();
  }, []);

  const updateSoundSettings = useCallback(async (updates: Partial<SoundSettings>) => {
    const current = (await db.settings.get('sound_settings'))?.value as SoundSettings ?? { ...DEFAULT_SOUND_SETTINGS };
    await db.settings.put({ key: 'sound_settings', value: { ...current, ...updates } });
    await db.settings.put({ key: 'sound_settings_updated_at', value: now() });
    triggerSync();
  }, []);

  const updateTimezone = useCallback(async (tz: string) => {
    await db.settings.put({ key: 'timezone', value: tz });
    await db.settings.put({ key: 'timezone_updated_at', value: now() });
    triggerSync();
  }, []);

  const updateMaxPriorities = useCallback(async (n: number) => {
    await db.settings.put({ key: 'max_priorities', value: n });
    await db.settings.put({ key: 'max_priorities_updated_at', value: now() });
    triggerSync();
  }, []);

  const updateWeekStart = useCallback(async (day: number) => {
    await db.settings.put({ key: 'week_start', value: day });
    await db.settings.put({ key: 'week_start_updated_at', value: now() });
    triggerSync();
  }, []);

  const updateWorkDays = useCallback(async (days: number[]) => {
    await db.settings.put({ key: 'work_days', value: days });
    await db.settings.put({ key: 'work_days_updated_at', value: now() });
    triggerSync();
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
    // Rule-detected tickets may have no id — dedupe by link URL instead
    const existing = Object.values(allTasks).find(t => !t.deletedAt && (
      (ticket.external_id && t.ticketId === ticket.external_id) ||
      t.links?.some(l => l.url === ticket.external_url)
    ));
    if (existing) { setSelectedTask(existing); return; }
    const newTask: TaskRow = {
      id: crypto.randomUUID(),
      title: ticket.title,
      ticketId: ticket.external_id || null,
      projectId: null,
      workspaceId: activeWsId === 'all' ? null : activeWsId,
      status: 'todo',
      links: [{ url: ticket.external_url, label: ticket.external_id || ticket.title }],
      updatedAt: now(),
    };
    await db.tasks.put(newTask);
    triggerSync();
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
    triggerSync();
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
    triggerSync();
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
    triggerSync();
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
      <PopupShell center isPro={isPro}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>Loading…</span>
      </PopupShell>
    );
  }

  // Signed-out first-timers choose template vs empty. Signed-in users skip this
  // (the effect above marks them onboarded — their data arrives via sync).
  if (!onboarded && !auth.session) {
    return (
      <PopupShell center isPro={isPro}>
        <WelcomeScreen
          onUseTemplate={() => void seedTemplate()}
          onStartEmpty={() => setOnboarded(true)}
          onSignIn={() => { setSettingsInitialPage('account'); setShowSettings(true); setOnboarded(true); }}
        />
      </PopupShell>
    );
  }

  if (addingNoteText) {
    return (
      <PopupShell isPro={isPro}>
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
      <PopupShell isPro={isPro}>
        <LinkPickerState
          ticket={linkingTicket}
          allTasks={allTasks}
          todayPriorities={todayPriorities}
          todayTasks={todayTasks}
          backlog={backlog}
          onLink={(task) => void linkTicketToTask(linkingTicket, task)}
          onBack={() => setLinkingTicket(null)}
        />
      </PopupShell>
    );
  }

  if (showSettings) {
    return (
      <PopupShell isPro={isPro}>
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
          entitlements={auth.entitlements}
          auth={auth}
          onSyncNow={canSync ? syncNow : undefined}
        />
      </PopupShell>
    );
  }

  if (selectedTask) {
    return (
      <PopupShell isPro={isPro}>
        <TaskDetailState
          key={selectedTask.id}
          task={selectedTask}
          projects={projects}
          workspaces={workspaces}
          activeWsId={activeWsId}
          timezone={timezone}
          isInToday={isInToday(selectedTask.id)}
          isInPriorities={priorityIds.includes(selectedTask.id)}
          prioritiesFull={prioritiesFull}
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
    <PopupShell isPro={isPro}>
      <HomeState
        timerState={timerState}
        timerSettings={timerSettings}
        detectedTicket={activeTicket}
        detectedExistingTasks={detectedExistingTasks}
        linkedTasks={linkedTasks}
        onSelectLinkedTask={setSelectedTask}
        todayPriorities={todayPriorities}
        todayTasks={todayTasks}
        backlog={backlog}
        recurringTemplates={recurringTemplates}
        projects={projects}
        prioritiesFull={prioritiesFull}
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
        currentUrl={tabUrl}
        urlMatchesRule={urlMatchesRule}
        onAddDetectionRule={(name, urlPattern) => void addRule({ id: crypto.randomUUID(), name, urlPattern, active: true, kind: 'custom', updatedAt: now() })}
        onOpenAccount={() => { setSettingsInitialPage('account'); setShowSettings(true); }}
        onSignOut={() => void auth.signOut()}
        onSyncNow={canSync ? syncNow : undefined}
        isSignedIn={Boolean(auth.session)}
        syncStatus={syncStatus}
        selectedText={selectedText}
        onCreateFromText={(text) => void createFromText(text)}
        onAddTextToNotes={(text) => setAddingNoteText(text)}
        onCreateTask={(title) => void createTask(title)}
        onCreateFollowup={(parentId) => void createFollowup(parentId)}
        onReorderToday={(p, t) => void reorderToday(p, t)}
        activeTab={activeTab}
        onSetActiveTab={setActiveTab}
      />
    </PopupShell>
  );
}

function WelcomeScreen({ onUseTemplate, onStartEmpty, onSignIn }: { onUseTemplate: () => void; onStartEmpty: () => void; onSignIn: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const logoUrl = typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('icons/icon-128.png')
    : '';

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      void (async () => {
        try {
          await importDb(ev.target?.result as string);
          window.location.reload();
        } catch (err) {
          setImportError(err instanceof Error ? err.message : 'Import failed');
          setImporting(false);
          // Clear the input so re-selecting the same file fires onChange again.
          if (fileRef.current) fileRef.current.value = '';
        }
      })();
    };
    reader.readAsText(file);
  };

  return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: 320 }}>
      <div style={{ textAlign: 'center' }}>
        {logoUrl
          ? <img src={logoUrl} alt="Pomodoso" width={40} height={40} style={{ marginBottom: 8 }} />
          : <div style={{ fontSize: 28, marginBottom: 8 }}>⏱️</div>}
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>Welcome to Pomodoso!</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Start with a few sample tasks &amp; habits, or a clean slate.
        </div>
      </div>

      <div style={{ width: '100%', display: 'flex', gap: 10 }}>
        {/* Habits */}
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Habits</div>
          {[['💧', 'Drink Water'], ['📖', 'Read'], ['🏃', 'Exercise']].map(([icon, name]) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--color-text)', marginBottom: 5 }}>
              <span>{icon}</span><span>{name}</span>
            </div>
          ))}
        </div>

        {/* Tasks */}
        <div style={{ flex: 1, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>Today</div>
          {[['★', 'Set up workspace'], ['★', 'First pomodoro'], ['·', 'Add Calendar'], ['·', 'Edit habits'], ['·', 'Explore backlog']].map(([bullet, name], i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: bullet === '★' ? 'var(--color-accent)' : 'var(--color-text-muted)', marginBottom: 5 }}>
              <span style={{ fontSize: 10, flexShrink: 0 }}>{bullet}</span><span style={{ color: 'var(--color-text)' }}>{name}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center', lineHeight: 1.5 }}>
        With the template you can edit, add, or delete anything — these are just examples.
      </div>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={onUseTemplate}
          style={{
            width: '100%', padding: '10px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: 'var(--color-accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--radius-md)',
          }}
        >
          Use template →
        </button>
        <button
          onClick={onStartEmpty}
          style={{
            width: '100%', padding: '9px 0', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          }}
        >
          Start empty
        </button>
      </div>

      {/* Returning users: sync down or restore a backup instead of starting fresh */}
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
        <span style={{ fontSize: 10, color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          already using Pomodoso?
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
      </div>

      <div style={{ width: '100%', display: 'flex', gap: 8 }}>
        <button
          onClick={onSignIn}
          style={{
            flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            background: 'transparent', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
          }}
        >
          Sign in to sync
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          style={{
            flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
            cursor: importing ? 'default' : 'pointer',
            background: 'transparent', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
            opacity: importing ? 0.6 : 1,
          }}
        >
          {importing ? 'Importing…' : 'Import backup'}
        </button>
      </div>
      {importError && (
        <div style={{ fontSize: 11, color: 'var(--color-danger, #C8553D)', textAlign: 'center' }}>{importError}</div>
      )}
      <input ref={fileRef} type="file" accept=".json" onChange={handleFile} style={{ display: 'none' }} />
    </div>
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

function PopupShell({ children, center, isPro }: { children: React.ReactNode; center?: boolean; isPro?: boolean }) {
  return (
    <div className="popup-root">
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...(center ? { alignItems: 'center', justifyContent: 'center' } : {}) }}>
        {children}
      </div>
      {!isPro && <KofiFooter />}
    </div>
  );
}
