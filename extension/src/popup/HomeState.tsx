import { useState, useRef, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLocalStorage } from './useStorage';
import type React from 'react';
import { marked } from 'marked';
import { TimerRing } from '@pomodoso/ui';
import type { TimerStartPayload, TimerAttachPayload, TimerState, TicketRef } from '@pomodoso/types';
import type { SelectedTask, TodayTask, TaskStatus, Project, TimerSettings, TimeLogEntry, Workspace } from './App';
import {
  db, now, localDate,
  type HabitRow as HabitDef,
  type HabitHistoryRow,
  type MeetingRow as CalendarMeeting,
  type HabitKind,
  type HabitIconKind,
  type MeetingTrackMode,
} from '../db';

marked.use({ breaks: true });

type Tab = 'today' | 'habits' | 'tasks' | 'schedule';

type WeekCellKind = 'full' | 'partial' | 'empty';

interface HomeStateProps {
  timerState: TimerState;
  timerSettings: TimerSettings;
  detectedTicket: TicketRef | null;
  detectedExistingTasks: SelectedTask[];
  todayPriorities: TodayTask[];
  todayTasks: TodayTask[];
  backlog: SelectedTask[];
  projects: Project[];
  prioritiesFull: boolean;
  onAddToPriorities: (task: SelectedTask) => void;
  onAddToTasks: (task: SelectedTask) => void;
  onRemoveFromToday: (taskId: string) => void;
  onSelectTask: (task: SelectedTask) => void;
  onStartTimer: (payload: TimerStartPayload) => Promise<void>;
  onAttachTask: (payload: TimerAttachPayload) => Promise<void>;
  onDoneTask: () => Promise<void>;
  onDetachTask: () => Promise<void>;
  onFinishStopwatch: (closeTask: boolean) => Promise<void>;
  onPausePomo: () => Promise<void>;
  onResumePomo: () => Promise<void>;
  onCompletePomo: () => Promise<void>;
  onStartBreak: () => Promise<void>;
  onSnooze: () => Promise<void>;
  onExtendBreak: () => Promise<void>;
  onStartNextPomo: () => Promise<void>;
  onCancelTimer: () => Promise<void>;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => void;
  linkedTasks: SelectedTask[];
  onSelectLinkedTask: (task: SelectedTask) => void;
  onAddToBacklog: (ticket: TicketRef) => void;
  onLinkToTask: (ticket: TicketRef) => void;
  onOpenSettings: () => void;
  onOpenCalendarSettings: () => void;
  selectedText: string | null;
  onCreateFromText: (text: string) => void;
  onAddTextToNotes: (text: string) => void;
  onCreateTask: (title: string) => void;
  onCreateFollowup: (parentId: string) => void;
  onReorderToday: (priorityIds: string[], todayIds: string[]) => void;
  workspaces: Workspace[];
  activeWsId: string;
  onSetActiveWs: (id: string) => void;
  timezone: string;
  maxPriorities: number;
}

const WEEK_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
const WEEK_COMPLETIONS: { count: number; kind: WeekCellKind; isToday?: boolean }[] = [
  { count: 4, kind: 'full' },
  { count: 4, kind: 'full' },
  { count: 3, kind: 'partial' },
  { count: 4, kind: 'full' },
  { count: 3, kind: 'partial' },
  { count: 2, kind: 'partial' },
  { count: 2, kind: 'partial', isToday: true },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Todo',
  in_progress: 'In progress',
  done: 'Done',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
};

const STATUS_DOT_COLOR: Record<TaskStatus, string> = {
  todo: 'var(--color-border-strong)',
  in_progress: 'var(--color-warning)',
  done: 'var(--color-success)',
  delayed: 'var(--color-text-muted)',
  cancelled: 'var(--color-text-faint)',
};

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_CHIP_COLORS: Record<TaskStatus, { bg: string; color: string; border: string }> = {
  todo:        { bg: 'var(--color-surface)',     color: 'var(--color-info)',    border: 'var(--color-info)' },
  in_progress: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: 'var(--color-warning)' },
  done:        { bg: 'var(--color-success-bg)', color: 'var(--color-success)', border: 'var(--color-success)' },
  delayed:     { bg: 'rgba(123,93,180,0.1)',    color: '#7B5DB4',              border: '#7B5DB4' },
  cancelled:   { bg: 'var(--color-accent-soft)', color: 'var(--color-accent)', border: 'var(--color-accent)' },
};

function to12h(time: string, timezone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(time)) return 'All day';
  return new Date(time).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
  });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function HomeState({
  timerState, timerSettings, detectedTicket, detectedExistingTasks, todayPriorities, todayTasks, backlog, projects, prioritiesFull,
  workspaces, activeWsId, onSetActiveWs, timezone, maxPriorities,
  onAddToPriorities, onAddToTasks, onRemoveFromToday, onSelectTask, onStartTimer, onAttachTask, onDoneTask, onDetachTask, onFinishStopwatch, onPausePomo, onResumePomo, onCompletePomo, onStartBreak, onSnooze, onExtendBreak, onStartNextPomo, onCancelTimer,
  linkedTasks, onSelectLinkedTask,
  onUpdateTaskStatus, onAddToBacklog, onLinkToTask, onOpenSettings, onOpenCalendarSettings,
  selectedText, onCreateFromText, onAddTextToNotes, onCreateTask, onCreateFollowup, onReorderToday,
}: HomeStateProps) {
  const projectById = (id: string | null) => id ? projects.find(p => p.id === id) : undefined;
  const [showModePicker, setShowModePicker] = useState<SelectedTask | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [linkedDismissed, setLinkedDismissed] = useState(false);
  const habits   = useLiveQuery(() => db.habits.filter(h => !h.deletedAt).toArray()) ?? [];
  const meetings = useLiveQuery(() => db.meetings.filter(m => !m.deletedAt).toArray()) ?? [];
  const today = localDate(timezone);
  const todayHabitRecords: HabitHistoryRow[] = useLiveQuery(
    () => db.habitHistory.where('date').equals(today).toArray(),
    [today],
  ) ?? [];
  const completedToday = useLiveQuery(
    () => db.tasks
      .filter(t => !t.deletedAt && (t.status === 'done' || t.status === 'cancelled') && t.updatedAt.slice(0, 10) === today)
      .toArray(),
    [today],
  ) ?? [];
  const [tasksSubTab, setTasksSubTab] = useState<'backlog' | 'history'>('backlog');
  const [habitsSubTab, setHabitsSubTab] = useState<'today' | 'history'>('today');
  const [isAddingHabit, setIsAddingHabit] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitDef | null>(null);
  const [showHabitsInToday, setShowHabitsInToday] = useState(true);
  const [showScheduleInToday, setShowScheduleInToday] = useLocalStorage<boolean>('pom_schedule_in_today', true);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const wsPickerRef = useRef<HTMLDivElement>(null);

  // Workspace-filtered habits and meetings (meetings: only today's occurrences)
  const visibleHabits = habits.filter(h => activeWsId === 'all' || h.workspaceId === activeWsId || h.workspaceId == null);
  const visibleMeetings = meetings.filter(m => {
    if (activeWsId !== 'all' && m.workspaceId !== activeWsId && m.workspaceId != null) return false;
    return m.time.slice(0, 10) === today;
  });

  const activeWs = workspaces.find(w => w.id === activeWsId);

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const priorityIdList = todayPriorities.map(t => t.id);
    const taskIdList = todayTasks.map(t => t.id);

    const isFromPriority = priorityIdList.includes(activeId);
    const isOverPriority = priorityIdList.includes(overId) || overId === 'droppable-priority';
    const isOverTasks = taskIdList.includes(overId) || overId === 'droppable-tasks';

    if (isFromPriority && isOverPriority) {
      // Reorder within priorities
      const oldIdx = priorityIdList.indexOf(activeId);
      const newIdx = overId === 'droppable-priority' ? priorityIdList.length - 1 : priorityIdList.indexOf(overId);
      onReorderToday(arrayMove(priorityIdList, oldIdx, newIdx), taskIdList);
    } else if (!isFromPriority && isOverTasks) {
      // Reorder within other tasks
      const oldIdx = taskIdList.indexOf(activeId);
      const newIdx = overId === 'droppable-tasks' ? taskIdList.length - 1 : taskIdList.indexOf(overId);
      onReorderToday(priorityIdList, arrayMove(taskIdList, oldIdx, newIdx));
    } else if (!isFromPriority && isOverPriority) {
      // Move from other tasks → priorities
      const destIdx = overId === 'droppable-priority' ? priorityIdList.length : priorityIdList.indexOf(overId);
      const newPriorityIds = [...priorityIdList];
      newPriorityIds.splice(destIdx, 0, activeId);
      const newTaskIds = taskIdList.filter(id => id !== activeId);
      // If over the limit, bump the last priority down to tasks
      if (newPriorityIds.length > 3) {
        const bumped = newPriorityIds.pop()!;
        newTaskIds.unshift(bumped);
      }
      onReorderToday(newPriorityIds, newTaskIds);
    } else if (isFromPriority && isOverTasks) {
      // Move from priorities → other tasks
      const destIdx = overId === 'droppable-tasks' ? taskIdList.length : taskIdList.indexOf(overId);
      const newPriorityIds = priorityIdList.filter(id => id !== activeId);
      const newTaskIds = [...taskIdList];
      newTaskIds.splice(destIdx, 0, activeId);
      onReorderToday(newPriorityIds, newTaskIds);
    }
  }, [todayPriorities, todayTasks, onReorderToday]);

  // Derive today's counters/done from Dexie habitHistory
  const habitCounters: Record<string, number> = {};
  const habitDone: Record<string, boolean> = {};
  for (const r of todayHabitRecords) {
    if (r.count != null) habitCounters[r.habitId] = r.count;
    if (r.done != null) habitDone[r.habitId] = r.done;
  }

  const handleHabitCounterChange = useCallback(async (id: string, delta: number) => {
    const habit = habits.find(h => h.id === id);
    const goal = habit?.goal;
    const existing = await db.habitHistory.get([id, today]);
    const newCount = Math.max(0, (existing?.count ?? 0) + delta);
    const justCompleted = goal != null && newCount >= goal && (existing?.count ?? 0) < goal;
    await db.habitHistory.put({
      habitId: id,
      date: today,
      ...(existing ?? {}),
      count: newCount,
      ...(goal != null ? { goal } : {}),
      ...(justCompleted ? { completedAt: now() } : {}),
      updatedAt: now(),
    });
  }, [habits, today]);

  const handleHabitToggle = useCallback(async (id: string) => {
    const existing = await db.habitHistory.get([id, today]);
    const nowDone = !(existing?.done ?? false);
    await db.habitHistory.put({
      habitId: id,
      date: today,
      ...(existing ?? {}),
      done: nowDone,
      ...(nowDone ? { completedAt: now() } : {}),
      updatedAt: now(),
    });
  }, [today]);

  const [selectedMeeting, setSelectedMeeting] = useState<CalendarMeeting | null>(null);
  const [dismissedTicketId, setDismissedTicketId] = useState<string | null>(null);
  useEffect(() => {
    chrome.storage.session.get('dismissed_ticket_id').then(r => {
      if (r.dismissed_ticket_id) setDismissedTicketId(r.dismissed_ticket_id as string);
    });
  }, []);
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [detachPicker, setDetachPicker] = useState(false);

  const updateMeeting = async (id: string, updates: Partial<CalendarMeeting>) => {
    await db.meetings.update(id, { ...updates, updatedAt: now() });
    setSelectedMeeting(prev => prev?.id === id ? { ...prev, ...updates } : prev);
  };

  const isActive = timerState.status === 'active';
  const isPaused = timerState.status === 'paused';
  const isBreak = timerState.status === 'break';
  const isPomoDone = timerState.status === 'pomo-done';
  const isBreakDone = timerState.status === 'break-done';
  const hasTask = !!timerState.taskId;

  // ■ Finish for stopwatch — update meeting loggedMinutes then call prop
  const handleStopwatchFinish = (closeTask: boolean) => {
    if (timerState.taskId && timerState.taskSegmentStartedAt) {
      const elapsed = Math.floor((Date.now() - timerState.taskSegmentStartedAt) / 1000);
      const meetingMatch = meetings.find(m => m.id === timerState.taskId);
      if (meetingMatch) {
        void updateMeeting(timerState.taskId, { loggedMinutes: Math.max(1, Math.ceil(elapsed / 60)) });
      }
    }
    void onFinishStopwatch(closeTask);
  };

  const priorityIds = new Set(todayPriorities.map(t => t.id));
  const taskIds = new Set(todayTasks.map(t => t.id));
  const isInToday = (id: string) => priorityIds.has(id) || taskIds.has(id);

  const handlePlayTask = (task: SelectedTask) => {
    if (isActive && timerState.mode === 'pomodoro') {
      // Pomodoro running — attach task directly (no mode picker needed, pomo doesn't reset)
      void onAttachTask({
        taskId: task.id,
        taskTitle: task.title,
        ticketId: null,
        ticketExternalId: task.ticketId,
      });
    } else {
      // No timer running (or stopwatch running) — show mode picker
      setShowModePicker(task);
    }
  };

  // Ring calculations
  let pomodoroElapsed = 0;
  if (isActive && timerState.pomodoroStartedAt !== null) {
    pomodoroElapsed = Math.floor((Date.now() - timerState.pomodoroStartedAt) / 1000);
  } else if (isPaused && timerState.pomodoroStartedAt !== null && timerState.pomoPausedAt !== null) {
    pomodoroElapsed = Math.floor((timerState.pomoPausedAt - timerState.pomodoroStartedAt) / 1000);
  }
  let stopwatchElapsed = 0;
  if (isActive && timerState.mode === 'stopwatch' && timerState.taskSegmentStartedAt !== null) {
    stopwatchElapsed = Math.floor((Date.now() - timerState.taskSegmentStartedAt) / 1000);
  }
  const planned = timerState.plannedDurationSeconds ?? timerSettings.focusSeconds;
  const remaining = Math.max(0, planned - pomodoroElapsed);
  const progress = timerState.mode === 'pomodoro' ? 1 - remaining / planned : 0;
  const timeLabel = timerState.mode === 'pomodoro' ? formatTime(remaining) : formatElapsed(stopwatchElapsed);

  // Break ring calculations
  let breakElapsed = 0;
  if (isBreak && timerState.breakStartedAt !== null) {
    breakElapsed = Math.floor((Date.now() - timerState.breakStartedAt) / 1000);
  }
  const breakPlanned = timerState.breakDurationSeconds ?? timerSettings.shortBreakSeconds;
  const breakRemaining = Math.max(0, breakPlanned - breakElapsed);
  const breakProgress = 1 - breakRemaining / breakPlanned;

  const completedPriorities = todayPriorities.filter(t => t.status === 'done').length;
  const completedTasks = todayTasks.filter(t => t.status === 'done').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div ref={wsPickerRef}>
          <button
            onClick={() => setShowWsPicker(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <span style={{
              width: 28, height: 28, borderRadius: 7,
              background: activeWs?.color ?? 'var(--color-accent)', color: '#fff',
              fontSize: 13, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {activeWsId === 'all' ? '✦' : (activeWs?.name?.[0]?.toUpperCase() ?? 'W')}
            </span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
              {activeWsId === 'all' ? 'All' : (activeWs?.name ?? 'Work')}
            </span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: -2 }}>▾</span>
          </button>
          {showWsPicker && (() => {
            const rect = wsPickerRef.current?.getBoundingClientRect();
            return (<>
              <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setShowWsPicker(false)} />
              <div
                style={{
                  position: 'fixed',
                  top: (rect?.bottom ?? 48) + 6,
                  left: rect?.left ?? 14,
                  zIndex: 99,
                  minWidth: 190, padding: 6,
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
              {/* All option */}
              <button
                onClick={() => { onSetActiveWs('all'); setShowWsPicker(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${activeWsId === 'all' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: activeWsId === 'all' ? 'var(--color-accent-soft)' : 'transparent',
                  color: activeWsId === 'all' ? 'var(--color-accent)' : 'var(--color-text)',
                  fontSize: 12, fontWeight: activeWsId === 'all' ? 700 : 500,
                }}
              >
                <span style={{ fontSize: 12 }}>✦</span> All workspaces
                {activeWsId === 'all' && <span style={{ marginLeft: 'auto', fontSize: 11 }}>✓</span>}
              </button>
              {workspaces.length > 0 && <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />}
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => { onSetActiveWs(ws.id); setShowWsPicker(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
                    border: `1px solid ${activeWsId === ws.id ? ws.color : 'var(--color-border)'}`,
                    background: activeWsId === ws.id ? `${ws.color}18` : 'transparent',
                    color: 'var(--color-text)',
                    fontSize: 12, fontWeight: activeWsId === ws.id ? 700 : 500,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: ws.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{ws.name}</span>
                  {activeWsId === ws.id && <span style={{ fontSize: 11, color: ws.color }}>✓</span>}
                </button>
              ))}
              <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
              <button
                onClick={() => { setShowWsPicker(false); onOpenSettings(); }}
                style={{ padding: '6px 10px', fontSize: 11, fontWeight: 500, color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', borderRadius: 'var(--radius-sm)' }}
              >
                Manage workspaces →
              </button>
            </div>
            </>);
          })()}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--color-text-faint)', userSelect: 'none' }}>
          POMODOSO
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          <IconButton title="Add task" onClick={() => setShowQuickAdd(true)}>+</IconButton>
          <IconButton title="Settings" onClick={onOpenSettings}>⚙</IconButton>
          <IconButton title="Open app" onClick={() => chrome.tabs.create({ url: 'https://app.pomodoso.app' })}>↗</IconButton>
        </div>
      </div>

      {/* ── Quick add ── */}
      {showQuickAdd && (
        <QuickAddForm
          onSave={(title) => { onCreateTask(title); setShowQuickAdd(false); }}
          onCancel={() => setShowQuickAdd(false)}
        />
      )}

      {/* ── Mode picker modal ── */}
      {showModePicker && (
        <ModePickerModal
          task={showModePicker}
          timerSettings={timerSettings}
          onStart={(mode) => {
            void onStartTimer({
              mode,
              taskId: showModePicker.id,
              taskTitle: showModePicker.title,
              ticketId: null,
              ticketExternalId: showModePicker.ticketId,
            });
            setShowModePicker(null);
          }}
          onClose={() => setShowModePicker(null)}
        />
      )}

      {/* ── Timer area (active session) ── */}
      {isActive && (
        <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <TimerRing mode={timerState.mode} progress={progress} timeLabel={timeLabel} isActive={true} />
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hasTask ? (
              <>
                {timerState.ticketExternalId && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-info)', marginRight: 5 }}>
                    {timerState.ticketExternalId}
                  </span>
                )}
                {timerState.taskTitle}
              </>
            ) : timerState.mode === 'pomodoro' ? (
              <span style={{ fontStyle: 'italic', color: 'var(--color-text-faint)' }}>No task · pick one below ↓</span>
            ) : null}
          </div>

          {/* Pomo counter (only for pomodoro mode) */}
          {timerState.mode === 'pomodoro' && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-faint)' }}>
              🍅 {timerState.pomosCompletedToday}/{timerState.pomosGoal}
            </div>
          )}

          {/* Paused pomo indicator (shown during meeting stopwatch) */}
          {timerState.mode === 'stopwatch' && timerState.pausedPomodoro && (
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-faint)', fontStyle: 'italic' }}>
              ⏸ Pomodoro paused · {formatTime(timerState.pausedPomodoro.remainingSeconds)} left
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            {timerState.mode === 'stopwatch' ? (
              /* Stopwatch (meeting) buttons */
              cancelConfirm ? (
                <>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Cancel meeting?</span>
                  <button
                    onClick={() => { void onCancelTimer(); setCancelConfirm(false); }}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    Yes, cancel
                  </button>
                  <button
                    onClick={() => setCancelConfirm(false)}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    No
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => handleStopwatchFinish(false)}
                    style={{ padding: '5px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)', background: 'var(--color-success)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    ■ Log time
                  </button>
                  <button
                    onClick={() => handleStopwatchFinish(true)}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                    title="Log time and mark task as done"
                  >
                    ✓ Done
                  </button>
                  <button
                    onClick={() => setCancelConfirm(true)}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
                    title="Cancel (no time logged)"
                  >
                    ✗
                  </button>
                </>
              )
            ) : cancelConfirm ? (
              /* Pomodoro cancel confirm */
              <>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Cancel pomodoro?</span>
                <button
                  onClick={() => { void onCancelTimer(); setCancelConfirm(false); }}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  Yes, cancel
                </button>
                <button
                  onClick={() => setCancelConfirm(false)}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  No
                </button>
              </>
            ) : hasTask ? (
              /* Pomodoro with task */
              detachPicker ? (
                <>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Task:</span>
                  <button
                    onClick={() => { void onDetachTask(); setDetachPicker(false); }}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    ⏸ Pause
                  </button>
                  <button
                    onClick={() => { void onDoneTask(); setDetachPicker(false); }}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)', background: 'var(--color-success)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    ✓ Done
                  </button>
                  <button
                    onClick={() => setDetachPicker(false)}
                    style={{ padding: '5px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
                  >
                    ✗
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setDetachPicker(true)}
                    style={{ padding: '5px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                  >
                    ⏸ Task…
                  </button>
                  <button
                    onClick={() => setCancelConfirm(true)}
                    style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
                    title="Cancel pomodoro (no credit)"
                  >
                    ✗
                  </button>
                </>
              )
            ) : (
              /* Pomodoro without task */
              <>
                <button
                  onClick={() => void onPausePomo()}
                  style={{ padding: '5px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  ⏸ Pause
                </button>
                <button
                  onClick={() => void onCompletePomo()}
                  style={{ padding: '5px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)', background: 'var(--color-success)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  ✓ Complete pomo
                </button>
                <button
                  onClick={() => setCancelConfirm(true)}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
                  title="Cancel pomodoro (no credit)"
                >
                  ✗
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Paused timer area ── */}
      {isPaused && (
        <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <TimerRing mode="pomodoro" progress={progress} timeLabel={timeLabel} isActive={false} />
          <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--color-warning)' }}>Paused</div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-faint)' }}>
            🍅 {timerState.pomosCompletedToday}/{timerState.pomosGoal}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
            {cancelConfirm ? (
              <>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Cancel pomodoro?</span>
                <button
                  onClick={() => { void onCancelTimer(); setCancelConfirm(false); }}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  Yes, cancel
                </button>
                <button
                  onClick={() => setCancelConfirm(false)}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  No
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => void onResumePomo()}
                  style={{ padding: '5px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-accent)', background: 'var(--color-accent)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  ▶ Resume
                </button>
                <button
                  onClick={() => void onCompletePomo()}
                  style={{ padding: '5px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)', background: 'var(--color-success)', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
                >
                  ✓ Complete pomo
                </button>
                <button
                  onClick={() => setCancelConfirm(true)}
                  style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
                  title="Cancel pomodoro (no credit)"
                >
                  ✗
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Break area ── */}
      {isBreak && (
        <div style={{ padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <TimerRing mode="stopwatch" progress={breakProgress} timeLabel={formatTime(breakRemaining)} isActive={true} />
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>☕ Break time!</div>
          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-faint)' }}>
            🍅 {timerState.pomosCompletedToday}/{timerState.pomosGoal}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              onClick={() => void onStartNextPomo()}
              style={{ padding: '5px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #4A6FA5', background: '#4A6FA5', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ▶ Start now
            </button>
            <button
              onClick={() => void onExtendBreak()}
              style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
              title="Extend break by 5 minutes"
            >
              +5m
            </button>
            <button
              onClick={() => void onCancelTimer()}
              style={{ padding: '5px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
              title="Skip break"
            >
              ✗
            </button>
          </div>
        </div>
      )}

      {/* ── Pomo done — take a break ── */}
      {isPomoDone && (
        <div style={{ padding: '16px 14px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexShrink: 0, gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>🍅 Take a break!</div>
          {timerState.breakPromptEndsAt && (
            <>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>break starts in</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--color-accent)', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {formatTime(Math.max(0, Math.floor((timerState.breakPromptEndsAt - Date.now()) / 1000)))}
              </div>
            </>
          )}
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
            {timerState.pomosCompletedToday}/{timerState.pomosGoal} today
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={() => void onStartBreak()}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-success)', background: 'var(--color-success)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ☕ Start break
            </button>
            <button
              onClick={() => void onSnooze()}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
              title="Delay break by 5 minutes"
            >
              💤 +5m
            </button>
            <button
              onClick={() => void onCancelTimer()}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* ── Break done — start next pomo? ── */}
      {isBreakDone && (
        <div style={{ padding: '16px 14px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderBottom: '1px solid var(--color-border)', flexShrink: 0, gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>🏃 Break's over!</div>
          {timerState.breakPromptEndsAt && (
            <>
              <div style={{ fontSize: 10, color: 'var(--color-text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>next pomodoro in</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: '#4A6FA5', letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {formatTime(Math.max(0, Math.floor((timerState.breakPromptEndsAt - Date.now()) / 1000)))}
              </div>
            </>
          )}
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
            {timerState.pomosCompletedToday}/{timerState.pomosGoal} today
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              onClick={() => void onStartNextPomo()}
              style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', border: '1px solid #4A6FA5', background: '#4A6FA5', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              ▶ Start now
            </button>
            <button
              onClick={() => void onSnooze()}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
              title="Delay next pomodoro by 5 minutes"
            >
              💤 +5m
            </button>
            <button
              onClick={() => void onCancelTimer()}
              style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Detection banner ── */}
      {(() => {
        if (!detectedTicket || isBreak || detectedTicket.external_id === dismissedTicketId) return null;
        const todayIds = new Set([...todayPriorities, ...todayTasks].map(t => t.id));
        const visibleTasks = detectedExistingTasks.filter(t => !todayIds.has(t.id));
        const bannerMode = visibleTasks.length > 0 ? 'view' : (detectedExistingTasks.length > 0 ? null : 'add');
        if (bannerMode === null) return null;
        return (
          <DetectionBanner
            ticket={detectedTicket}
            mode={bannerMode}
            relatedTasks={visibleTasks}
            onAdd={() => onAddToBacklog(detectedTicket)}
            onSelect={onSelectTask}
            onLink={() => onLinkToTask(detectedTicket)}
            onCreateFollowup={onCreateFollowup}
            onDismiss={() => {
              setDismissedTicketId(detectedTicket.external_id);
              void chrome.storage.session.set({ dismissed_ticket_id: detectedTicket.external_id });
            }}
          />
        );
      })()}

      {/* ── Linked tasks banner ── */}
      {linkedTasks.length > 0 && !linkedDismissed && !isBreak && (
        <LinkedTasksBanner
          tasks={linkedTasks}
          onSelect={onSelectLinkedTask}
          onDismiss={() => setLinkedDismissed(true)}
        />
      )}

      {/* ── Selection banner ── */}
      {selectedText && !selectionDismissed && !isActive && !isBreak && (
        <SelectionBanner
          text={selectedText}
          onCreate={() => onCreateFromText(selectedText)}
          onAddToNotes={() => onAddTextToNotes(selectedText)}
          onDismiss={() => setSelectionDismissed(true)}
        />
      )}

      {/* ── Tab content ── */}
      <div className="scroll-area">
        {activeTab === 'today' && (
          <>
            {!isActive && !isPaused && !isBreak && !isPomoDone && !isBreakDone && (
              <div style={{ padding: '8px 14px 0', display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={() => void onStartTimer({ mode: 'pomodoro', taskId: null, taskTitle: null, ticketId: null, ticketExternalId: null })}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: 'var(--color-text-faint)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                  title="Start a pomodoro without selecting a task"
                >
                  ▶ start without a task
                </button>
              </div>
            )}
            {todayPriorities.length === 0 && todayTasks.length === 0 && activeWsId !== 'all' ? (
              <button
                onClick={() => setActiveTab('tasks')}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 8, padding: '36px 24px',
                  width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: 22 }}>🗓️</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>No tasks for today yet</span>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  Pick tasks from your backlog or create new ones to plan your day.
                </span>
                <span style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-accent)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '4px 12px' }}>
                  Go to Tasks →
                </span>
              </button>
            ) : (
              <DndContext
                sensors={dndSensors}
                onDragStart={(e) => setDragActiveId(e.active.id as string)}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setDragActiveId(null)}
              >
                <div style={{ padding: '12px 14px 0' }}>
                  <SectionHeader label="Today's priorities" done={completedPriorities} total={todayPriorities.length} />
                  <SortableContext items={todayPriorities.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {todayPriorities.map((task, idx) => {
                      const proj = projectById(task.projectId);
                      const ws = activeWsId === 'all' ? workspaces.find(w => w.id === task.workspaceId) : undefined;
                      return (
                        <SortableTaskRow
                          key={task.id}
                          index={idx + 1}
                          task={task}
                          {...(proj ? { project: proj } : {})}
                          {...(ws ? { workspaceBadge: ws } : {})}
                          isActiveTask={isActive && timerState.taskId === task.id}
                          timerRunning={isActive}
                          timerHasTask={hasTask}
                          onSelect={() => onSelectTask(task)}
                          onPlay={() => handlePlayTask(task)}
                          onDone={() => void onDoneTask()}
                          onDetach={() => void onDetachTask()}
                          onStatusChange={(status) => onUpdateTaskStatus(task.id, status)}
                        />
                      );
                    })}
                  </SortableContext>
                  <DroppableArea id="droppable-priority" />
                </div>
                <div style={{ padding: '12px 14px 0' }}>
                  <SectionHeader label="Other tasks" done={completedTasks} total={todayTasks.length} />
                  <SortableContext items={todayTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    {todayTasks.map((task) => {
                      const proj = projectById(task.projectId);
                      const ws = activeWsId === 'all' ? workspaces.find(w => w.id === task.workspaceId) : undefined;
                      return (
                        <SortableTaskRow
                          key={task.id}
                          task={task}
                          {...(proj ? { project: proj } : {})}
                          {...(ws ? { workspaceBadge: ws } : {})}
                          isActiveTask={isActive && timerState.taskId === task.id}
                          timerRunning={isActive}
                          timerHasTask={hasTask}
                          onSelect={() => onSelectTask(task)}
                          onPlay={() => handlePlayTask(task)}
                          onDone={() => void onDoneTask()}
                          onDetach={() => void onDetachTask()}
                          onStatusChange={(status) => onUpdateTaskStatus(task.id, status)}
                        />
                      );
                    })}
                  </SortableContext>
                  <DroppableArea id="droppable-tasks" />
                </div>
                <DragOverlay>
                  {dragActiveId && (() => {
                    const allToday = [...todayPriorities, ...todayTasks];
                    const task = allToday.find(t => t.id === dragActiveId);
                    if (!task) return null;
                    const proj = projectById(task.projectId);
                    const priorityIdx = todayPriorities.findIndex(t => t.id === dragActiveId);
                    return (
                      <div style={{ opacity: 0.85, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', borderRadius: 'var(--radius-md)' }}>
                        <TaskRow
                          task={task}
                          {...(priorityIdx >= 0 ? { index: priorityIdx + 1 } : {})}
                          {...(proj ? { project: proj } : {})}
                          isActiveTask={false}
                          timerRunning={false}
                          timerHasTask={false}
                          onSelect={() => {}}
                          onPlay={() => {}}
                          onDone={() => {}}
                          onDetach={() => {}}
                          onStatusChange={() => {}}
                        />
                      </div>
                    );
                  })()}
                </DragOverlay>
              </DndContext>
            )}
            {showScheduleInToday && (
              <div style={{ padding: '12px 14px 0' }}>
                <SectionHeader
                  label="Meetings"
                  done={visibleMeetings.filter(m => m.trackMode !== 'off' && m.logged).length}
                  total={visibleMeetings.filter(m => m.trackMode !== 'off').length}
                />
                {visibleMeetings.filter(m => m.trackMode !== 'off').length === 0 ? (
                  <div style={{ padding: '8px 0 4px', fontSize: 12, color: 'var(--color-text-faint)', textAlign: 'center' }}>
                    No meetings today
                  </div>
                ) : visibleMeetings.filter(m => m.trackMode !== 'off').map(meeting => (
                  <TodayMeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    timezone={timezone}
                    onStart={() => {
                      void onStartTimer({
                        mode: 'stopwatch',
                        taskId: meeting.id,
                        taskTitle: meeting.title,
                        ticketId: null,
                        ticketExternalId: null,
                      });
                      void updateMeeting(meeting.id, { logged: true, loggedMinutes: meeting.durationMinutes });
                    }}
                    onSelect={() => {
                      setSelectedMeeting(meeting);
                      setActiveTab('schedule');
                    }}
                  />
                ))}
              </div>
            )}
            {showHabitsInToday && (
              <TodayHabits
                habits={visibleHabits}
                habitCounters={habitCounters}
                habitDone={habitDone}
                onCounterChange={handleHabitCounterChange}
                onToggle={handleHabitToggle}
              />
            )}
            <TodayFooter
              pomosToday={timerState.pomosCompletedToday}
              trackedMinutesToday={Math.floor(
                [...new Map(
                  [...todayPriorities, ...todayTasks, ...backlog, ...completedToday].map(t => [t.id, t])
                ).values()]
                  .flatMap(t => t.timeLogs ?? [])
                  .filter(e => e.startedAt.slice(0, 10) === today)
                  .reduce((sum, e) => sum + e.durationSeconds, 0) / 60
              )}
              meetingMinutesToday={visibleMeetings.filter(m => m.logged).reduce((sum, m) => sum + (m.loggedMinutes ?? 0), 0)}
              tasksDone={[...todayPriorities, ...todayTasks].filter(t => t.status === 'done').length}
              tasksTotal={todayPriorities.length + todayTasks.length}
            />
          </>
        )}

        {activeTab === 'habits' && (
          isAddingHabit ? (
            <HabitForm
              onSave={(habit) => {
                void db.habits.put({ ...habit, workspaceId: activeWsId === 'all' ? null : activeWsId, updatedAt: now() });
                setIsAddingHabit(false);
              }}
              onCancel={() => setIsAddingHabit(false)}
            />
          ) : editingHabit ? (
            <HabitForm
              initialHabit={editingHabit}
              onSave={(updated) => {
                void db.habits.update(editingHabit.id, { ...updated, updatedAt: now() });
                setEditingHabit(null);
              }}
              onCancel={() => setEditingHabit(null)}
            />
          ) : (
            <>
              <div style={{ display: 'flex', gap: 4, padding: '10px 14px 0' }}>
                <TasksSubTabButton active={habitsSubTab === 'today'} onClick={() => setHabitsSubTab('today')}>Today</TasksSubTabButton>
                <TasksSubTabButton active={habitsSubTab === 'history'} onClick={() => setHabitsSubTab('history')}>History</TasksSubTabButton>
              </div>
              {habitsSubTab === 'today' ? (
                <HabitsContent
                  habits={visibleHabits}
                  habitCounters={habitCounters}
                  habitDone={habitDone}
                  showInToday={showHabitsInToday}
                  onCounterChange={handleHabitCounterChange}
                  onToggle={handleHabitToggle}
                  onToggleShowInToday={() => setShowHabitsInToday(v => !v)}
                  onAddHabit={() => setIsAddingHabit(true)}
                  onEditHabit={setEditingHabit}
                  onDeleteHabit={(id) => void db.habits.update(id, { deletedAt: now(), updatedAt: now() })}
                />
              ) : (
                <HabitHistoryView habits={visibleHabits} timezone={timezone} />
              )}
            </>
          )
        )}

        {activeTab === 'tasks' && (
          <>
            {/* Sub-tab toggle */}
            <div style={{ display: 'flex', gap: 4, padding: '10px 14px 0' }}>
              <TasksSubTabButton active={tasksSubTab === 'backlog'} onClick={() => setTasksSubTab('backlog')}>Backlog</TasksSubTabButton>
              <TasksSubTabButton active={tasksSubTab === 'history'} onClick={() => setTasksSubTab('history')}>History</TasksSubTabButton>
            </div>

            {tasksSubTab === 'backlog' && (
              <>
                <div style={{ padding: '8px 14px 0' }}>
                  <SectionHeader label="Backlog" done={0} total={backlog.length} />
                  {backlog.map((task) => {
                    const proj = projectById(task.projectId);
                    return (
                      <BacklogRow
                        key={task.id}
                        task={task}
                        {...(proj ? { project: proj } : {})}
                        isInPriorities={priorityIds.has(task.id)}
                        isInTasks={taskIds.has(task.id)}
                        prioritiesFull={prioritiesFull}
                        onAddToPriorities={() => onAddToPriorities(task)}
                        onAddToTasks={() => onAddToTasks(task)}
                        onRemove={() => onRemoveFromToday(task.id)}
                        onSelect={() => onSelectTask(task)}
                      />
                    );
                  })}
                </div>
                <div style={{ padding: '8px 14px 12px' }}>
                  <button
                    onClick={() => setShowQuickAdd(true)}
                    style={{
                      width: '100%', padding: '9px 0',
                      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)', color: 'var(--color-text)',
                      fontSize: 13, fontWeight: 500, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Add task
                  </button>
                </div>
              </>
            )}

            {tasksSubTab === 'history' && (
              <TaskHistoryView
                activeWsId={activeWsId}
                projects={projects}
                timezone={timezone}
                onSelectTask={onSelectTask}
                onSelectMeeting={(m) => {
                  setSelectedMeeting(m);
                  setActiveTab('schedule');
                }}
              />
            )}
          </>
        )}

        {activeTab === 'schedule' && (
          selectedMeeting ? (
            <MeetingDetailState
              meeting={selectedMeeting}
              projects={projects}
              timezone={timezone}
              onBack={() => setSelectedMeeting(null)}
              onUpdate={(updates) => void updateMeeting(selectedMeeting.id, updates)}
              onStart={() => {
                void onStartTimer({
                  mode: 'stopwatch',
                  taskId: selectedMeeting.id,
                  taskTitle: selectedMeeting.title,
                  ticketId: null,
                  ticketExternalId: null,
                });
                void updateMeeting(selectedMeeting.id, { logged: true, loggedMinutes: selectedMeeting.durationMinutes });
                setSelectedMeeting(null);
              }}
            />
          ) : (
            <ScheduleContent
              meetings={visibleMeetings}
              projects={projects}
              workspaces={workspaces}
              activeWsId={activeWsId}
              timezone={timezone}
              showInToday={showScheduleInToday}
              onToggleShowInToday={() => setShowScheduleInToday(v => !v)}
              onSelectMeeting={setSelectedMeeting}
              onTrackModeChange={(id, trackMode) => void updateMeeting(id, { trackMode })}
              onOpenCalendarSettings={onOpenCalendarSettings}
              onStart={(meeting) => {
                void onStartTimer({
                  mode: 'stopwatch',
                  taskId: meeting.id,
                  taskTitle: meeting.title,
                  ticketId: null,
                  ticketExternalId: null,
                });
                void updateMeeting(meeting.id, { logged: true, loggedMinutes: meeting.durationMinutes });
              }}
            />
          )
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', flexShrink: 0,
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
      }}>
        {([
          { key: 'today' as Tab, label: 'Today', icon: <TodayIcon /> },
          { key: 'tasks' as Tab, label: 'Tasks', icon: <TasksIcon /> },
          { key: 'habits' as Tab, label: 'Habits', icon: <HabitsIcon /> },
          { key: 'schedule' as Tab, label: 'Schedule', icon: <ScheduleIcon /> },
        ]).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setIsAddingHabit(false); }}
            style={{
              flex: 1, padding: '8px 4px 6px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === key ? 'var(--color-accent)' : 'var(--color-text-muted)',
            }}
          >
            {icon}
            <span style={{ fontSize: 10, fontWeight: activeTab === key ? 600 : 400 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModePickerModal({ task, timerSettings, onStart, onClose }: {
  task: SelectedTask;
  timerSettings: TimerSettings;
  onStart: (mode: 'pomodoro' | 'stopwatch') => void;
  onClose: () => void;
}) {
  const focusMin = Math.round(timerSettings.focusSeconds / 60);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '16px 14px',
        width: 240,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Start: {task.title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            onClick={() => onStart('pomodoro')}
            style={{
              padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              background: 'rgba(200,85,61,0.08)', border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)', fontSize: 13, fontWeight: 600, textAlign: 'left',
            }}
          >
            🍅 Pomodoro ({focusMin}m)
          </button>
          <button
            onClick={() => onStart('stopwatch')}
            style={{
              padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              color: 'var(--color-text)', fontSize: 13, fontWeight: 500, textAlign: 'left',
            }}
          >
            ⏱ Log time only
          </button>
        </div>
      </div>
    </div>
  );
}

function TodayMeetingRow({ meeting, timezone, onStart, onSelect }: {
  meeting: CalendarMeeting;
  timezone: string;
  onStart: () => void;
  onSelect: () => void;
}) {
  const mins = meeting.logged && meeting.loggedMinutes != null ? meeting.loggedMinutes : meeting.durationMinutes;
  const durLabel = mins >= 60 ? `${Math.round(mins / 6) / 10}h` : `${mins}m`;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 8px 6px 10px', marginBottom: 4,
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      opacity: meeting.past ? 0.65 : 1,
    }}>
      <span style={{ fontSize: 11, lineHeight: 1, flexShrink: 0 }}>📅</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {to12h(meeting.time, timezone)}
      </span>
      <button
        onClick={onSelect}
        style={{
          flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left', padding: 0,
          fontSize: 13, color: 'var(--color-text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {meeting.title}
      </button>
      <span style={{ fontSize: 11, color: meeting.logged ? 'var(--color-success)' : 'var(--color-text-faint)', flexShrink: 0 }}>{durLabel}</span>
      {meeting.logged ? (
        <span style={{
          padding: '2px 7px', fontSize: 10, fontWeight: 700,
          background: 'var(--color-success)', color: '#fff',
          borderRadius: 4, flexShrink: 0,
        }}>✓</span>
      ) : !meeting.past ? (
        <button
          onClick={onStart}
          style={{
            padding: '2px 7px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
            background: 'none', color: 'var(--color-text-muted)', flexShrink: 0,
          }}
        >▶</button>
      ) : null}
    </div>
  );
}

function TodayHabits({
  habits, habitCounters, habitDone, onCounterChange, onToggle,
}: {
  habits: HabitDef[];
  habitCounters: Record<string, number>;
  habitDone: Record<string, boolean>;
  onCounterChange: (id: string, delta: number) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div style={{ padding: '12px 14px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
        Habits
      </div>
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        {habits.map((habit, idx) => {
          const count = habitCounters[habit.id] ?? 0;
          const checked = habitDone[habit.id] ?? false;
          const isDone = habit.kind === 'boolean' ? checked : count >= (habit.goal ?? 1);
          return (
            <div
              key={habit.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                background: isDone ? 'var(--color-success-bg)' : 'transparent',
              }}
            >
              <HabitIcon kind={habit.icon} size={24} />
              <span style={{
                flex: 1, fontSize: 13, fontWeight: 500,
                color: isDone ? 'var(--color-success)' : 'var(--color-text)',
                textDecoration: isDone && habit.kind === 'boolean' ? 'line-through' : 'none',
                opacity: isDone && habit.kind === 'boolean' ? 0.7 : 1,
              }}>
                {habit.name}
              </span>
              {habit.kind === 'counter' ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button
                      onClick={() => onCounterChange(habit.id, -1)}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >−</button>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, minWidth: 28, textAlign: 'center' }}>
                      {count}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{habit.goal}</span>
                    </span>
                    <button
                      onClick={() => onCounterChange(habit.id, 1)}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >+</button>
                  </div>
                  {habit.unit && habit.unitAmount && (
                    <span style={{ fontSize: 10, color: isDone ? 'var(--color-success)' : 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                      {count * habit.unitAmount}/{(habit.goal ?? 1) * habit.unitAmount}{habit.unit}
                    </span>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {habit.unit && habit.unitAmount && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                      {habit.unitAmount}{habit.unit}
                    </span>
                  )}
                  <button
                    onClick={() => onToggle(habit.id)}
                    style={{
                      width: 24, height: 24, borderRadius: 5, cursor: 'pointer',
                      border: checked ? '1.5px solid var(--color-success)' : '1.5px solid var(--color-border-strong)',
                      background: checked ? 'var(--color-success)' : 'var(--color-bg)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, color: checked ? '#fff' : 'transparent',
                    }}
                  >✓</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TodayFooter({
  pomosToday, trackedMinutesToday, meetingMinutesToday, tasksDone, tasksTotal,
}: {
  pomosToday: number;
  trackedMinutesToday: number;
  meetingMinutesToday: number;
  tasksDone: number;
  tasksTotal: number;
}) {
  const fmtTime = (mins: number) => {
    if (mins === 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  };

  const parts = [
    `${tasksDone}/${tasksTotal} tasks`,
    `${pomosToday} pomo${pomosToday !== 1 ? 's' : ''}`,
    `${fmtTime(trackedMinutesToday)} tracked`,
    ...(meetingMinutesToday > 0 ? [`${fmtTime(meetingMinutesToday)} meetings`] : []),
  ];

  return (
    <div style={{
      margin: '8px 14px 12px',
      paddingTop: 8,
      borderTop: '1px solid var(--color-border)',
      fontSize: 12,
      color: 'var(--color-text-faint)',
    }}>
      {parts.join(' · ')}
    </div>
  );
}

function SectionHeader({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 20, padding: '1px 8px' }}>
        {done} / {total}
      </span>
    </div>
  );
}

function fmtTotalTime(logs: TimeLogEntry[] | undefined): string | null {
  if (!logs || logs.length === 0) return null;
  const totalSecs = logs.reduce((sum, e) => sum + e.durationSeconds, 0);
  if (totalSecs < 60) return null;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtMins(totalMins: number): string {
  if (totalMins <= 0) return '';
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function TaskMeasurements({ task }: { task: SelectedTask }) {
  const timeStr = fmtTotalTime(task.timeLogs);
  const links = task.links?.length ?? 0;
  const isFollowup = !!task.parentId;
  if (!timeStr && links === 0 && !isFollowup) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--color-text-faint)', lineHeight: 1 }}>
      {timeStr && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><span>⏱</span><span>{timeStr}</span></span>}
      {links > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}><span>🔗</span><span>{links}</span></span>}
      {isFollowup && <span title="Follow-up task">↩</span>}
    </div>
  );
}

function TaskTooltip({
  task,
  project,
  workspaceBadge,
  anchor,
}: {
  task: SelectedTask;
  project?: Project;
  workspaceBadge?: Workspace;
  anchor: { top: number; left: number; width: number };
}) {
  const timeStr = fmtTotalTime(task.timeLogs);
  const pomoCount = task.timeLogs?.filter(l => l.mode === 'pomodoro').length ?? 0;
  const links = task.links?.length ?? 0;
  const isFollowup = !!task.parentId;

  const statusBadge: { label: string; color: string } | null =
    task.status === 'in_progress' ? { label: 'WIP', color: 'var(--color-warning)' }
    : task.status === 'delayed'   ? { label: 'Delayed', color: '#7B5DB4' }
    : task.status === 'cancelled' ? { label: 'Cancelled', color: 'var(--color-text-muted)' }
    : null;

  const hasTopRow = !!(statusBadge || task.ticketId);
  const hasMiddleRow = !!(timeStr || links > 0 || isFollowup);
  const hasBottomRow = !!(project || workspaceBadge);
  if (!hasTopRow && !hasMiddleRow && !hasBottomRow) return null;

  return (
    <div style={{
      position: 'fixed',
      top: anchor.top - 4,
      left: anchor.left,
      transform: 'translateY(-100%)',
      zIndex: 9999,
      minWidth: Math.max(anchor.width, 220),
      padding: '8px 10px',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
      pointerEvents: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontSize: 11,
    }}>
      {hasTopRow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {statusBadge && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600, color: statusBadge.color }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusBadge.color, flexShrink: 0 }} />
              {statusBadge.label}
            </span>
          )}
          {task.ticketId && (
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--color-info)' }}>
              {task.ticketId}
            </span>
          )}
        </div>
      )}
      {hasTopRow && (hasMiddleRow || hasBottomRow) && (
        <div style={{ height: 1, background: 'var(--color-border)', margin: '0 -10px' }} />
      )}
      {hasMiddleRow && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--color-text-muted)' }}>
          {timeStr && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⏱</span>
              <span>{timeStr}</span>
              {pomoCount > 0 && <span style={{ color: 'var(--color-text-faint)' }}>· 🍅 {pomoCount}</span>}
            </span>
          )}
          {links > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🔗</span>
              <span>{links} link{links > 1 ? 's' : ''}</span>
            </span>
          )}
          {isFollowup && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>↩</span>
              <span>Follow-up task</span>
            </span>
          )}
        </div>
      )}
      {hasBottomRow && (hasTopRow || hasMiddleRow) && (
        <div style={{ height: 1, background: 'var(--color-border)', margin: '0 -10px' }} />
      )}
      {hasBottomRow && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--color-text-muted)' }}>
          {project && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: project.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
            </span>
          )}
          {workspaceBadge && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: workspaceBadge.color, flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{workspaceBadge.name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function DroppableArea({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ height: 4, borderRadius: 4, transition: 'background 0.15s', background: isOver ? 'var(--color-accent)' : 'transparent', margin: '0 2px' }}
    />
  );
}

function SortableTaskRow(props: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
    >
      <TaskRow {...props} />
    </div>
  );
}

interface TaskRowProps {
  index?: number;
  task: SelectedTask & { status: TaskStatus };
  project?: Project;
  workspaceBadge?: Workspace;
  isActiveTask: boolean;
  timerRunning: boolean;
  timerHasTask: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onDone: () => void;
  onDetach: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

function TaskRow({ index, task, project, workspaceBadge, isActiveTask, timerRunning, timerHasTask, onSelect, onPlay, onDone, onDetach, onStatusChange }: TaskRowProps) {
  const isDone = task.status === 'done';
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const cardRef = useRef<HTMLDivElement>(null);
  // Fully interactive when no task is attached to the running timer
  const canPlay = !timerRunning || !timerHasTask || isActiveTask;
  const isSelectable = !timerRunning || !timerHasTask || isActiveTask;
  return (
    <div
      ref={cardRef}
      onClick={isSelectable ? onSelect : undefined}
      role={isSelectable ? 'button' : undefined}
      tabIndex={isSelectable ? 0 : undefined}
      onKeyDown={(e) => { if (isSelectable && e.key === 'Enter') onSelect(); }}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px 6px 9px',
        minHeight: 40,
        background: isActiveTask
          ? 'rgba(200, 85, 61, 0.04)'
          : task.status === 'done' ? 'var(--color-success-bg)' : 'var(--color-surface)',
        borderTop: `1px solid ${isActiveTask ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRight: `1px solid ${isActiveTask ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderBottom: `1px solid ${isActiveTask ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderLeft: project ? `3px solid ${project.color}` : `1px solid ${isActiveTask ? 'var(--color-accent)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)', marginBottom: 4,
        opacity: !isDone && timerRunning && timerHasTask && !isActiveTask ? 0.45 : 1,
        cursor: isSelectable ? 'pointer' : 'default',
      }}
    >
      {/* Status picker dropdown */}
      {showStatusPicker && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 50,
            marginTop: 4, padding: 6,
            background: 'var(--color-bg)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130,
          }}
        >
          {STATUS_OPTIONS.map(opt => {
            const isSelected = task.status === opt.value;
            const colors = STATUS_CHIP_COLORS[opt.value];
            return (
              <button
                key={opt.value}
                onClick={() => { onStatusChange(opt.value); setShowStatusPicker(false); }}
                style={{
                  padding: '5px 10px', fontSize: 11, fontWeight: isSelected ? 700 : 500,
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 7,
                  border: `1px solid ${isSelected ? colors.border : 'var(--color-border)'}`,
                  background: isSelected ? colors.bg : 'transparent',
                  color: 'var(--color-text)',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: colors.border }} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {index !== undefined ? (
        <button
          onClick={(e) => { e.stopPropagation(); setShowStatusPicker(v => !v); }}
          style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, background: isDone ? 'var(--color-success)' : 'var(--color-accent)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          {isDone ? '✓' : index}
        </button>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setShowStatusPicker(v => !v); }}
          style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${isDone ? 'var(--color-success)' : 'var(--color-border-strong)'}`, background: isDone ? 'var(--color-success)' : 'transparent', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
        >
          {isDone ? '✓' : ''}
        </button>
      )}
      {tooltipAnchor && <TaskTooltip task={task} project={project} workspaceBadge={workspaceBadge} anchor={tooltipAnchor} />}
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onMouseEnter={() => {
          clearTimeout(tooltipTimer.current);
          tooltipTimer.current = setTimeout(() => {
            const rect = cardRef.current?.getBoundingClientRect();
            if (rect) setTooltipAnchor({ top: rect.top, left: rect.left, width: rect.width });
          }, 250);
        }}
        onMouseLeave={() => { clearTimeout(tooltipTimer.current); setTooltipAnchor(null); }}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', textDecoration: isDone ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {task.title || <span style={{ color: 'var(--color-text-faint)', fontStyle: 'italic' }}>(untitled)</span>}
        </span>
        {workspaceBadge && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: workspaceBadge.color, flexShrink: 0 }} title={workspaceBadge.name} />
        )}
      </div>
      {isDone ? (
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          style={{ padding: '2px 8px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--color-text-muted)', flexShrink: 0 }}
        >
          View
        </button>
      ) : isActiveTask ? (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <SmallButton onClick={onDetach} title="Pause task (pomo keeps running)">⏸</SmallButton>
          <SmallButton onClick={onDone} title="Mark done (pomo keeps running)">✓</SmallButton>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); if (canPlay) onPlay(); }}
          title={canPlay ? 'Start now' : 'Already tracking another task'}
          disabled={!canPlay}
          style={{
            width: 26, height: 26, flexShrink: 0,
            border: `1px solid ${canPlay ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
            borderRadius: 6, background: 'transparent',
            color: canPlay ? 'var(--color-text-muted)' : 'var(--color-text-faint)',
            fontSize: 10, cursor: canPlay ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >▶</button>
      )}
    </div>
  );
}

function BacklogRow({ task, project, isInPriorities, isInTasks, prioritiesFull, onAddToPriorities, onAddToTasks, onRemove, onSelect }: {
  task: SelectedTask;
  project?: Project;
  isInPriorities: boolean;
  isInTasks: boolean;
  prioritiesFull: boolean;
  onAddToPriorities: () => void;
  onAddToTasks: () => void;
  onRemove: () => void;
  onSelect: () => void;
}) {
  const isAdded = isInPriorities || isInTasks;
  const [tooltipAnchor, setTooltipAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(); }}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 8px 6px 9px',
        background: 'var(--color-surface)',
        borderTop: '1px solid var(--color-border)',
        borderRight: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: project ? `3px solid ${project.color}` : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', marginBottom: 4,
        cursor: 'pointer',
      }}
    >
      {tooltipAnchor && <TaskTooltip task={task} project={project} anchor={tooltipAnchor} />}
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 3, alignSelf: 'flex-start',
          background: STATUS_DOT_COLOR[task.status],
        }}
        title={STATUS_LABELS[task.status]}
      />
      <div
        onMouseEnter={() => {
          clearTimeout(tooltipTimer.current);
          tooltipTimer.current = setTimeout(() => {
            const rect = cardRef.current?.getBoundingClientRect();
            if (rect) setTooltipAnchor({ top: rect.top, left: rect.left, width: rect.width });
          }, 250);
        }}
        onMouseLeave={() => { clearTimeout(tooltipTimer.current); setTooltipAnchor(null); }}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {task.title || <span style={{ color: 'var(--color-text-faint)', fontStyle: 'italic' }}>(untitled)</span>}
        </span>
        {project && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: project.color, flexShrink: 0 }} title={project.name} />
        )}
      </div>
      {isAdded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 6px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${isInPriorities ? 'var(--color-accent)' : 'var(--color-success)'}`,
            color: isInPriorities ? 'var(--color-accent)' : 'var(--color-success)',
          }}>
            {isInPriorities ? '★ Priority' : '✓ Today'}
          </span>
          <button onClick={onRemove} title="Remove from today" style={{ width: 20, height: 20, border: '1px solid var(--color-border)', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
        </div>
      ) : (task.status === 'done' || task.status === 'cancelled') ? (
        <button
          onClick={e => { e.stopPropagation(); onSelect(); }}
          style={{ padding: '2px 8px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--color-text-muted)', flexShrink: 0 }}
        >
          View
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {!prioritiesFull && (
            <button onClick={onAddToPriorities} title="Add as priority" style={{ padding: '2px 7px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--color-accent)' }}>★</button>
          )}
          <button onClick={onAddToTasks} title="Add to today's tasks" style={{ padding: '2px 7px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--color-text-muted)' }}>+ Today</button>
        </div>
      )}
    </div>
  );
}

function ScheduleContent({
  meetings, projects, workspaces, activeWsId, timezone, showInToday, onToggleShowInToday, onSelectMeeting, onTrackModeChange, onStart, onOpenCalendarSettings,
}: {
  meetings: CalendarMeeting[];
  projects: Project[];
  workspaces: Workspace[];
  activeWsId: string;
  timezone: string;
  showInToday: boolean;
  onToggleShowInToday: () => void;
  onSelectMeeting: (m: CalendarMeeting) => void;
  onTrackModeChange: (id: string, mode: MeetingTrackMode) => void;
  onStart: (m: CalendarMeeting) => void;
  onOpenCalendarSettings: () => void;
}) {
  const connectionsRow = useLiveQuery(() => db.settings.get('calendar_connections'));
  const connections = (connectionsRow?.value as Record<string, unknown> | undefined) ?? {};
  const hasCalendarConnected = activeWsId === 'all'
    ? Object.keys(connections).length > 0
    : connections[activeWsId] !== undefined;

  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const nextSoon = meetings.find(m => !m.past && m.minutesUntil !== undefined && m.minutesUntil >= 0 && m.minutesUntil <= 30);
  const trackedMinutes = meetings.reduce((sum, m) => sum + (m.loggedMinutes ?? 0), 0);

  return (
    <div style={{ padding: '12px 14px 0' }}>
      {/* Date strip */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 2 }}>
          Today · {dayName}
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{dateStr}</div>
      </div>

      {/* "Starting soon" banner */}
      {nextSoon && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 12px', marginBottom: 14,
          background: 'var(--color-accent-soft)',
          border: '1px solid var(--color-accent)',
          borderRadius: 'var(--radius-md)',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--color-accent)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, flexShrink: 0,
          }}>🔔</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-accent)', marginBottom: 1 }}>
              Starting in {nextSoon.minutesUntil} minute{nextSoon.minutesUntil !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nextSoon.title}
            </div>
          </div>
          <button
            onClick={() => onStart(nextSoon)}
            style={{
              padding: '6px 10px', background: 'var(--color-accent)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-sm)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            }}
          >
            ▶ Track
          </button>
        </div>
      )}

      {/* Section label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          Today's meetings · {meetings.length}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={onOpenCalendarSettings}
            title="Calendar settings"
            style={{
              fontSize: 12, cursor: 'pointer',
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 6px',
              color: 'var(--color-text-faint)',
              display: 'flex', alignItems: 'center',
            }}
          >
            ⚙
          </button>
          <button
            onClick={onToggleShowInToday}
            style={{
              fontSize: 10, fontWeight: showInToday ? 600 : 400, cursor: 'pointer',
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 7px',
              color: showInToday ? 'var(--color-accent)' : 'var(--color-text-faint)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          >
            <span>📌</span> {showInToday ? 'In Today' : 'Show in Today'}
          </button>
        </div>
      </div>

      {/* No calendar CTA */}
      {!hasCalendarConnected && meetings.length === 0 && (
        <div style={{
          margin: '4px 0 10px',
          padding: '14px 14px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Connect Google Calendar to see today's meetings here.
          </div>
          <button
            onClick={onOpenCalendarSettings}
            style={{
              alignSelf: 'flex-start', padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: 'var(--color-accent)', color: '#fff',
              border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            }}
          >
            Connect Calendar →
          </button>
        </div>
      )}

      {/* Timeline */}
      {(hasCalendarConnected || meetings.length > 0) && (
        <div style={{ position: 'relative', paddingLeft: 52 }}>
          <div style={{ position: 'absolute', left: 38, top: 8, bottom: 8, width: 1, background: 'var(--color-border)' }} />
          {meetings.map(meeting => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              projects={projects}
              timezone={timezone}
              workspace={activeWsId === 'all' ? workspaces.find(w => w.id === meeting.workspaceId) : undefined}
              onSelect={() => onSelectMeeting(meeting)}
              onTrackModeChange={(mode) => onTrackModeChange(meeting.id, mode)}
              onStart={() => onStart(meeting)}
            />
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div style={{
        marginTop: 12, paddingTop: 10, marginBottom: 12,
        borderTop: '1px solid var(--color-border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 11, color: 'var(--color-text-muted)',
      }}>
        <span>
          🕐 <strong style={{ color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
            {trackedMinutes >= 60 ? `${Math.floor(trackedMinutes / 60)}h ${trackedMinutes % 60}m` : `${trackedMinutes}m`}
          </strong> in meetings today
        </span>
      </div>
    </div>
  );
}

const TRACK_MODE_OPTIONS: { value: MeetingTrackMode; label: string; desc: string }[] = [
  { value: 'always', label: 'Always', desc: 'Auto-add to Today for every occurrence' },
  { value: 'once', label: 'Today only', desc: 'Add to Today for today\'s occurrence' },
  { value: 'off', label: 'Don\'t show', desc: 'Track manually from Schedule' },
];

function MeetingCard({
  meeting, projects, timezone, workspace, onSelect, onTrackModeChange, onStart,
}: {
  meeting: CalendarMeeting;
  projects: Project[];
  timezone: string;
  workspace?: Workspace;
  onSelect: () => void;
  onTrackModeChange: (mode: MeetingTrackMode) => void;
  onStart: () => void;
}) {
  const durLabel = meeting.durationMinutes >= 60
    ? `${meeting.durationMinutes / 60}h`
    : `${meeting.durationMinutes}m`;

  const assignedProject = meeting.projectId ? projects.find(p => p.id === meeting.projectId) : null;

  const dotColor = meeting.past
    ? 'var(--color-border-strong)'
    : meeting.trackMode === 'always'
      ? 'var(--color-accent)'
      : meeting.trackMode === 'once'
        ? 'var(--color-info)'
        : 'var(--color-surface)';

  const dotBorder = meeting.past || meeting.trackMode === 'always' || meeting.trackMode === 'once'
    ? 'none'
    : '1.5px solid var(--color-text-muted)';

  return (
    <div style={{ position: 'relative', marginBottom: 8 }}>
      {/* Timeline dot */}
      <div style={{ position: 'absolute', left: -14, top: 10, width: 8, height: 8, borderRadius: '50%', background: dotColor, border: dotBorder }} />

      {/* Time label */}
      <div style={{
        position: 'absolute', left: -52, top: 7,
        fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        color: 'var(--color-text-muted)', width: 36, textAlign: 'right',
        opacity: meeting.past ? 0.6 : 1,
      }}>
        {to12h(meeting.time, timezone)}
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', overflow: 'hidden',
        opacity: meeting.past ? 0.75 : 1,
      }}>
        {/* Title row — clickable to open detail */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px 3px' }}>
          <button
            onClick={onSelect}
            style={{
              flex: 1, minWidth: 0, background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', padding: 0,
              fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {meeting.title}
          </button>
          {/* Track mode badge — always shown for future meetings, cycles through options */}
          {!meeting.past && (
            <button
              onClick={() => {
                const next: MeetingTrackMode = meeting.trackMode === 'off' ? 'once' : meeting.trackMode === 'once' ? 'always' : 'off';
                onTrackModeChange(next);
              }}
              title="Click to change tracking: Off → Today only → Always"
              style={{
                flexShrink: 0, padding: '2px 6px',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                borderRadius: 3, cursor: 'pointer',
                ...(meeting.trackMode === 'always'
                  ? { background: 'rgba(200,85,61,0.12)', color: 'var(--color-accent)', border: 'none' }
                  : meeting.trackMode === 'once'
                    ? { background: 'rgba(74,111,165,0.1)', color: 'var(--color-info)', border: 'none' }
                    : { background: 'none', color: 'var(--color-text-faint)', border: '1px solid var(--color-border)' }),
              }}
            >
              {meeting.trackMode === 'always' ? 'Always' : meeting.trackMode === 'once' ? 'Today' : '+ Track'}
            </button>
          )}
          {/* Chevron indicates the card is clickable for detail/notes */}
          <button
            onClick={onSelect}
            style={{
              flexShrink: 0, background: 'none', border: 'none',
              cursor: 'pointer', padding: '0 2px',
              fontSize: 13, color: 'var(--color-text-faint)', lineHeight: 1,
            }}
          >›</button>
        </div>

        {/* Workspace + project chips */}
        {(workspace || assignedProject) && (
          <div style={{ padding: '0 10px 3px', display: 'flex', alignItems: 'center', gap: 6 }}>
            {workspace && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: `${workspace.color}22`, color: workspace.color,
              }}>
                {workspace.name[0].toUpperCase()} {workspace.name}
              </span>
            )}
            {assignedProject && (
              <>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: assignedProject.color, display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{assignedProject.name}</span>
              </>
            )}
          </div>
        )}

        {/* Meta + action row */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px 8px', opacity: meeting.past ? 0.7 : 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
            <span style={{ fontSize: 12 }}>↻</span>
            <span>
              {durLabel}
              {meeting.past && meeting.logged && meeting.loggedMinutes !== undefined
                ? ` · tracked ${meeting.loggedMinutes}m`
                : meeting.minutesUntil !== undefined && !meeting.past
                  ? ` · in ${meeting.minutesUntil}m`
                  : meeting.recurringLabel
                    ? ` · ${meeting.recurringLabel}`
                    : ''}
            </span>
          </div>

          {meeting.past && meeting.logged ? (
            <button style={{
              padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'default',
              background: 'var(--color-success)', color: '#fff', border: 'none', borderRadius: 4,
            }}>
              ✓ Logged
            </button>
          ) : meeting.past ? (
            <button onClick={onSelect} style={{
              padding: '3px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: 'none', color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)', borderRadius: 4,
            }}>
              Log
            </button>
          ) : (
            <button
              onClick={onStart}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                background: 'none', color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)', borderRadius: 4,
                display: 'flex', alignItems: 'center', gap: 3,
              }}
            >
              ▶ Start
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingDetailState({
  meeting, projects, timezone, onBack, onUpdate, onStart,
}: {
  meeting: CalendarMeeting;
  projects: Project[];
  timezone: string;
  onBack: () => void;
  onUpdate: (updates: Partial<CalendarMeeting>) => void;
  onStart: () => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description ?? '');
  const [descTab, setDescTab] = useState<'write' | 'preview'>('write');
  const [notes, setNotes] = useState(meeting.notes);
  const [notesTab, setNotesTab] = useState<'write' | 'preview'>('write');
  const [showDescription, setShowDescription] = useState((meeting.description ?? '').length > 0);
  const [showProject, setShowProject] = useState(meeting.projectId !== null);
  const [showNotes, setShowNotes] = useState(meeting.notes.length > 0);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Last 5 logged past occurrences of the same recurring series
  const meetingHistory = useLiveQuery(async () => {
    if (!meeting.recurringEventId) return [];
    const rows = await db.meetings
      .where('recurringEventId').equals(meeting.recurringEventId)
      .filter(m => !m.deletedAt && m.logged && m.id !== meeting.id)
      .toArray();
    return rows.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  }, [meeting.recurringEventId, meeting.id]) ?? [];

  const durLabel = meeting.durationMinutes >= 60
    ? `${meeting.durationMinutes / 60}h`
    : `${meeting.durationMinutes}m`;

  const today = localDate(timezone);
  const activeProjects = projects.filter(p =>
    (!p.endDate || p.endDate >= today) &&
    (!p.workspaceId || !meeting.workspaceId || p.workspaceId === meeting.workspaceId)
  );
  const previewHtml = marked.parse(notes || '_No notes yet._') as string;
  const descPreviewHtml = marked.parse(description || '_No description yet._') as string;

  const handleTitleBlur = () => {
    if (title.trim() && title !== meeting.title) onUpdate({ title: title.trim() });
  };

  const handleDescFormat = (prefix: string, suffix = prefix, lineMode = false) => {
    const ta = descRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    let result: { value: string; start: number; end: number };
    if (lineMode) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const blockEnd = s === e ? (v.indexOf('\n', s) >= 0 ? v.indexOf('\n', s) : v.length) : e;
      const block = v.slice(lineStart, blockEnd);
      const lines = block.split('\n');
      const toggling = lines.every(l => l.startsWith(prefix));
      const newBlock = toggling ? lines.map(l => l.slice(prefix.length)).join('\n') : lines.map(l => prefix + l).join('\n');
      const delta = newBlock.length - block.length;
      result = { value: v.slice(0, lineStart) + newBlock + v.slice(blockEnd), start: s + (toggling ? -Math.min(prefix.length, s - lineStart) : prefix.length), end: blockEnd + delta };
    } else {
      const sel = v.slice(s, e);
      if (sel) {
        if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length > prefix.length + suffix.length) {
          const inner = sel.slice(prefix.length, sel.length - suffix.length);
          result = { value: v.slice(0, s) + inner + v.slice(e), start: s, end: s + inner.length };
        } else {
          const wrapped = prefix + sel + suffix;
          result = { value: v.slice(0, s) + wrapped + v.slice(e), start: s, end: s + wrapped.length };
        }
      } else {
        result = { value: v.slice(0, s) + prefix + suffix + v.slice(e), start: s + prefix.length, end: s + prefix.length };
      }
    }
    setDescription(result.value);
    onUpdate({ description: result.value });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(result.start, result.end); });
  };

  const handleFormat = (prefix: string, suffix = prefix, lineMode = false) => {
    const ta = notesRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    let result: { value: string; start: number; end: number };
    if (lineMode) {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1;
      const blockEnd = s === e ? (v.indexOf('\n', s) >= 0 ? v.indexOf('\n', s) : v.length) : e;
      const block = v.slice(lineStart, blockEnd);
      const lines = block.split('\n');
      const toggling = lines.every(l => l.startsWith(prefix));
      const newBlock = toggling ? lines.map(l => l.slice(prefix.length)).join('\n') : lines.map(l => prefix + l).join('\n');
      const delta = newBlock.length - block.length;
      result = { value: v.slice(0, lineStart) + newBlock + v.slice(blockEnd), start: s + (toggling ? -Math.min(prefix.length, s - lineStart) : prefix.length), end: blockEnd + delta };
    } else {
      const sel = v.slice(s, e);
      if (sel) {
        if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length > prefix.length + suffix.length) {
          const inner = sel.slice(prefix.length, sel.length - suffix.length);
          result = { value: v.slice(0, s) + inner + v.slice(e), start: s, end: s + inner.length };
        } else {
          const wrapped = prefix + sel + suffix;
          result = { value: v.slice(0, s) + wrapped + v.slice(e), start: s, end: s + wrapped.length };
        }
      } else {
        result = { value: v.slice(0, s) + prefix + suffix + v.slice(e), start: s + prefix.length, end: s + prefix.length };
      }
    }
    const newNotes = result.value;
    setNotes(newNotes);
    onUpdate({ notes: newNotes });
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(result.start, result.end); });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--color-border-strong) transparent' }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18, lineHeight: 1, padding: '0 4px', display: 'flex', alignItems: 'center' }}>←</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', flex: 1 }}>Meeting detail</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>{to12h(meeting.time, timezone)} · {durLabel}</span>
      </div>

      {/* Title */}
      <div style={{ padding: '12px 14px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Title</div>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 10px',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', fontSize: 14, fontWeight: 600,
            color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Description */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showDescription ? (
          <MeetingAddFieldButton label="Add description" onClick={() => setShowDescription(true)} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>Description</div>
              <div style={{ display: 'flex', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '1px', gap: 1 }}>
                {(['write', 'preview'] as const).map(tab => (
                  <button key={tab} onClick={() => setDescTab(tab)} style={{
                    padding: '2px 10px', border: 'none', cursor: 'pointer',
                    fontSize: 11, borderRadius: 4, textTransform: 'capitalize',
                    fontWeight: descTab === tab ? 600 : 400,
                    background: descTab === tab ? 'var(--color-surface)' : 'transparent',
                    color: descTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
                    boxShadow: descTab === tab ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  }}>{tab}</button>
                ))}
              </div>
            </div>
            {descTab === 'write' && (
              <>
                <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                  {([['B', '**', '**', false, true, false], ['I', '_', '_', false, false, true], ['•', '- ', '', true, false, false], ['`', '`', '`', false, false, false]] as const).map(([label, pre, suf, lm, bold, italic]) => (
                    <button key={label} onClick={() => handleDescFormat(pre, suf, lm)} style={{
                      width: 26, height: 24, border: '1px solid var(--color-border)',
                      borderRadius: 4, background: 'var(--color-surface)', cursor: 'pointer',
                      fontSize: 11, fontWeight: bold ? 700 : 500, fontStyle: italic ? 'italic' : 'normal',
                      color: 'var(--color-text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{label}</button>
                  ))}
                </div>
                <textarea
                  ref={descRef}
                  value={description}
                  onChange={e => { setDescription(e.target.value); onUpdate({ description: e.target.value }); }}
                  placeholder="Add agenda, context, or goals…"
                  rows={4}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text)', lineHeight: 1.6, resize: 'vertical', outline: 'none',
                  }}
                />
              </>
            )}
            {descTab === 'preview' && (
              <div
                className="notes-preview"
                dangerouslySetInnerHTML={{ __html: descPreviewHtml }}
                style={{
                  padding: '8px 10px', minHeight: 80,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: 1.7,
                  color: 'var(--color-text)',
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Track mode */}
      <div style={{ padding: '12px 14px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Show in Today</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {TRACK_MODE_OPTIONS.map(opt => {
            const selected = meeting.trackMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onUpdate({ trackMode: opt.value })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: selected ? 'rgba(200,85,61,0.06)' : 'var(--color-surface)',
                  textAlign: 'left',
                }}
              >
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                  background: selected ? 'var(--color-accent)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {selected && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: selected ? 'var(--color-accent)' : 'var(--color-text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Project */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showProject ? (
          <MeetingAddFieldButton label="Add project" onClick={() => setShowProject(true)} />
        ) : (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Project</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <button
                onClick={() => onUpdate({ projectId: null })}
                style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: meeting.projectId === null ? 'var(--color-border)' : 'transparent',
                  border: '1px solid var(--color-border)',
                  color: meeting.projectId === null ? 'var(--color-text)' : 'var(--color-text-muted)',
                  fontWeight: meeting.projectId === null ? 600 : 400,
                }}
              >
                None
              </button>
              {activeProjects.map(p => (
                <button
                  key={p.id}
                  onClick={() => onUpdate({ projectId: p.id })}
                  style={{
                    padding: '3px 10px', fontSize: 11, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    background: meeting.projectId === p.id ? p.color : 'transparent',
                    border: `1px solid ${meeting.projectId === p.id ? p.color : 'var(--color-border)'}`,
                    color: meeting.projectId === p.id ? '#fff' : 'var(--color-text-muted)',
                    fontWeight: meeting.projectId === p.id ? 600 : 400,
                    display: 'flex', alignItems: 'center', gap: 5,
                  }}
                >
                  {meeting.projectId !== p.id && <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block' }} />}
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Notes */}
      <div style={{ padding: '12px 14px 0' }}>
        {!showNotes && !notes ? (
          <MeetingAddFieldButton label="Add notes" onClick={() => setShowNotes(true)} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>Notes</div>
              <div style={{ display: 'flex', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '1px', gap: 1 }}>
                {(['write', 'preview'] as const).map(tab => (
                  <button key={tab} onClick={() => setNotesTab(tab)} style={{
                    padding: '2px 10px', border: 'none', cursor: 'pointer',
                    fontSize: 11, borderRadius: 4, textTransform: 'capitalize',
                    fontWeight: notesTab === tab ? 600 : 400,
                    background: notesTab === tab ? 'var(--color-surface)' : 'transparent',
                    color: notesTab === tab ? 'var(--color-text)' : 'var(--color-text-muted)',
                    boxShadow: notesTab === tab ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                  }}>{tab}</button>
                ))}
              </div>
            </div>
            {notesTab === 'write' && (
              <>
                <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
                  {([['B', '**', '**', false, true, false], ['I', '_', '_', false, false, true], ['•', '- ', '', true, false, false], ['`', '`', '`', false, false, false]] as const).map(([label, pre, suf, lm, bold, italic]) => (
                    <button key={label} onClick={() => handleFormat(pre, suf, lm)} style={{
                      width: 26, height: 24, border: '1px solid var(--color-border)',
                      borderRadius: 4, background: 'var(--color-surface)', cursor: 'pointer',
                      fontSize: 11, fontWeight: bold ? 700 : 500, fontStyle: italic ? 'italic' : 'normal',
                      color: 'var(--color-text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{label}</button>
                  ))}
                </div>
                <textarea
                  ref={notesRef}
                  value={notes}
                  onChange={e => { setNotes(e.target.value); onUpdate({ notes: e.target.value }); }}
                  placeholder="Add notes, action items, or follow-ups…"
                  rows={5}
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '8px 10px',
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', fontSize: 12, fontFamily: 'var(--font-mono)',
                    color: 'var(--color-text)', lineHeight: 1.6, resize: 'vertical', outline: 'none',
                  }}
                />
              </>
            )}
            {notesTab === 'preview' && (
              <div
                className="notes-preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
                style={{
                  padding: '8px 10px', minHeight: 96,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', fontSize: 12, lineHeight: 1.7,
                  color: 'var(--color-text)',
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Meeting log (last 5 occurrences of this recurring series) */}
      {meetingHistory.length > 0 && (
        <div style={{ padding: '0 14px 14px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Recent sessions
          </div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {meetingHistory.map((entry, idx) => {
              const date = new Date(entry.time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
              const mins = entry.loggedMinutes ?? entry.durationMinutes;
              const minsLabel = mins >= 60 ? `${Math.round(mins / 6) / 10}h` : `${mins}m`;
              return (
                <div key={entry.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{date}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-success)', fontFamily: 'var(--font-mono)' }}>{minsLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Start button (if not past and not logged) */}
      {!meeting.past && !meeting.logged && (
        <div style={{ padding: '0 14px 14px' }}>
          <button onClick={onStart} style={{
            width: '100%', padding: '10px 0',
            background: 'var(--color-accent)', color: '#fff',
            border: 'none', borderRadius: 'var(--radius-md)',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            ▶ Start stopwatch
          </button>
        </div>
      )}
      {(meeting.past || meeting.logged) && <div style={{ height: 14 }} />}
    </div>
  );
}

function QuickAddForm({ onSave, onCancel }: { onSave: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      display: 'flex', gap: 6, alignItems: 'center',
      flexShrink: 0,
    }}>
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && value.trim()) { onSave(value.trim()); }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="New task…"
        style={{
          flex: 1, border: 'none', background: 'var(--color-bg)',
          borderRadius: 'var(--radius-sm)', padding: '5px 9px',
          outline: '1px solid var(--color-border)',
          fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit',
        }}
      />
      <button
        onClick={() => { if (value.trim()) onSave(value.trim()); }}
        disabled={!value.trim()}
        style={{
          padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: value.trim() ? 'pointer' : 'default',
          background: value.trim() ? 'var(--color-accent)' : 'var(--color-border)',
          color: value.trim() ? '#fff' : 'var(--color-text-faint)',
          border: 'none', borderRadius: 'var(--radius-sm)', flexShrink: 0,
        }}
      >Add</button>
      <button
        onClick={onCancel}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-text-faint)', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}
      >×</button>
    </div>
  );
}

// ── Shared suggestion card ────────────────────────────────────────────────────

function SuggestionCard({ label, accentColor, children, primaryLabel, secondaryLabel, onPrimary, onSecondary, onDismiss }: {
  label: string;
  accentColor: string;
  children: React.ReactNode;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div style={{ padding: '8px 14px', flexShrink: 0 }}>
      <div style={{
        borderRadius: 'var(--radius-md)',
        borderTop: '1px solid var(--color-border)',
        borderRight: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: `3px solid ${accentColor}`,
        background: 'var(--color-surface)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        padding: '8px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>
            {label}
          </span>
          <button
            onClick={onDismiss}
            style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-faint)', padding: 0, lineHeight: 1 }}
          >×</button>
        </div>
        <div style={{ marginBottom: primaryLabel ? 8 : 0 }}>{children}</div>
        {primaryLabel && onPrimary && <div style={{ display: 'flex', gap: 5 }}>
          <button
            onClick={onPrimary}
            style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)' }}
          >
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 500, cursor: 'pointer', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
            >
              {secondaryLabel}
            </button>
          )}
        </div>}
      </div>
    </div>
  );
}

function SelectionBanner({ text, onCreate, onAddToNotes, onDismiss }: {
  text: string;
  onCreate: () => void;
  onAddToNotes: () => void;
  onDismiss: () => void;
}) {
  const preview = text.length > 80 ? text.slice(0, 80) + '…' : text;
  return (
    <SuggestionCard
      label="Selected text"
      accentColor="var(--color-accent)"
      primaryLabel="+ New task"
      secondaryLabel="Add notes to..."
      onPrimary={onCreate}
      onSecondary={onAddToNotes}
      onDismiss={onDismiss}
    >
      <div style={{
        fontSize: 12, color: 'var(--color-text)', lineHeight: 1.45,
        padding: '5px 8px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        fontStyle: 'italic',
      }}>
        "{preview}"
      </div>
    </SuggestionCard>
  );
}

const PROVIDER_ICONS: Record<string, string> = {
  linear: '◆',
  github: '⊙',
  sentry: '⚠',
  arxiv: '∂',
  manual: '·',
  custom: '◎',
};

function LinkedTasksBanner({ tasks, onSelect, onDismiss }: {
  tasks: SelectedTask[];
  onSelect: (task: SelectedTask) => void;
  onDismiss: () => void;
}) {
  const label = tasks.length === 1 ? 'Linked task' : `${tasks.length} linked tasks`;
  const shown = tasks.slice(0, 3);
  return (
    <div style={{ padding: '8px 14px', flexShrink: 0 }}>
      <div style={{
        borderRadius: 'var(--radius-md)',
        borderTop: '1px solid var(--color-border)',
        borderRight: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        borderLeft: '3px solid var(--color-success)',
        background: 'var(--color-surface)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        padding: '8px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1 }}>
            {label}
          </span>
          <button
            onClick={onDismiss}
            style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--color-text-faint)', padding: 0, lineHeight: 1 }}
          >×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {shown.map(task => (
            <button
              key={task.id}
              onClick={() => onSelect(task)}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                fontSize: 12, color: 'var(--color-text)', lineHeight: 1.4,
                padding: '5px 8px',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
                overflow: 'hidden',
              }}
            >
              <span style={{ color: 'var(--color-text-faint)', fontSize: 10, flexShrink: 0 }}>↳</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {task.title || <span style={{ fontStyle: 'italic', color: 'var(--color-text-faint)' }}>(untitled)</span>}
              </span>
              {task.status === 'done' && (
                <span style={{ fontSize: 9, color: 'var(--color-success)', fontWeight: 600, flexShrink: 0 }}>DONE</span>
              )}
              {task.status === 'in_progress' && (
                <span style={{ fontSize: 9, color: 'var(--color-warning)', fontWeight: 600, flexShrink: 0 }}>WIP</span>
              )}
              {task.status === 'delayed' && (
                <span style={{ fontSize: 9, color: '#7B5DB4', fontWeight: 600, flexShrink: 0 }}>DELAYED</span>
              )}
            </button>
          ))}
          {tasks.length > 3 && (
            <span style={{ fontSize: 11, color: 'var(--color-text-faint)', padding: '2px 8px' }}>
              +{tasks.length - 3} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DetectionBanner({ ticket, mode, relatedTasks, onAdd, onSelect, onLink, onCreateFollowup, onDismiss }: {
  ticket: TicketRef;
  mode: 'add' | 'view';
  relatedTasks: SelectedTask[];
  onAdd: () => void;
  onSelect: (task: SelectedTask) => void;
  onLink: () => void;
  onCreateFollowup: (parentId: string) => void;
  onDismiss: () => void;
}) {
  const titlePreview = ticket.title.length > 60 ? ticket.title.slice(0, 60) + '…' : ticket.title;
  return (
    <SuggestionCard
      label="On this page"
      accentColor="var(--color-info)"
      primaryLabel={mode === 'add' ? '+ Backlog' : undefined}
      secondaryLabel={mode === 'add' ? 'Add link to...' : undefined}
      onPrimary={mode === 'add' ? onAdd : undefined}
      onSecondary={mode === 'add' ? onLink : undefined}
      onDismiss={onDismiss}
    >
      <div style={{
        fontSize: 12, color: 'var(--color-text)', lineHeight: 1.4,
        padding: '5px 8px',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
      }}>
        {ticket.external_id && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--color-info)', marginRight: 6 }}>
            {PROVIDER_ICONS[ticket.provider_kind] ?? '◎'} {ticket.external_id}
          </span>
        )}
        <span>{titlePreview}</span>
      </div>
      {mode === 'view' && relatedTasks.map(task => (
        <div
          key={task.id}
          style={{
            marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)',
            padding: '3px 8px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex', alignItems: 'center', gap: 6,
            overflow: 'hidden',
          }}
        >
          <span style={{ color: 'var(--color-text-faint)', fontSize: 10 }}>↳</span>
          <button
            onClick={() => onSelect(task)}
            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {task.title}
          </button>
          {task.status === 'done' && (
            <span style={{ fontSize: 9, color: 'var(--color-success)', fontWeight: 600, flexShrink: 0 }}>DONE</span>
          )}
          {task.status === 'in_progress' && (
            <span style={{ fontSize: 9, color: 'var(--color-warning)', fontWeight: 600, flexShrink: 0 }}>WIP</span>
          )}
          {task.status === 'delayed' && (
            <span style={{ fontSize: 9, color: '#7B5DB4', fontWeight: 600, flexShrink: 0 }}>DELAYED</span>
          )}
          <button
            onClick={() => onCreateFollowup(task.id)}
            title="Create follow-up"
            style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--color-text-faint)', padding: '0 2px', fontFamily: 'inherit' }}
          >↩</button>
        </div>
      ))}
    </SuggestionCard>
  );
}

// ── Tasks sub-tab components ──────────────────────────────────────────────────

function TasksSubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '5px 0', fontSize: 12, fontWeight: active ? 600 : 400,
        borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: 'none',
        background: active ? 'var(--color-accent)' : 'var(--color-surface)',
        color: active ? '#fff' : 'var(--color-text-muted)',
        transition: 'background 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function formatDayLabel(dateStr: string, timezone: string): string {
  const today = localDate(timezone);
  const yesterday = localDate(timezone, -1);
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getEffectiveDate(task: { updatedAt: string; timeLogs?: { startedAt: string }[] }): string {
  if (task.timeLogs && task.timeLogs.length > 0) {
    return task.timeLogs.reduce((max, l) => l.startedAt > max ? l.startedAt : max, '').slice(0, 10);
  }
  return task.updatedAt.slice(0, 10);
}

type HistoryDateFilter = 'week' | 'month' | 'custom';

function TaskHistoryView({ activeWsId, projects, timezone, onSelectTask, onSelectMeeting }: {
  activeWsId: string;
  projects: Project[];
  timezone: string;
  onSelectTask: (task: SelectedTask) => void;
  onSelectMeeting?: (m: CalendarMeeting) => void;
}) {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(() => localDate(timezone));
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  const todayStr = localDate(timezone);
  const weekCutoff = localDate(timezone, -7);
  const monthCutoff = localDate(timezone, -30);

  const allHistory = useLiveQuery(
    () => db.tasks
      .filter(t => {
        if (t.deletedAt) return false;
        if (activeWsId !== 'all' && t.workspaceId !== activeWsId && t.workspaceId != null) return false;
        if (t.status === 'done' || t.status === 'cancelled') return true;
        return (t.timeLogs?.length ?? 0) > 0;
      })
      .toArray(),
    [activeWsId],
  ) ?? [];

  const allLoggedMeetings = useLiveQuery(
    () => db.meetings
      .filter(m => {
        if (m.deletedAt) return false;
        if (!m.logged) return false;
        if (activeWsId !== 'all' && m.workspaceId !== activeWsId && m.workspaceId != null) return false;
        return true;
      })
      .toArray(),
    [activeWsId],
  ) ?? [];

  const q = search.toLowerCase();

  const inDateRange = (d: string) => {
    if (dateFilter === 'week' && d < weekCutoff) return false;
    if (dateFilter === 'month' && d < monthCutoff) return false;
    if (dateFilter === 'custom') {
      if (customFrom && d < customFrom) return false;
      if (customTo && d > customTo) return false;
    }
    return true;
  };

  const filteredTasks = allHistory.filter(t => {
    if (!inDateRange(getEffectiveDate(t))) return false;
    if (q && !t.title.toLowerCase().includes(q) && !(t.ticketId ?? '').toLowerCase().includes(q)) return false;
    if (filterProjectId && t.projectId !== filterProjectId) return false;
    return true;
  });

  const filteredMeetings = allLoggedMeetings.filter(m => {
    const d = m.time.slice(0, 10);
    if (!inDateRange(d)) return false;
    if (q && !m.title.toLowerCase().includes(q)) return false;
    if (filterProjectId && m.projectId !== filterProjectId) return false;
    return true;
  });

  // Merge into day groups, sorted newest first
  const groups = new Map<string, { tasks: typeof filteredTasks; meetings: typeof filteredMeetings }>();
  const getOrCreate = (day: string) => {
    if (!groups.has(day)) groups.set(day, { tasks: [], meetings: [] });
    return groups.get(day)!;
  };
  for (const t of filteredTasks) getOrCreate(getEffectiveDate(t)).tasks.push(t);
  for (const m of filteredMeetings) getOrCreate(m.time.slice(0, 10)).meetings.push(m);
  const sortedDays = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  const projectById = (id: string | null) => id ? projects.find(p => p.id === id) : undefined;

  // Time helpers
  const taskMinsOnDay = (t: SelectedTask, day: string) =>
    Math.round((t.timeLogs ?? []).filter(l => l.startedAt.slice(0, 10) === day).reduce((s, l) => s + l.durationSeconds, 0) / 60);
  const meetingMinsOf = (m: CalendarMeeting) => m.loggedMinutes ?? m.durationMinutes;
  const dayTotalMins = (day: string, tasks: typeof filteredTasks, meetings: typeof filteredMeetings) =>
    tasks.reduce((s, t) => s + taskMinsOnDay(t, day), 0) +
    meetings.reduce((s, m) => s + meetingMinsOf(m), 0);

  let grandTotalMins = 0;
  for (const day of sortedDays) {
    const { tasks, meetings } = groups.get(day)!;
    grandTotalMins += dayTotalMins(day, tasks, meetings);
  }

  const chipStyle = (active: boolean) => ({
    padding: '3px 10px', fontSize: 11, fontWeight: active ? 600 : 400,
    borderRadius: 'var(--radius-sm)', cursor: 'pointer' as const,
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: active ? 'var(--color-accent-soft)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    fontFamily: 'inherit',
  });

  const isFiltered = search !== '' || dateFilter !== 'week' || filterProjectId !== null;
  const clearFilters = () => { setSearch(''); setDateFilter('week'); setFilterProjectId(null); };

  const hasAny = allHistory.length > 0 || allLoggedMeetings.length > 0;
  const hasFiltered = filteredTasks.length > 0 || filteredMeetings.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Search */}
      <div style={{ padding: '10px 14px 6px' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tasks & meetings…"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '6px 10px',
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--color-text)',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Date filter chips + project select */}
      <div style={{ display: 'flex', gap: 5, padding: '0 14px 6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setDateFilter('week')} style={chipStyle(dateFilter === 'week')}>This week</button>
        <button onClick={() => setDateFilter('month')} style={chipStyle(dateFilter === 'month')}>This month</button>
        <button onClick={() => setDateFilter('custom')} style={chipStyle(dateFilter === 'custom')}>📅 Range</button>
        {projects.length > 0 && (
          <select
            value={filterProjectId ?? ''}
            onChange={e => setFilterProjectId(e.target.value || null)}
            style={{
              padding: '3px 8px', fontSize: 11,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              border: `1px solid ${filterProjectId ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background: filterProjectId ? 'var(--color-accent-soft)' : 'transparent',
              color: filterProjectId ? 'var(--color-accent)' : 'var(--color-text-muted)',
              outline: 'none', fontFamily: 'inherit',
            }}
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {isFiltered && (
          <button
            onClick={clearFilters}
            style={{ ...chipStyle(false), marginLeft: 'auto', color: 'var(--color-text-faint)', fontSize: 10 }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Custom date range inputs */}
      {dateFilter === 'custom' && (
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 8px', alignItems: 'center' }}>
          <input
            type="date"
            value={customFrom}
            max={todayStr}
            onChange={e => setCustomFrom(e.target.value)}
            style={{
              flex: 1, padding: '4px 7px', fontSize: 11,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', color: 'var(--color-text)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>→</span>
          <input
            type="date"
            value={customTo}
            max={todayStr}
            onChange={e => setCustomTo(e.target.value)}
            style={{
              flex: 1, padding: '4px 7px', fontSize: 11,
              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', color: 'var(--color-text)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        </div>
      )}

      {/* Grand total banner */}
      {hasFiltered && grandTotalMins > 0 && (
        <div style={{
          margin: '0 14px 6px', padding: '6px 10px',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', fontFamily: 'var(--font-mono)' }}>
            {fmtMins(grandTotalMins)}
          </span>
        </div>
      )}

      {/* Groups */}
      {!hasAny ? (
        <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No completed tasks yet.
        </div>
      ) : !hasFiltered ? (
        <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No items match your filters.
        </div>
      ) : (
        <div style={{ padding: '0 14px 12px' }}>
          {sortedDays.map(day => {
            const { tasks, meetings } = groups.get(day)!;
            const dayMins = dayTotalMins(day, tasks, meetings);
            return (
              <div key={day}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--color-text-muted)', padding: '6px 0 4px',
                }}>
                  <span>{formatDayLabel(day, timezone)}</span>
                  {dayMins > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: 0, fontWeight: 500 }}>
                      {fmtMins(dayMins)}
                    </span>
                  )}
                </div>
                {tasks.map(task => (
                  <BacklogRow
                    key={task.id}
                    task={task}
                    {...(projectById(task.projectId) ? { project: projectById(task.projectId)! } : {})}
                    isInPriorities={false}
                    isInTasks={false}
                    prioritiesFull={false}
                    onAddToPriorities={() => {}}
                    onAddToTasks={() => {}}
                    onRemove={() => {}}
                    onSelect={() => onSelectTask(task)}
                  />
                ))}
                {meetings.map(m => {
                  const mins = meetingMinsOf(m);
                  const minsLabel = fmtMins(mins);
                  return (
                    <div
                      key={m.id}
                      onClick={() => onSelectMeeting?.(m)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 8px 6px 10px', marginBottom: 4,
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: onSelectMeeting ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ fontSize: 11, flexShrink: 0 }}>📅</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.title}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-muted)' }}>
                            {to12h(m.time, timezone)}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 600 }}>
                            ⏱ {minsLabel}
                          </span>
                        </div>
                      </div>
                      {onSelectMeeting && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onSelectMeeting(m); }}
                          style={{ padding: '2px 8px', fontSize: 11, fontWeight: 500, cursor: 'pointer', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'none', color: 'var(--color-text-muted)', flexShrink: 0 }}
                        >
                          View
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Habit history view ────────────────────────────────────────────────────────

type HabitHistoryDateFilter = 'week' | 'month' | 'custom';

function HabitHistoryView({ habits, timezone }: {
  habits: HabitDef[];
  timezone: string;
}) {
  const [dateFilter, setDateFilter] = useState<HabitHistoryDateFilter>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(() => localDate(timezone));

  const todayStr = localDate(timezone);
  const weekCutoff = localDate(timezone, -7);
  const monthCutoff = localDate(timezone, -30);

  const habitIdSet = new Set(habits.map(h => h.id));

  const allRecords = useLiveQuery(
    () => db.habitHistory.toArray(),
    [],
  ) ?? [];

  const inRange = (date: string) => {
    if (dateFilter === 'week' && date < weekCutoff) return false;
    if (dateFilter === 'month' && date < monthCutoff) return false;
    if (dateFilter === 'custom') {
      if (customFrom && date < customFrom) return false;
      if (customTo && date > customTo) return false;
    }
    return true;
  };

  // Active dates: any day with counter progress or boolean completion
  const activeDates = new Set(
    allRecords.filter(r =>
      habitIdSet.has(r.habitId) &&
      inRange(r.date) &&
      ((r.done === true) || ((r.count ?? 0) > 0))
    ).map(r => r.date)
  );

  // For each active date, show all habits:
  // counter habits only if count > 0; boolean habits always (synthesise if no record)
  type DisplayRecord = HabitHistoryRow & { _synthetic?: boolean };
  const groups = new Map<string, DisplayRecord[]>();
  for (const date of activeDates) {
    const entries: DisplayRecord[] = [];
    for (const habit of habits) {
      const record = allRecords.find(r => r.habitId === habit.id && r.date === date);
      if (habit.kind === 'counter') {
        if ((record?.count ?? 0) > 0) entries.push(record!);
      } else {
        entries.push(record ?? { habitId: habit.id, date, done: false, updatedAt: '', _synthetic: true });
      }
    }
    if (entries.length > 0) groups.set(date, entries);
  }

  const habitById = (id: string) => habits.find(h => h.id === id);

  const chipStyle = (active: boolean) => ({
    padding: '3px 10px', fontSize: 11, fontWeight: active ? 600 : 400,
    borderRadius: 'var(--radius-sm)', cursor: 'pointer' as const,
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: active ? 'var(--color-accent-soft)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Date filter chips */}
      <div style={{ display: 'flex', gap: 5, padding: '10px 14px 6px', flexWrap: 'wrap' }}>
        <button onClick={() => setDateFilter('week')} style={chipStyle(dateFilter === 'week')}>This week</button>
        <button onClick={() => setDateFilter('month')} style={chipStyle(dateFilter === 'month')}>This month</button>
        <button onClick={() => setDateFilter('custom')} style={chipStyle(dateFilter === 'custom')}>📅 Range</button>
      </div>

      {/* Custom date range */}
      {dateFilter === 'custom' && (
        <div style={{ display: 'flex', gap: 6, padding: '0 14px 8px', alignItems: 'center' }}>
          <input
            type="date"
            value={customFrom}
            max={todayStr}
            onChange={e => setCustomFrom(e.target.value)}
            style={{ flex: 1, padding: '4px 7px', fontSize: 11, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>→</span>
          <input
            type="date"
            value={customTo}
            max={todayStr}
            onChange={e => setCustomTo(e.target.value)}
            style={{ flex: 1, padding: '4px 7px', fontSize: 11, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)', fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
      )}

      {/* Groups */}
      {groups.size === 0 ? (
        <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
          No habit activity in this period.
        </div>
      ) : (
        <div style={{ padding: '0 14px 12px' }}>
          {Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([date, records]) => (
            <div key={date}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', padding: '6px 0 4px' }}>
                {formatDayLabel(date, timezone)}
              </div>
              {records.map(record => {
                const habit = habitById(record.habitId);
                if (!habit) return null;
                const goalUsed = record.goal ?? habit.goal;
                const count = record.count ?? 0;
                const isDone = habit.kind === 'boolean' ? record.done === true : (goalUsed != null ? count >= goalUsed : count > 0);
                return (
                  <div
                    key={record.habitId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '6px 0',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                  >
                    <HabitIcon kind={habit.icon} size={24} />
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{habit.name}</span>
                    {habit.kind === 'counter' && (
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {count}{goalUsed != null ? ` / ${goalUsed}` : ''}{habit.unit ? ` ${habit.unit}` : ''}
                      </span>
                    )}
                    <span style={{ fontSize: 13, fontWeight: 700, color: isDone ? 'var(--color-success)' : 'var(--color-accent)', flexShrink: 0 }}>
                      {isDone ? '✓' : '✗'}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SmallButton({ children, onClick, title, disabled }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{
      width: 26, height: 26, flexShrink: 0, border: '1px solid var(--color-border)',
      borderRadius: 6, background: 'var(--color-bg)',
      color: disabled ? 'var(--color-text-faint)' : 'var(--color-text-muted)',
      fontSize: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {children}
    </button>
  );
}

function IconButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick?: () => void }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'none', border: 'none', cursor: 'pointer', borderRadius: 7, fontSize: 17,
      color: 'var(--color-text-muted)',
    }}>
      {children}
    </button>
  );
}

// ── Habits components ─────────────────────────────────────────────────────────

interface HabitsContentProps {
  habits: HabitDef[];
  habitCounters: Record<string, number>;
  habitDone: Record<string, boolean>;
  showInToday: boolean;
  onCounterChange: (id: string, delta: number) => void;
  onToggle: (id: string) => void;
  onToggleShowInToday: () => void;
  onAddHabit: () => void;
  onEditHabit: (habit: HabitDef) => void;
  onDeleteHabit: (id: string) => void;
}

function HabitsContent({ habits, habitCounters, habitDone, showInToday, onCounterChange, onToggle, onToggleShowInToday, onAddHabit, onEditHabit, onDeleteHabit }: HabitsContentProps) {
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const doneCount = habits.filter(h =>
    h.kind === 'boolean' ? (habitDone[h.id] ?? false) : (habitCounters[h.id] ?? 0) >= (h.goal ?? 1)
  ).length;

  return (
    <div style={{ padding: '14px 14px 12px' }}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 2 }}>
          Today · {dayName}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{dateStr}</div>
      </div>

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Today's progress
          </div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {doneCount} of {habits.length} habits done
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--color-success)' }}>
          {doneCount}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-muted)' }}>/{habits.length}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>Habits</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={onToggleShowInToday}
            style={{
              fontSize: 10, fontWeight: showInToday ? 600 : 400, cursor: 'pointer',
              background: 'none', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)', padding: '2px 7px',
              color: showInToday ? 'var(--color-accent)' : 'var(--color-text-faint)',
              display: 'flex', alignItems: 'center', gap: 3,
            }}
          >
            <span>📌</span> {showInToday ? 'In Today' : 'Show in Today'}
          </button>
          <button
            onClick={onAddHabit}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent)', background: 'none', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer' }}
          >
            + Add
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {habits.map(habit => {
          const isDone = habit.kind === 'boolean'
            ? (habitDone[habit.id] ?? false)
            : (habitCounters[habit.id] ?? 0) >= (habit.goal ?? 1);
          return (
            <HabitRow
              key={habit.id}
              habit={habit}
              count={habitCounters[habit.id] ?? 0}
              checked={habitDone[habit.id] ?? false}
              isDone={isDone}
              onCounterChange={(delta) => onCounterChange(habit.id, delta)}
              onToggle={() => onToggle(habit.id)}
              onEdit={() => onEditHabit(habit)}
              onDelete={() => onDeleteHabit(habit.id)}
            />
          );
        })}
      </div>

      <WeekStrip habits={habits} />
    </div>
  );
}

function HabitRow({ habit, count, checked, isDone, onCounterChange, onToggle, onEdit, onDelete }: {
  habit: HabitDef;
  count: number;
  checked: boolean;
  isDone: boolean;
  onCounterChange: (delta: number) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div style={{
      position: 'relative',
      display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 12,
      alignItems: 'center', padding: '10px 12px',
      background: isDone ? 'var(--color-success-bg)' : 'var(--color-surface)',
      border: `1px solid ${isDone ? 'var(--color-success-bg)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-md)',
    }}>
      {/* Context menu */}
      {showMenu && (
        <div style={{
          position: 'absolute', top: 0, right: 0, zIndex: 50,
          background: 'var(--color-bg)', border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          overflow: 'hidden', minWidth: 120,
        }}>
          {confirmDelete ? (
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>Delete habit?</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={onDelete} style={{ flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600, background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Delete</button>
                <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: '5px 0', fontSize: 11, background: 'none', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => { setShowMenu(false); onEdit(); }}
                style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text)' }}
              >
                ✏ Edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ display: 'block', width: '100%', padding: '9px 14px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-accent)', borderTop: '1px solid var(--color-border)' }}
              >
                🗑 Delete
              </button>
            </>
          )}
        </div>
      )}

      <HabitIcon kind={habit.icon} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{habit.name}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {habit.streakLabel}
          {habit.unit && habit.unitAmount && (
            <span style={{ marginLeft: 6, color: 'var(--color-text-faint)' }}>
              · {habit.kind === 'counter'
                ? `${habit.unitAmount}${habit.unit}/step · goal ${(habit.goal ?? 1) * habit.unitAmount}${habit.unit}`
                : `${habit.unitAmount}${habit.unit}`}
            </span>
          )}
          {habit.days.length > 0 && habit.days.length < 7 && (
            <span style={{ marginLeft: 6, color: 'var(--color-text-faint)' }}>
              · {habit.days.map(d => ['M','T','W','T','F','S','S'][d]).join(' ')}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {habit.kind === 'counter' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button onClick={() => onCounterChange(-1)} style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>−</button>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, minWidth: 32, textAlign: 'center' }}>
                {count}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{habit.goal}</span>
              </div>
              <button onClick={() => onCounterChange(1)} style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>+</button>
            </div>
            {habit.unit && habit.unitAmount && (
              <span style={{ fontSize: 10, color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                {count * habit.unitAmount}/{(habit.goal ?? 1) * habit.unitAmount}{habit.unit}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {habit.unit && habit.unitAmount && (
              <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>
                {habit.unitAmount}{habit.unit}
              </span>
            )}
            <button onClick={onToggle} style={{
              width: 26, height: 26, borderRadius: 5,
              border: checked ? '1.5px solid var(--color-success)' : '1.5px solid var(--color-border-strong)',
              background: checked ? 'var(--color-success)' : 'var(--color-bg)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: checked ? '#fff' : 'transparent',
            }}>✓</button>
          </div>
        )}
        <button
          onClick={() => { setShowMenu(v => !v); setConfirmDelete(false); }}
          style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--color-text-faint)', lineHeight: 1, flexShrink: 0 }}
          title="Edit or delete"
        >
          ···
        </button>
      </div>
    </div>
  );
}

function HabitIcon({ kind, size = 32 }: { kind: HabitIconKind; size?: number }) {
  const bgColor: Record<HabitIconKind, string> = {
    water: 'rgba(74, 111, 165, 0.12)',
    fitness: 'rgba(200, 85, 61, 0.12)',
    book: 'var(--color-success-bg)',
    sleep: 'rgba(123, 93, 180, 0.12)',
    run: 'rgba(212, 118, 42, 0.12)',
    meditate: 'rgba(45, 138, 122, 0.12)',
    journal: 'rgba(155, 124, 26, 0.12)',
  };
  const fgColor: Record<HabitIconKind, string> = {
    water: 'var(--color-info)',
    fitness: 'var(--color-accent)',
    book: 'var(--color-success)',
    sleep: '#7B5DB4',
    run: '#D4762A',
    meditate: '#2D8A7A',
    journal: '#9B7C1A',
  };
  const icons: Record<HabitIconKind, React.ReactNode> = {
    water: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2 C8 2 4 7 4 10 C4 12.2 5.8 14 8 14 C10.2 14 12 12.2 12 10 C12 7 8 2 8 2 Z" />
      </svg>
    ),
    fitness: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4.5" y1="8" x2="11.5" y2="8" />
        <rect x="3" y="6" width="1.5" height="4" rx="0.5" />
        <rect x="11.5" y="6" width="1.5" height="4" rx="0.5" />
        <rect x="1" y="6.8" width="2" height="2.4" rx="0.5" />
        <rect x="13" y="6.8" width="2" height="2.4" rx="0.5" />
      </svg>
    ),
    book: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2 C4 2 6.5 1.5 8 2.5 C9.5 1.5 12 2 12 2 L12 13 C12 13 9.5 12.5 8 13.5 C6.5 12.5 4 13 4 13 Z" />
        <line x1="8" y1="2.5" x2="8" y2="13.5" />
        <line x1="4" y1="13" x2="4" y2="2" />
      </svg>
    ),
    sleep: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 9.5 C11.5 12.5 8 14 5 12.5 C2 11 1 7.5 2.5 4.5 C4 1.5 7 0.5 9.5 1.5 C7 3 6 6 7.5 8.5 C9 11 12 11.5 13 9.5 Z" />
      </svg>
    ),
    run: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10" cy="2.5" r="1.3" fill="currentColor" stroke="none" />
        <line x1="9" y1="3.8" x2="7.5" y2="7.5" />
        <line x1="8.5" y1="5.2" x2="11.5" y2="4" />
        <line x1="8.5" y1="5.2" x2="6" y2="7" />
        <line x1="7.5" y1="7.5" x2="10" y2="12" />
        <line x1="7.5" y1="7.5" x2="5" y2="12.5" />
      </svg>
    ),
    meditate: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="3" r="1.5" />
        <line x1="8" y1="4.5" x2="8" y2="7.5" />
        <path d="M4 12 Q6 9 8 9 Q10 9 12 12" />
        <line x1="8" y1="6.5" x2="4.5" y2="9" />
        <line x1="8" y1="6.5" x2="11.5" y2="9" />
      </svg>
    ),
    journal: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="9" height="12" rx="1" />
        <line x1="4.5" y1="5.5" x2="8.5" y2="5.5" />
        <line x1="4.5" y1="8" x2="8.5" y2="8" />
        <line x1="4.5" y1="10.5" x2="7" y2="10.5" />
        <path d="M11 7.5 L14 4.5 L13 3.5 L10 6.5 Z" />
        <line x1="10" y1="6.5" x2="11" y2="7.5" />
      </svg>
    ),
  };
  const radius = size <= 24 ? 5 : 7;
  return (
    <div style={{
      width: size, height: size, borderRadius: radius, flexShrink: 0,
      background: bgColor[kind], color: fgColor[kind],
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {icons[kind]}
    </div>
  );
}

function WeekStrip({ habits }: { habits: HabitDef[] }) {
  const totalCompletions = WEEK_COMPLETIONS.reduce((sum, d) => sum + d.count, 0);
  const maxCompletions = WEEK_DAYS.length * habits.length;
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>This week</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{totalCompletions} / {maxCompletions} completions</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WEEK_DAYS.map((day, i) => {
          const cell = WEEK_COMPLETIONS[i]!;
          const isFull = cell.kind === 'full';
          const isPartial = cell.kind === 'partial';
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--color-text-faint)' }}>
                {day}
              </span>
              <div style={{
                width: '100%', aspectRatio: '1', borderRadius: 4,
                background: isFull ? 'var(--color-success)' : isPartial ? 'var(--color-success-bg)' : 'var(--color-bg)',
                border: `1px solid ${isFull ? 'var(--color-success)' : isPartial ? 'var(--color-success-bg)' : 'var(--color-border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
                color: isFull ? '#fff' : isPartial ? 'var(--color-success)' : 'var(--color-text-muted)',
                boxShadow: cell.isToday ? '0 0 0 1.5px var(--color-accent)' : 'none',
              }}>
                {cell.count}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Habit form ────────────────────────────────────────────────────────────────

const FORM_INPUT_STYLE: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '7px 10px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13, color: 'var(--color-text)',
  outline: 'none', fontFamily: 'inherit',
};

const ICON_OPTIONS: HabitIconKind[] = ['water', 'fitness', 'book', 'sleep', 'run', 'meditate', 'journal'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function HabitForm({ initialHabit, onSave, onCancel }: {
  initialHabit?: HabitDef;
  onSave: (habit: HabitDef) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialHabit?.name ?? '');
  const [kind, setKind] = useState<HabitKind>(initialHabit?.kind ?? 'boolean');
  const [icon, setIcon] = useState<HabitIconKind>(initialHabit?.icon ?? 'water');
  const [goal, setGoal] = useState(initialHabit?.goal?.toString() ?? '');
  const [unit, setUnit] = useState(initialHabit?.unit ?? '');
  const [unitAmount, setUnitAmount] = useState(initialHabit?.unitAmount?.toString() ?? '');
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initialHabit ? (initialHabit.days.length === 0 ? [0,1,2,3,4,5,6] : initialHabit.days) : [0,1,2,3,4,5,6]
  );

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const handleSave = () => {
    if (!name.trim()) return;
    const parsedUnitAmount = parseInt(unitAmount, 10);
    const hasUnit = unit.trim().length > 0;
    const hasUnitAmount = hasUnit && !isNaN(parsedUnitAmount) && parsedUnitAmount > 0;
    onSave({
      id: initialHabit?.id ?? crypto.randomUUID(),
      name: name.trim(),
      kind,
      icon,
      ...(kind === 'counter' ? { goal: parseInt(goal, 10) || 1 } : {}),
      ...(hasUnit ? { unit: unit.trim() } : {}),
      ...(hasUnitAmount ? { unitAmount: parsedUnitAmount } : {}),
      streakLabel: initialHabit?.streakLabel ?? 'New habit',
      days: selectedDays.length === 7 ? [] : selectedDays,
      workspaceId: initialHabit?.workspaceId,
    });
  };

  return (
    <div style={{ padding: '14px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{initialHabit ? 'Edit habit' : 'New habit'}</div>

      <div style={{ marginBottom: 12 }}>
        <FormLabel>Name</FormLabel>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Drink water"
          autoFocus
          style={FORM_INPUT_STYLE}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <FormLabel>Icon</FormLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ICON_OPTIONS.map(k => (
            <button
              key={k}
              onClick={() => setIcon(k)}
              style={{
                padding: 0, cursor: 'pointer',
                border: `2px solid ${icon === k ? 'var(--color-accent)' : 'transparent'}`,
                borderRadius: 9, background: 'none',
              }}
            >
              <HabitIcon kind={k} />
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <FormLabel>Type</FormLabel>
        <div style={{ display: 'flex', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3 }}>
          {(['boolean', 'counter'] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} style={{
              flex: 1, padding: '5px 0', borderRadius: 'calc(var(--radius-md) - 3px)',
              border: 'none', cursor: 'pointer', fontSize: 12,
              fontWeight: kind === k ? 600 : 400,
              background: kind === k ? 'var(--color-surface)' : 'transparent',
              color: kind === k ? 'var(--color-text)' : 'var(--color-text-muted)',
              boxShadow: kind === k ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}>
              {k === 'boolean' ? 'Done / Not done' : 'Counter'}
            </button>
          ))}
        </div>
      </div>

      {kind === 'counter' && (
        <div style={{ marginBottom: 12 }}>
          <FormLabel>Daily goal</FormLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="8"
              min={1}
              style={{ ...FORM_INPUT_STYLE, width: 70 }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>per day</span>
          </div>
        </div>
      )}

      {kind === 'counter' && <div style={{ marginBottom: 12 }}>
        <FormLabel>Unit <span style={{ fontWeight: 400, color: 'var(--color-text-faint)' }}>(optional)</span></FormLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <input
              list="habit-unit-options"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="ml, min, pages…"
              style={FORM_INPUT_STYLE}
            />
            <datalist id="habit-unit-options">
              <option value="ml" />
              <option value="min" />
              <option value="pages" />
              <option value="km" />
              <option value="steps" />
              <option value="cal" />
              <option value="glasses" />
              <option value="reps" />
            </datalist>
          </div>
          {unit.trim() && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <input
                type="number"
                value={unitAmount}
                onChange={e => setUnitAmount(e.target.value)}
                placeholder="250"
                min={1}
                style={{ ...FORM_INPUT_STYLE, width: 70 }}
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {unit.trim()} / {kind === 'counter' ? 'step' : 'session'}
              </span>
            </div>
          )}
        </div>
      </div>}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <FormLabel style={{ marginBottom: 0 }}>Days</FormLabel>
          {selectedDays.length < 7 && (
            <button
              onClick={() => setSelectedDays([0, 1, 2, 3, 4, 5, 6])}
              style={{ fontSize: 10, color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Reset to every day
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {DAY_LABELS.map((d, i) => {
            const active = selectedDays.includes(i);
            return (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                style={{
                  flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
                  borderRadius: 5, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: active ? 'rgba(200, 85, 61, 0.10)' : 'transparent',
                  color: active ? 'var(--color-accent)' : 'var(--color-text-faint)',
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
        {selectedDays.length === 7 && (
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4 }}>
            Every day. Tap a day to customize.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: '8px 0', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'none', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          style={{
            flex: 2, padding: '8px 0', border: 'none', borderRadius: 'var(--radius-md)',
            background: name.trim() ? 'var(--color-accent)' : 'var(--color-border)',
            color: name.trim() ? '#fff' : 'var(--color-text-muted)',
            fontSize: 13, fontWeight: 600, cursor: name.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          {initialHabit ? 'Save changes' : 'Save habit'}
        </button>
      </div>
    </div>
  );
}

function MeetingAddFieldButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 0', background: 'none', border: 'none', cursor: 'pointer',
      fontSize: 12, color: 'var(--color-text-faint)',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>
      <span style={{ fontSize: 14, lineHeight: 1, color: 'var(--color-text-muted)' }}>+</span>
      {label}
    </button>
  );
}

function FormLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--color-text-muted)',
      marginBottom: 6, ...style,
    }}>
      {children}
    </div>
  );
}

// ── Tab icons ─────────────────────────────────────────────────────────────────

function TodayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <line x1="2" y1="7" x2="14" y2="7" />
      <line x1="5" y1="1" x2="5" y2="5" />
      <line x1="11" y1="1" x2="11" y2="5" />
      <rect x="6.5" y="9" width="3" height="2.5" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HabitsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,8 3.5,8 5,4.5 7,11.5 9,6 10.5,8 15,8" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,5 4,7 7,3" />
      <line x1="10" y1="5" x2="14" y2="5" />
      <polyline points="2,11 4,13 7,9" />
      <line x1="10" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <polyline points="8,5 8,8 10.5,9.5" />
    </svg>
  );
}
