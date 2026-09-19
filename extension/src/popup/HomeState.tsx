import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
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
import {
  achievementTier, badgeKind, BADGE_CHALLENGE_LENGTH, CHALLENGE_BADGE_KIND, challengeAwardId, challengeProjectedEnd, challengeSkipAllowance, MAX_CHALLENGE_LENGTH_DAYS,
  nextAchievementTier, sameSchedule,
  challengeCanKeepGoing, challengeDaysOf, challengeDaysShown, challengeEarnsBadge,
  challengeKeepGoing, challengeNeedsDecision, challengeProgress, challengeProgressLabel,
  challengeRecordCompletion, challengeSkipsLeft, challengeStartOver, challengeStreakLabel,
  habitStreakLabel, reorderSubset,
} from '@pomodoso/types';
import type { AchievementTier, ChallengeProgress, ChallengeState } from '@pomodoso/types';
import type { SelectedTask, TodayTask, TaskStatus, Project, TimerSettings, TimeLogEntry, Workspace } from './App';
import {
  db, now, localDate,
  type AchievementRow,
  type HabitRow as HabitDef,
  type HabitHistoryRow,
  type MeetingRow as CalendarMeeting,
  // Aliased because TaskRow is also the name of a component in this file.
  type TaskRow as TaskRecord,
  type HabitKind,
  type HabitIconKind,
  type MeetingTrackMode,
} from '../db';
import { triggerSync } from '../syncEngine';
import { formatRecurrenceLabel } from '../recurrence';

marked.use({ breaks: true });

export type Tab = 'today' | 'habits' | 'tasks' | 'schedule';

interface HomeStateProps {
  timerState: TimerState;
  timerSettings: TimerSettings;
  detectedTicket: TicketRef | null;
  detectedExistingTasks: SelectedTask[];
  todayPriorities: TodayTask[];
  todayTasks: TodayTask[];
  backlog: SelectedTask[];
  recurringTemplates: SelectedTask[];
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
  currentUrl?: string;
  urlMatchesRule?: boolean;
  onAddDetectionRule?: (name: string, urlPattern: string) => void;
  onOpenAccount: () => void;
  onSignOut: () => void;
  onSyncNow?: (() => void) | undefined;
  isSignedIn: boolean;
  syncStatus: 'disconnected' | 'connected' | 'syncing' | 'offline' | 'error';
  selectedText: string | null;
  onCreateFromText: (text: string) => void;
  onAddTextToNotes: (text: string) => void;
  onCreateTask: (title: string) => void;
  onCreateFollowup: (parentId: string) => void;
  onReorderToday: (priorityIds: string[], todayIds: string[]) => void;
  onReorderBacklog: (backlogIds: string[]) => void;
  workspaces: Workspace[];
  activeWsId: string;
  onSetActiveWs: (id: string) => void;
  timezone: string;
  maxPriorities: number;
  weekStart: number;
  workDays: number[];
  activeTab: Tab;
  onSetActiveTab: (tab: Tab) => void;
}

const WEEK_DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

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

// ─── Remote timer banner ───────────────────────────────────────────────────────
// Shown when the active_timer beacon synced from another device is still live.

interface RemoteBeacon {
  started_at?: string;
  mode?: string;
  task_id?: string | null;
  duration_seconds?: number | null;
}

function RemoteTimerBanner({ beacon }: { beacon: RemoteBeacon }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const task = useLiveQuery(
    // The resolve is annotated so both ternary branches produce the same
    // promise type. Left bare it infers Promise<undefined>, and the union
    // with Dexie's PromiseExtended defeats useLiveQuery's overload
    // resolution — the hook then appears to hand back the unresolved promise
    // rather than the row, so every field access below fails to typecheck.
    () => beacon.task_id ? db.tasks.get(beacon.task_id) : Promise.resolve<TaskRecord | undefined>(undefined),
    [beacon.task_id],
  );

  const startedAt = beacon.started_at ? new Date(beacon.started_at).getTime() : 0;
  if (!startedAt) return null;
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const planned = beacon.duration_seconds ?? null;
  // Stale beacon: pomodoro past its planned end (+grace), or stopwatch older than 12h
  if (planned != null && elapsed > planned + 300) return null;
  if (planned == null && elapsed > 12 * 3600) return null;

  const timeLabel = planned != null ? formatTime(Math.max(0, planned - elapsed)) : formatElapsed(elapsed);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', flexShrink: 0,
      borderBottom: '1px solid var(--color-border)', background: 'var(--color-accent-soft)',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
        background: 'var(--color-accent)', animation: 'pulse 1.6s ease-in-out infinite',
      }} />
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {beacon.mode === 'pomodoro' ? 'Pomodoro' : 'Timer'} running on another device
        {task?.title ? ` · ${task.title}` : ''}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)', flexShrink: 0 }}>
        {timeLabel}
      </span>
    </div>
  );
}

// Build detection-rule regex options from the current tab URL. Returns null for
// non-http(s) pages (chrome://, the extension itself, blank tabs).
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function detectionPatternsForUrl(rawUrl: string | undefined): { host: string; domain: string; domainPath: string | null; pathLabel: string | null } | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    const firstSeg = u.pathname.split('/').filter(Boolean)[0];
    // Anchor the host after `//` and allow an optional subdomain, so a rule for
    // example.com matches www/app.example.com but NOT notexample.com. The
    // subdomain group is non-capturing so it doesn't leak into the ticket id.
    const hostRe = `\\/\\/(?:[^/]+\\.)?${escapeRegex(host)}`;
    return {
      host,
      domain: `${hostRe}(?:[\\/:?#]|$)`,
      domainPath: firstSeg ? `${hostRe}\\/${escapeRegex(firstSeg)}(?:[\\/:?#]|$)` : null,
      pathLabel: firstSeg ? `${host}/${firstSeg}` : null,
    };
  } catch {
    return null;
  }
}

export function HomeState({
  timerState, timerSettings, detectedTicket, detectedExistingTasks, todayPriorities, todayTasks, backlog, recurringTemplates, projects, prioritiesFull,
  workspaces, activeWsId, onSetActiveWs, timezone, maxPriorities,
  onAddToPriorities, onAddToTasks, onRemoveFromToday, onSelectTask, onStartTimer, onAttachTask, onDoneTask, onDetachTask, onFinishStopwatch, onPausePomo, onResumePomo, onCompletePomo, onStartBreak, onSnooze, onExtendBreak, onStartNextPomo, onCancelTimer,
  linkedTasks, onSelectLinkedTask,
  onUpdateTaskStatus, onAddToBacklog, onLinkToTask, onOpenSettings, onOpenCalendarSettings, onOpenAccount, onSignOut, onSyncNow,
  currentUrl, urlMatchesRule, onAddDetectionRule,
  selectedText, onCreateFromText, onAddTextToNotes, onCreateTask, onCreateFollowup, onReorderToday, onReorderBacklog,
  weekStart, workDays, activeTab, onSetActiveTab: setActiveTab, isSignedIn, syncStatus,
}: HomeStateProps) {
  const projectById = (id: string | null) => id ? projects.find(p => p.id === id) : undefined;
  const filterChipStyle = (active: boolean): React.CSSProperties => ({
    padding: '3px 10px', fontSize: 11, fontWeight: active ? 600 : 400,
    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: active ? 'var(--color-accent-soft)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    fontFamily: 'inherit',
  });
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showModePicker, setShowModePicker] = useState<SelectedTask | null>(null);
  const [showDetectionModal, setShowDetectionModal] = useState(false);
  const [linkedDismissed, setLinkedDismissed] = useState(false);
  const detectionPatterns = detectionPatternsForUrl(currentUrl);
  // Manual order first (see HabitRow.sortOrder), then creation date for habits
  // that predate it or arrived from a device that hasn't ordered them yet.
  const habits = useLiveQuery(async () => {
    const rows = await db.habits.filter(h => !h.deletedAt).toArray();
    return rows.sort((a, b) => {
      const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
    });
  }) ?? [];

  // Habits are user-global, so their order is too — one sequence, shown the
  // same in every workspace and in "all".
  const reorderHabits = useCallback(async (orderedIds: string[]) => {
    const ts = now();
    await db.transaction('rw', db.habits, async () => {
      await Promise.all(orderedIds.map((id, i) => db.habits.update(id, { sortOrder: i, updatedAt: ts })));
    });
    triggerSync();
  }, []);
  // Full habit history. Hoisted here from HabitsContent now that Today renders
  // challenge cards too — the note there said it stayed local because "Today's
  // habit rows just show done/count, no streak", which stopped being true.
  //
  // Memoized, unlike most derived values in this component: HomeState re-renders
  // every second while a timer runs, and this walks every habit log row there
  // is. The rest of the derived data here is O(today).
  const allHabitHistory: HabitHistoryRow[] = useLiveQuery(() => db.habitHistory.toArray(), []) ?? [];
  const habitHistoryByHabit = useMemo(() => {
    const byHabit = new Map<string, Map<string, HabitHistoryRow>>();
    for (const r of allHabitHistory) {
      if (!byHabit.has(r.habitId)) byHabit.set(r.habitId, new Map());
      byHabit.get(r.habitId)!.set(r.date, r);
    }
    return byHabit;
  }, [allHabitHistory]);

  const achievements = useLiveQuery(() => db.achievements.filter(a => !a.deletedAt).toArray()) ?? [];

  const meetings = useLiveQuery(() => db.meetings.filter(m => !m.deletedAt).toArray()) ?? [];
  const remoteTimerRow = useLiveQuery(() => db.settings.get('active_timer_remote'));
  const remoteBeacon = remoteTimerRow?.value as RemoteBeacon | undefined;
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
  const [recurringCollapsed, setRecurringCollapsed] = useState(false);
  const [backlogSearch, setBacklogSearch] = useState('');
  const [backlogStatusFilter, setBacklogStatusFilter] = useState<TaskStatus | 'all'>('all');
  const [backlogProjectFilter, setBacklogProjectFilter] = useState<string | null>(null);
  const [habitsSubTab, setHabitsSubTab] = useState<'today' | 'history'>('today');
  const [isAddingHabit, setIsAddingHabit] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitDef | null>(null);
  // Both pins are device-local, matching showScheduleInToday below. showHabits
  // used to be a plain useState, so it silently reset every time the popup was
  // reopened.
  const [showHabitsInToday, setShowHabitsInToday] = useLocalStorage<boolean>('pom_habits_in_today', true);
  const [showChallengesInToday, setShowChallengesInToday] = useLocalStorage<boolean>('pom_challenges_in_today', true);
  const [showScheduleInToday, setShowScheduleInToday] = useLocalStorage<boolean>('pom_schedule_in_today', true);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const wsPickerRef = useRef<HTMLDivElement>(null);

  // Workspace-filtered habits and meetings (meetings: only today's occurrences)
  // Habits are user-global — shown in every workspace (and the All view).
  const visibleHabits = habits;

  // Each streak walks back day by day until it hits a miss, so this is cheap for
  // a short streak and not for a long one — and it runs per habit. Memoized for
  // the same reason as the history map above.
  const habitStreaks = useMemo(
    () => new Map(
      habits.map(h => [h.id, computeHabitStreak(h, habitHistoryByHabit.get(h.id) ?? new Map(), timezone)]),
    ),
    [habits, habitHistoryByHabit, timezone],
  );
  // Challenges run to a fixed length, so a habit past its end date still has a
  // result worth showing; only the schedule-based Today list hides those.
  const challengeHabits = habits.filter(h => (h.challengeLengthDays ?? 0) > 0);

  // A challenge is no longer a view of the live streak — it is a run with a
  // start date, forgiven days and a recorded finish. challengeStateOf reads
  // that run off the habit; the fallback start date covers a habit whose
  // migration hasn't run on this device yet.
  const challengeStateOf = useCallback((h: HabitDef): ChallengeState => ({
    lengthDays: h.challengeLengthDays ?? 21,
    startedAt: h.challengeStartedAt ?? today,
    completedAt: h.challengeCompletedAt ?? null,
    skippedDays: h.challengeSkippedDays ?? [],
  }), [today]);

  const challengeViews = useMemo(() => {
    const views = new Map<string, { state: ChallengeState; progress: ChallengeProgress }>();
    for (const h of challengeHabits) {
      const state = challengeStateOf(h);
      const rows = habitHistoryByHabit.get(h.id) ?? new Map<string, HabitHistoryRow>();
      const isDone = (date: string): boolean => {
        const row = rows.get(date);
        if (!row) return false;
        return h.kind === 'counter' ? (row.count ?? 0) >= (h.goal ?? 1) : (row.done ?? false);
      };
      const isScheduled = (date: string): boolean =>
        h.days.length === 0 || h.days.includes((new Date(date + 'T12:00:00').getDay() + 6) % 7);
      const days = challengeDaysOf(state.startedAt, today, isScheduled, isDone);
      views.set(h.id, { state, progress: challengeProgress(state, days, today) });
    }
    return views;
  }, [challengeHabits, challengeStateOf, habitHistoryByHabit, today]);
  // ── Challenge actions ──────────────────────────────────────────────────────
  const writeChallenge = useCallback(async (id: string, next: ChallengeState) => {
    await db.habits.update(id, {
      challengeStartedAt: next.startedAt,
      challengeSkippedDays: next.skippedDays,
      // Dexie's update merges, so an explicit undefined is what clears the field.
      challengeCompletedAt: next.completedAt ?? undefined,
      updatedAt: now(),
    });
    triggerSync();
  }, []);

  const handleChallengeKeepGoing = useCallback((id: string) => {
    const view = challengeViews.get(id);
    if (!view) return;
    void writeChallenge(id, challengeKeepGoing(view.state, view.progress.missedDays));
  }, [challengeViews, writeChallenge]);

  const handleChallengeStartOver = useCallback((id: string) => {
    const view = challengeViews.get(id);
    if (!view) return;
    void writeChallenge(id, challengeStartOver(view.state, today));
  }, [challengeViews, writeChallenge, today]);

  // "Keep as habit" drops the challenge framing entirely; the habit carries on
  // with its ordinary streak, which is what the rest of the Habits tab shows.
  const handleChallengeKeepAsHabit = useCallback((id: string) => {
    void (async () => {
      await db.habits.update(id, {
        challengeLengthDays: undefined,
        challengeStartedAt: undefined,
        challengeCompletedAt: undefined,
        challengeSkippedDays: [],
        updatedAt: now(),
      });
      triggerSync();
    })();
  }, []);

  // Records a finish the moment the last day is logged. Done on the write path
  // rather than on render: a render-time write fires again on every re-render
  // and races itself, and this is the one moment the run actually changes.
  const recordCompletionIfFinished = useCallback(async (id: string) => {
    // Reads straight from Dexie rather than from challengeViews: the toggle
    // that triggered this hasn't reached the live query yet, so the rendered
    // view is one day stale — exactly the day that decides completion.
    const habit = await db.habits.get(id);
    if (!habit?.challengeLengthDays || habit.challengeCompletedAt) return;
    const state: ChallengeState = {
      lengthDays: habit.challengeLengthDays,
      startedAt: habit.challengeStartedAt ?? today,
      completedAt: null,
      skippedDays: habit.challengeSkippedDays ?? [],
    };
    const rows = await db.habitHistory.filter(r => r.habitId === id).toArray();
    const byDate = new Map(rows.map(r => [r.date, r]));
    const isDone = (date: string): boolean => {
      const row = byDate.get(date);
      if (!row) return false;
      return habit.kind === 'counter' ? (row.count ?? 0) >= (habit.goal ?? 1) : (row.done ?? false);
    };
    const isScheduled = (date: string): boolean =>
      habit.days.length === 0 || habit.days.includes((new Date(date + 'T12:00:00').getDay() + 6) % 7);
    const days = challengeDaysOf(state.startedAt, today, isScheduled, isDone);
    // `complete`, not `daysDone >= lengthDays`: the rule also requires every
    // miss to have been answered. Checking the raw count here would let a run
    // that broke on day 8 and kept being logged record a finish, skip the
    // decision, and stay badge-eligible with skippedDays still empty — which
    // is the whole thing the rule was tightened to prevent.
    if (!challengeProgress(state, days, today).complete) return;

    // One transaction. The completion marker is what makes later attempts
    // return early, so committing it before the award means a failed or
    // interrupted insert leaves the run permanently medal-less — not a medal
    // lost once, but every retry turned into a no-op.
    const next = challengeRecordCompletion(state, today);
    const ts = now();
    // Caught here rather than at each call site: the reconciling effect
    // discards its promise, and the toggle handlers await it before
    // triggerSync, so an IndexedDB failure would either surface as an
    // unhandled rejection or swallow the sync that follows. Nothing is lost by
    // returning — the run is still complete and unrecorded, so the next render
    // or popup open reconciles it again.
    try {
      await db.transaction('rw', [db.habits, db.achievements], async () => {
        await db.habits.update(id, {
          challengeStartedAt: next.startedAt,
          challengeSkippedDays: next.skippedDays,
          challengeCompletedAt: next.completedAt ?? undefined,
          updatedAt: ts,
        });
        // The award is a separate, append-only row rather than a count derived
        // from completed runs: "Go again" clears this run's completion so the
        // habit can start another, which would quietly decrement a badge already
        // earned.
        if (!challengeEarnsBadge(state)) return;
        await db.achievements.put({
          // Derived from the run, not random: this whole function is
          // read-then-write and two quick taps can both see "not completed yet"
          // before either write lands. With a random id that races into two
          // medals for one challenge; with this one the second write is an
          // idempotent upsert.
          id: challengeAwardId(id, state.startedAt),
          kind: CHALLENGE_BADGE_KIND,
          earnedOn: today,
          habitId: id,
          createdAt: ts,
          updatedAt: ts,
        });
        });
    } catch (err) {
      console.warn('Could not record challenge completion; will retry', err);
      return;
    }
    triggerSync();
  }, [today]);

  // A run can reach its length without any toggle happening here — the
  // migration backfill, or habit logs pulled from another device, can already
  // satisfy it. The card would read "complete" while nothing was ever
  // recorded, and "Go again" would then reset the run and lose the medal it
  // had actually earned. Reconciling on read closes that: idempotent, because
  // the completion marker gates re-entry and the award id comes from the run.
  useEffect(() => {
    for (const [habitId, view] of challengeViews) {
      if (view.progress.complete && view.state.completedAt === null) {
        void recordCompletionIfFinished(habitId);
      }
    }
  }, [challengeViews]); // eslint-disable-line react-hooks/exhaustive-deps

  // A run needs its start date on disk, not merely defaulted at read time.
  //
  // challengeStateOf falls back to `today` when the field is missing, which
  // reads as a sensible default and is in fact fatal: nothing ever wrote it, so
  // the fallback is recomputed tomorrow against the new today, and the run
  // restarts every single day. A challenge created in the app sat on "Day 1 of
  // 21" forever — only habits backfilled by the v16 migration worked, which is
  // why it survived: every run anyone had tested predated the feature.
  //
  // Done here rather than in the form because this is the one place that
  // catches every route a challenge arrives by — created, enabled on an
  // existing habit, restarted by an edit, imported from a backup, or pulled
  // from a device running an older build — and because `today` here is the
  // user's configured timezone rather than the browser's.
  useEffect(() => {
    for (const h of challengeHabits) {
      if (h.challengeStartedAt === undefined) {
        void db.habits.update(h.id, { challengeStartedAt: today, updatedAt: now() });
      }
    }
  }, [challengeHabits, today]);

  // days[] uses 0=Mon…6=Sun; empty = every day. Filter for Today tab only.
  const todayDow = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  const todayHabits = visibleHabits.filter(h =>
    (h.days.length === 0 || h.days.includes(todayDow)) &&
    (!h.endDate || today <= h.endDate),
  );
  const visibleMeetings = meetings
    .filter(m => {
      if (activeWsId !== 'all' && m.workspaceId !== activeWsId && m.workspaceId != null) return false;
      return m.time.slice(0, 10) === today;
    })
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  const activeWs = workspaces.find(w => w.id === activeWsId);

  // ── Drag and drop ──────────────────────────────────────────────────────────
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragGuard = useDragResizeGuard();

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
      // Over the cap set in Settings → General, bump the trailing priorities
      // down into Today's tasks. A loop, not a single pop: the cap can be
      // lowered after priorities are already full, so more than one may need
      // to give way.
      while (newPriorityIds.length > maxPriorities) {
        const bumped = newPriorityIds.pop();
        if (bumped === undefined) break;
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
  }, [todayPriorities, todayTasks, maxPriorities, onReorderToday]);

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
    await recordCompletionIfFinished(id);
    triggerSync();
  }, [habits, today, recordCompletionIfFinished]);

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
    await recordCompletionIfFinished(id);
    triggerSync();
  }, [today, recordCompletionIfFinished]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {detectionPatterns && onAddDetectionRule && !urlMatchesRule && (
            <IconButton title={`Detect tasks on ${detectionPatterns.host}`} onClick={() => setShowDetectionModal(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="7" />
                <line x1="12" y1="1" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="1" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="23" y2="12" />
              </svg>
            </IconButton>
          )}
          <IconButton title="Add task" onClick={() => setShowQuickAdd(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </IconButton>
          {/* ── Header menu ── */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(v => !v)}
              title="Menu"
              style={{
                width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer',
                background: showMenu ? 'var(--color-surface)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                color: 'var(--color-text-muted)',
              }}
            >
              {/* Sync status dot */}
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: syncStatus === 'syncing' ? '#4ade80'
                  : syncStatus === 'connected' ? '#facc15'
                  : syncStatus === 'offline' ? '#9ca3af'
                  : syncStatus === 'error' ? '#f97316'
                  : '#f87171',
              }} />
              {/* Hamburger lines */}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                {[0,1,2].map(i => (
                  <span key={i} style={{ width: 11, height: 1.5, borderRadius: 1, background: 'currentColor', display: 'block' }} />
                ))}
              </span>
            </button>

            {showMenu && (() => {
              const rect = menuRef.current?.getBoundingClientRect();
              return (<>
                <div style={{ position: 'fixed', inset: 0, zIndex: 98 }} onClick={() => setShowMenu(false)} />
                <div style={{
                  position: 'fixed',
                  top: (rect?.bottom ?? 40) + 4,
                  right: 8,
                  zIndex: 99,
                  minWidth: 172, padding: '4px',
                  background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                  display: 'flex', flexDirection: 'column', gap: 1,
                }}>
                  {/* Sync status */}
                  {isSignedIn ? (
                    <div style={{ padding: '6px 10px 4px', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: syncStatus === 'syncing' ? '#4ade80'
                          : syncStatus === 'connected' ? '#facc15'
                          : syncStatus === 'offline' ? '#9ca3af'
                          : syncStatus === 'error' ? '#f97316'
                          : '#f87171',
                      }} />
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                        {syncStatus === 'syncing' ? 'Syncing…'
                          : syncStatus === 'offline' ? 'Offline — changes saved on this device'
                          : syncStatus === 'error' ? 'Sync paused — will retry automatically'
                          : 'Connected'}
                      </span>
                    </div>
                  ) : (
                    <MenuRow icon="◉" label="Sign in to sync" onClick={() => { setShowMenu(false); onOpenAccount(); }} />
                  )}
                  <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
                  {onSyncNow && (
                    <MenuRow icon="↺" label={syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'} onClick={() => { setShowMenu(false); onSyncNow(); }} />
                  )}
                  <MenuRow icon="⚙" label="Settings" onClick={() => { setShowMenu(false); onOpenSettings(); }} />
                  <MenuRow icon="↗" label="Open web app" onClick={() => { setShowMenu(false); chrome.tabs.create({ url: 'https://pomodoso.com/dashboard' }); }} />
                  <MenuRow icon="?" label="Support" onClick={() => { setShowMenu(false); chrome.tabs.create({ url: 'https://pomodoso.com/support' }); }} />
                  {isSignedIn && (<>
                    <div style={{ height: 1, background: 'var(--color-border)', margin: '2px 0' }} />
                    <MenuRow icon="→" label="Account & Sync" onClick={() => { setShowMenu(false); onOpenAccount(); }} />
                    <MenuRow icon="✕" label="Sign out" onClick={() => { setShowMenu(false); onSignOut(); }} danger />
                  </>)}
                </div>
              </>);
            })()}
          </div>
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

      {showDetectionModal && detectionPatterns && onAddDetectionRule && (
        <DetectionRuleModal
          patterns={detectionPatterns}
          onAdd={(name, pattern) => { onAddDetectionRule(name, pattern); setShowDetectionModal(false); }}
          onClose={() => setShowDetectionModal(false)}
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

      {/* ── Remote timer (running on another device) ── */}
      {!isActive && !isBreak && remoteBeacon?.started_at && (
        <RemoteTimerBanner beacon={remoteBeacon} />
      )}

      {/* ── Detection banner ── */}
      {(() => {
        if (!detectedTicket || isBreak) return null;
        // Rule-detected tickets may lack an id — dismiss by URL in that case
        if ((detectedTicket.external_id || detectedTicket.external_url) === dismissedTicketId) return null;
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
              const key = detectedTicket.external_id || detectedTicket.external_url;
              setDismissedTicketId(key);
              void chrome.storage.session.set({ dismissed_ticket_id: key });
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
                collisionDetection={closestCenter}
                measuring={DND_MEASURING}
                onDragStart={(e) => { dragGuard.onDragStart(); setDragActiveId(e.active.id as string); }}
                onDragEnd={(e) => { dragGuard.onDragSettled(); handleDragEnd(e); }}
                onDragCancel={() => { dragGuard.onDragSettled(); setDragActiveId(null); }}
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
                          focusSeconds={timerSettings.focusSeconds}
                          onSelect={() => onSelectTask(task)}
                          onPlay={() => handlePlayTask(task)}
                          onDone={() => void onDoneTask()}
                          onDetach={() => void onDetachTask()}
                          onStatusChange={(status) => onUpdateTaskStatus(task.id, status)}
                        />
                      );
                    })}
                  </SortableContext>
                  <DroppableArea
                    id="droppable-priority"
                    empty={todayPriorities.length === 0}
                    label={`Drag a task here to make it a priority (max ${maxPriorities})`}
                  />
                </div>
                <div style={{ padding: '12px 14px 0' }}>
                  <SectionHeader label="Today's tasks" done={completedTasks} total={todayTasks.length} />
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
                          focusSeconds={timerSettings.focusSeconds}
                          onSelect={() => onSelectTask(task)}
                          onPlay={() => handlePlayTask(task)}
                          onDone={() => void onDoneTask()}
                          onDetach={() => void onDetachTask()}
                          onStatusChange={(status) => onUpdateTaskStatus(task.id, status)}
                        />
                      );
                    })}
                  </SortableContext>
                  <DroppableArea id="droppable-tasks" empty={todayTasks.length === 0} />
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
                          focusSeconds={timerSettings.focusSeconds}
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
                habits={todayHabits}
                habitCounters={habitCounters}
                habitDone={habitDone}
                weekStart={weekStart}
                timezone={timezone}
                onCounterChange={handleHabitCounterChange}
                onToggle={handleHabitToggle}
                onReorder={(ids) => void reorderHabits(reorderSubset(habits.map(h => h.id), ids))}
              />
            )}
            {showChallengesInToday && challengeHabits.length > 0 && (
              <div style={{ padding: '12px 14px 0' }}>
                <ChallengesSection habits={challengeHabits} views={challengeViews} />
              </div>
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
              today={today}
              onSave={(habit) => {
                // A new habit goes to the end of the manual order, matching
                // where the list already puts it before any dragging.
                const nextOrder = habits.reduce((max, h) => Math.max(max, h.sortOrder ?? -1), -1) + 1;
                // Habits are user-global — never pinned to the active workspace.
                void db.habits.put({ ...habit, sortOrder: nextOrder, workspaceId: null, updatedAt: now() });
                triggerSync();
                setIsAddingHabit(false);
              }}
              onCancel={() => setIsAddingHabit(false)}
            />
          ) : editingHabit ? (
            <HabitForm
              initialHabit={editingHabit}
              today={today}
              onSave={(updated) => {
                // put (full replace), not update (merge) — so turning a field OFF
                // (time unit, end date, unit) actually clears it instead of
                // leaving the stale value behind.
                void db.habits.put({ ...updated, updatedAt: now() });
                triggerSync();
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
                  weekStart={weekStart}
                  timezone={timezone}
                  onCounterChange={handleHabitCounterChange}
                  onToggle={handleHabitToggle}
                  onToggleShowInToday={() => setShowHabitsInToday(v => !v)}
                  onAddHabit={() => setIsAddingHabit(true)}
                  onEditHabit={setEditingHabit}
                  onDeleteHabit={(id) => { void db.habits.update(id, { deletedAt: now(), updatedAt: now() }); triggerSync(); }}
                  onReorder={(ids) => void reorderHabits(reorderSubset(habits.map(h => h.id), ids))}
                  streaks={habitStreaks}
                  challengeViews={challengeViews}
                  achievements={achievements}
                  challengeActions={{
                    onKeepGoing: handleChallengeKeepGoing,
                    onStartOver: handleChallengeStartOver,
                    onKeepAsHabit: handleChallengeKeepAsHabit,
                  }}
                  showChallengesInToday={showChallengesInToday}
                  onToggleShowChallengesInToday={() => setShowChallengesInToday(v => !v)}
                />
              ) : (
                <HabitHistoryView habits={visibleHabits} timezone={timezone} weekStart={weekStart} />
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
                {(() => {
                  const tq = backlogSearch.trim().toLowerCase();
                  const statuses = Array.from(new Set(backlog.map(t => t.status)));
                  const filtered = backlog.filter(t => {
                    if (backlogStatusFilter !== 'all' && t.status !== backlogStatusFilter) return false;
                    if (backlogProjectFilter && t.projectId !== backlogProjectFilter) return false;
                    if (tq && !t.title.toLowerCase().includes(tq) && !(t.ticketId ?? '').toLowerCase().includes(tq)) return false;
                    return true;
                  });
                  const isFiltered = backlogSearch !== '' || backlogStatusFilter !== 'all' || backlogProjectFilter !== null;
                  const clearFilters = () => { setBacklogSearch(''); setBacklogStatusFilter('all'); setBacklogProjectFilter(null); };
                  return (
                    <>
                      {backlog.length > 0 && (
                        <>
                          {/* Search */}
                          <div style={{ padding: '10px 14px 6px' }}>
                            <input
                              value={backlogSearch}
                              onChange={e => setBacklogSearch(e.target.value)}
                              placeholder="Search tasks…"
                              style={{
                                width: '100%', boxSizing: 'border-box', padding: '6px 10px',
                                background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--color-text)',
                                outline: 'none', fontFamily: 'inherit',
                              }}
                            />
                          </div>
                          {/* Status chips + project select */}
                          <div style={{ display: 'flex', gap: 5, padding: '0 14px 6px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button onClick={() => setBacklogStatusFilter('all')} style={filterChipStyle(backlogStatusFilter === 'all')}>All</button>
                            {statuses.map(s => (
                              <button key={s} onClick={() => setBacklogStatusFilter(s)} style={filterChipStyle(backlogStatusFilter === s)}>{STATUS_LABELS[s]}</button>
                            ))}
                            {projects.length > 0 && (
                              <select
                                value={backlogProjectFilter ?? ''}
                                onChange={e => setBacklogProjectFilter(e.target.value || null)}
                                style={{
                                  padding: '3px 8px', fontSize: 11,
                                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                  border: `1px solid ${backlogProjectFilter ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                  background: backlogProjectFilter ? 'var(--color-accent-soft)' : 'transparent',
                                  color: backlogProjectFilter ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                  outline: 'none', fontFamily: 'inherit',
                                }}
                              >
                                <option value="">All projects</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            )}
                            {isFiltered && (
                              <button onClick={clearFilters} style={{ ...filterChipStyle(false), marginLeft: 'auto', color: 'var(--color-text-faint)', fontSize: 10 }}>
                                Clear filters
                              </button>
                            )}
                          </div>
                        </>
                      )}
                      <div style={{ padding: '8px 14px 0' }}>
                        <SectionHeader label="Backlog" done={0} total={filtered.length} />
                        <DndContext
                          sensors={dndSensors}
                          collisionDetection={closestCenter}
                          measuring={DND_MEASURING}
                          onDragStart={dragGuard.onDragStart}
                          onDragCancel={dragGuard.onDragSettled}
                          onDragEnd={(event) => {
                            dragGuard.onDragSettled();
                            const next = reorderedIdsFromDrag(filtered.map(t => t.id), event);
                            // Dropping inside a filtered view only re-slots the
                            // rows on screen; reorderSubset keeps the hidden
                            // ones anchored where they already were.
                            if (next) onReorderBacklog(reorderSubset(backlog.map(t => t.id), next));
                          }}
                        >
                          <SortableContext items={filtered.map(t => t.id)} strategy={verticalListSortingStrategy}>
                            {filtered.map((task) => {
                              const proj = projectById(task.projectId);
                              return (
                                <SortableBacklogRow
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
                          </SortableContext>
                        </DndContext>
                        {backlog.length > 0 && filtered.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--color-text-faint)', textAlign: 'center', padding: '12px 0' }}>
                            No tasks match your filters.
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}

                {/* Recurring templates section */}
                {recurringTemplates.length > 0 && (
                  <div style={{ padding: '8px 14px 0' }}>
                    <button
                      onClick={() => setRecurringCollapsed(v => !v)}
                      style={{ display: 'flex', alignItems: 'center', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, gap: 6, marginBottom: 6 }}
                    >
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', flex: 1, textAlign: 'left' }}>
                        Recurring
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-faint)', fontFamily: 'var(--font-mono)' }}>{recurringTemplates.length}</span>
                      <span style={{ fontSize: 10, color: 'var(--color-text-faint)', marginLeft: 4 }}>{recurringCollapsed ? '▼' : '▲'}</span>
                    </button>
                    {!recurringCollapsed && recurringTemplates.map(task => (
                      <RecurringTemplateRow
                        key={task.id}
                        task={task}
                        onSelect={() => onSelectTask(task)}
                      />
                    ))}
                  </div>
                )}

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
                weekStart={weekStart}
                workDays={workDays}
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

// One-click "create a detection rule for the current page". Offers a domain
// pattern and (when the URL has a path) a narrower domain+path pattern.
function DetectionRuleModal({ patterns, onAdd, onClose }: {
  patterns: { host: string; domain: string; domainPath: string | null; pathLabel: string | null };
  onAdd: (name: string, urlPattern: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const optBtn: React.CSSProperties = {
    padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
    color: 'var(--color-text)', textAlign: 'left', fontFamily: 'inherit',
    display: 'flex', flexDirection: 'column', gap: 2,
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--color-bg)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)', padding: '16px 14px', width: 256,
        boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--color-text)' }}>
          Detect tasks on this site
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Add a rule so pages here can be turned into tasks. Pick how broad it should match.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={() => onAdd(patterns.host, patterns.domain)} style={{ ...optBtn, borderColor: 'var(--color-accent)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-accent)' }}>Whole site</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{patterns.host}</span>
          </button>
          {patterns.domainPath && patterns.pathLabel && (
            <button onClick={() => onAdd(patterns.pathLabel!, patterns.domainPath!)} style={optBtn}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>This section</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>{patterns.pathLabel}</span>
            </button>
          )}
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
  habits, habitCounters, habitDone, weekStart, timezone, onCounterChange, onToggle, onReorder,
}: {
  habits: HabitDef[];
  habitCounters: Record<string, number>;
  habitDone: Record<string, boolean>;
  weekStart: number;
  timezone: string;
  onCounterChange: (id: string, delta: number) => void;
  onToggle: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragGuard = useDragResizeGuard();
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={DND_MEASURING}
          onDragStart={dragGuard.onDragStart}
          onDragCancel={dragGuard.onDragSettled}
          onDragEnd={(event) => {
            dragGuard.onDragSettled();
            const next = reorderedIdsFromDrag(habits.map(h => h.id), event);
            if (next) onReorder(next);
          }}
        >
        <SortableContext items={habits.map(h => h.id)} strategy={verticalListSortingStrategy}>
        {habits.map((habit, idx) => {
          const count = habitCounters[habit.id] ?? 0;
          const checked = habitDone[habit.id] ?? false;
          const isDone = habit.kind === 'boolean' ? checked : count >= (habit.goal ?? 1);
          return (
            <SortableHabitRow
              key={habit.id}
              id={habit.id}
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
                      onClick={() => onCounterChange(habit.id, -(habit.timeUnit ? (habit.unitAmount || 60) : 1))}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >−</button>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, minWidth: habit.timeUnit ? 52 : 28, textAlign: 'center' }}>
                      {habit.timeUnit
                        ? <>{fmtHabitTime(count)}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{fmtHabitTime(habit.goal ?? 0)}</span></>
                        : <>{count}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{habit.goal}</span></>}
                    </span>
                    <button
                      onClick={() => onCounterChange(habit.id, habit.timeUnit ? (habit.unitAmount || 60) : 1)}
                      style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >+</button>
                  </div>
                  {!habit.timeUnit && habit.unit && habit.unitAmount && (
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
            </SortableHabitRow>
          );
        })}
        </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

// Habit rows carry their own row chrome (separator border, done-state tint), so
// unlike the task rows the sortable node *is* the row and the grip sits inside
// it rather than in a gutter alongside.
function SortableHabitRow({ id, style, children }: {
  id: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, ...dragStyle(CSS.Transform.toString(transform), transition, isDragging) }}
      {...attributes}
      {...listeners}
    >
      {children}
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
  focusSeconds = 25 * 60,
}: {
  task: SelectedTask;
  project?: Project | undefined;
  workspaceBadge?: Workspace | undefined;
  anchor: { top: number; left: number; width: number };
  focusSeconds?: number | undefined;
}) {
  const timeStr = fmtTotalTime(task.timeLogs);
  const totalPomoSecs = task.timeLogs?.filter(l => l.mode === 'pomodoro').reduce((s, l) => s + l.durationSeconds, 0) ?? 0;
  const pomoCount = focusSeconds > 0 ? Math.round(totalPomoSecs / focusSeconds) : 0;
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

// Applied to the whole row. There is no visible grip: a row is picked up by
// dragging it anywhere, and PointerSensor's distance constraint is what keeps
// that from swallowing the click that opens the task.
//
// userSelect:'none' is the part that makes dragging actually feel like
// dragging. A row is mostly text, and PointerSensor does not preventDefault on
// mousedown, so without this a press-and-drag starts a native text selection:
// the row stays put, the title highlights blue, and the gesture reads as
// "reordering is broken". Synthetic pointer events never reproduce it, which is
// why it survived a pass of automated checking.
//
// touchAction:'none' is the same story for touch and pen input, where the
// browser would otherwise claim the vertical drag as a scroll of .scroll-area
// before dnd-kit sees it.
// Chrome's browser-action popup emits spurious `resize` events — three of them
// during a single drag, with innerWidth/innerHeight identical (360x600) before
// and after, so nothing has actually resized. dnd-kit registers
// `window.resize -> handleCancel` for the lifetime of a drag, so each of those
// phantom events cancelled the drag a few pixels in. Its own live region said
// it out loud: "Dragging was cancelled."
//
// This is why reordering worked everywhere it was tested except the one place
// that matters: the popup HTML in a tab never fires them.
//
// The listener below is registered at mount, so it precedes dnd-kit's (added
// when a drag starts) and wins the registration-order race at the event target,
// letting stopImmediatePropagation keep the cancel handler from running. It
// only swallows while a drag is in flight; a genuine resize outside one is left
// alone.
function useDragResizeGuard() {
  const dragging = useRef(false);
  useEffect(() => {
    const swallow = (e: Event) => { if (dragging.current) e.stopImmediatePropagation(); };
    window.addEventListener('resize', swallow, true);
    return () => window.removeEventListener('resize', swallow, true);
  }, []);
  return {
    onDragStart: () => { dragging.current = true; },
    onDragSettled: () => { dragging.current = false; },
  };
}

// Shared by every DndContext here.
//
// collisionDetection: dnd-kit defaults to rectIntersection, which only reports
// a drop target when the dragged rect genuinely overlaps it. That makes drops
// fail outright whenever pointer coordinates and measured rects disagree —
// which is what happens when the popup is rendered at a browser zoom above
// 100%: the row lifts and follows the cursor, nothing else shifts, and the
// drop is silently discarded because `over` was never set. closestCenter just
// picks the nearest droppable centre, so a small coordinate skew costs
// accuracy rather than the whole interaction.
//
// measuring Always: re-measure droppables during the drag instead of once at
// the start, so a list that reflows mid-drag (or a scroll container that
// moves) doesn't leave dnd-kit working from stale rects.
const DND_MEASURING = { droppable: { strategy: MeasuringStrategy.Always } } as const;

function dragStyle(transform: string | null | undefined, transition: string | undefined, isDragging: boolean): React.CSSProperties {
  return {
    transform: transform ?? undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : undefined,
  };
}

// Shared by every sortable list here: translate a dnd-kit drop into the new
// order of `ids`, or null when the drop was a no-op.
function reorderedIdsFromDrag(ids: string[], event: DragEndEvent): string[] | null {
  const { active, over } = event;
  if (!over || active.id === over.id) return null;
  const oldIdx = ids.indexOf(active.id as string);
  const newIdx = ids.indexOf(over.id as string);
  if (oldIdx < 0 || newIdx < 0) return null;
  return arrayMove(ids, oldIdx, newIdx);
}

// The landing strip at the end of each Today section, and the only drop target
// a section has while it is empty — hence `empty`, which grows it from a 4px
// seam into something a task can actually be dropped onto. Without it, moving
// the first task into an empty Priorities was a 4px-tall aim.
function DroppableArea({ id, empty = false, label }: { id: string; empty?: boolean; label?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  if (!empty) {
    return (
      <div
        ref={setNodeRef}
        style={{ height: 4, borderRadius: 4, transition: 'background 0.15s', background: isOver ? 'var(--color-accent)' : 'transparent', margin: '0 2px' }}
      />
    );
  }
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 38, margin: '0 2px 4px', padding: '0 8px',
        borderRadius: 'var(--radius-md)',
        border: `1px dashed ${isOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
        background: isOver ? 'var(--color-accent-soft)' : 'transparent',
        transition: 'background 0.15s, border-color 0.15s',
        fontSize: 11, color: isOver ? 'var(--color-accent)' : 'var(--color-text-faint)',
      }}
    >
      {label ?? 'Drop a task here'}
    </div>
  );
}

function SortableTaskRow(props: TaskRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      style={dragStyle(CSS.Transform.toString(transform), transition, isDragging)}
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
  project?: Project | undefined;
  workspaceBadge?: Workspace | undefined;
  isActiveTask: boolean;
  timerRunning: boolean;
  timerHasTask: boolean;
  focusSeconds: number;
  onSelect: () => void;
  onPlay: () => void;
  onDone: () => void;
  onDetach: () => void;
  onStatusChange: (status: TaskStatus) => void;
}

function TaskRow({ index, task, project, workspaceBadge, isActiveTask, timerRunning, timerHasTask, focusSeconds, onSelect, onPlay, onDone, onDetach, onStatusChange }: TaskRowProps) {
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

      {(() => {
        const isWip = task.status === 'in_progress' && !isActiveTask;
        const isDelayed = task.status === 'delayed';
        const btnColor = isDone ? 'var(--color-success)' : isWip ? '#E6B800' : isDelayed ? '#7B5DB4' : 'var(--color-accent)';
        return index !== undefined ? (
          <button
            onClick={(e) => { e.stopPropagation(); setShowStatusPicker(v => !v); }}
            style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, background: btnColor, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {isDone ? '✓' : index}
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setShowStatusPicker(v => !v); }}
            style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: `1.5px solid ${isDone || isWip || isDelayed ? btnColor : 'var(--color-border-strong)'}`, background: isDone ? btnColor : 'transparent', color: '#fff', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
          >
            {isDone ? '✓' : ''}
          </button>
        );
      })()}
      {tooltipAnchor && <TaskTooltip task={task} project={project} workspaceBadge={workspaceBadge} anchor={tooltipAnchor} focusSeconds={focusSeconds} />}
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
          {task.recurrence && (
            <span title={formatRecurrenceLabel(task.recurrence)} style={{ fontSize: 10, color: 'var(--color-info)', marginRight: 4, verticalAlign: 'middle' }}>↺</span>
          )}
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

interface BacklogRowProps {
  task: SelectedTask;
  project?: Project | undefined;
  isInPriorities: boolean;
  isInTasks: boolean;
  prioritiesFull: boolean;
  onAddToPriorities: () => void;
  onAddToTasks: () => void;
  onRemove: () => void;
  onSelect: () => void;
}

function SortableBacklogRow(props: BacklogRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.task.id });
  return (
    <div
      ref={setNodeRef}
      style={dragStyle(CSS.Transform.toString(transform), transition, isDragging)}
      {...attributes}
      {...listeners}
    >
      <BacklogRow {...props} />
    </div>
  );
}

function BacklogRow({ task, project, isInPriorities, isInTasks, prioritiesFull, onAddToPriorities, onAddToTasks, onRemove, onSelect }: BacklogRowProps) {
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
          {task.recurrence && (
            <span title={`Recurring template`} style={{ fontSize: 10, color: 'var(--color-info)', marginRight: 4, verticalAlign: 'middle' }}>↺</span>
          )}
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

function RecurringTemplateRow({ task, onSelect }: { task: SelectedTask; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 0',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--color-info)', flexShrink: 0 }}>↺</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.title || <span style={{ fontStyle: 'italic', color: 'var(--color-text-faint)' }}>(untitled)</span>}
        </div>
        {task.recurrence && (
          <div style={{ fontSize: 11, color: 'var(--color-text-faint)', marginTop: 1 }}>
            {formatRecurrenceLabel(task.recurrence)}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: 'var(--color-text-faint)', flexShrink: 0 }}>›</span>
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
  workspace?: Workspace | undefined;
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
                {workspace.name[0]?.toUpperCase() ?? ''} {workspace.name}
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
  const [logH, setLogH] = useState(meeting.loggedMinutes ? String(Math.floor(meeting.loggedMinutes / 60)) : '');
  const [logM, setLogM] = useState(meeting.loggedMinutes ? String(meeting.loggedMinutes % 60) : '');

  // Re-sync the inputs when loggedMinutes changes externally (e.g. the stopwatch
  // finishes while this panel is open). Otherwise the stale empty inputs would
  // compute total = 0 on the next "Log" click and silently wipe tracked time.
  useEffect(() => {
    const lm = meeting.loggedMinutes ?? 0;
    setLogH(lm ? String(Math.floor(lm / 60)) : '');
    setLogM(lm ? String(lm % 60) : '');
  }, [meeting.loggedMinutes]);

  const handleLogTime = () => {
    const total = (parseInt(logH || '0', 10) || 0) * 60 + (parseInt(logM || '0', 10) || 0);
    onUpdate(total > 0 ? { logged: true, loggedMinutes: total } : { logged: false, loggedMinutes: 0 });
  };

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

      {/* Logged attendance time — manual, works for past meetings too */}
      <div style={{ padding: '12px 14px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6 }}>Logged time</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} value={logH} onChange={e => setLogH(e.target.value)} placeholder="0"
            style={{ width: 48, boxSizing: 'border-box', padding: '6px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>h</span>
          <input
            type="number" min={0} value={logM} onChange={e => setLogM(e.target.value)} placeholder="0"
            style={{ width: 48, boxSizing: 'border-box', padding: '6px 8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--color-text)', outline: 'none', fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>m</span>
          <button
            onClick={handleLogTime}
            style={{ padding: '6px 12px', background: 'var(--color-accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Log
          </button>
          {meeting.logged && (meeting.loggedMinutes ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 600 }}>✓ logged</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4 }}>
          Record how long you actually attended — works after the meeting has passed too.
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
  primaryLabel?: string | undefined;
  secondaryLabel?: string | undefined;
  onPrimary?: (() => void) | undefined;
  onSecondary?: (() => void) | undefined;
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

function getEffectiveDate(task: { updatedAt: string; timeLogs?: { startedAt: string }[] | undefined }): string {
  if (task.timeLogs && task.timeLogs.length > 0) {
    return task.timeLogs.reduce((max, l) => l.startedAt > max ? l.startedAt : max, '').slice(0, 10);
  }
  return task.updatedAt.slice(0, 10);
}

type HistoryDateFilter = 'week' | 'month' | 'custom';

function weekStartDate(timezone: string, weekStart: number): string {
  // weekStart: 0=Mon…6=Sun. Returns YYYY-MM-DD of the most recent weekStart day.
  const todayDow = (new Date(localDate(timezone) + 'T12:00:00').getDay() + 6) % 7;
  const daysSince = (todayDow - weekStart + 7) % 7;
  return localDate(timezone, -daysSince);
}

function TaskHistoryView({ activeWsId, projects, timezone, weekStart, workDays, onSelectTask, onSelectMeeting }: {
  activeWsId: string;
  projects: Project[];
  timezone: string;
  weekStart: number;
  workDays: number[];
  onSelectTask: (task: SelectedTask) => void;
  onSelectMeeting?: (m: CalendarMeeting) => void;
}) {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<HistoryDateFilter>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(() => localDate(timezone));
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  const todayStr = localDate(timezone);
  const weekCutoff = weekStartDate(timezone, weekStart);
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

function HabitHistoryView({ habits, timezone, weekStart }: {
  habits: HabitDef[];
  timezone: string;
  weekStart: number;
}) {
  const [dateFilter, setDateFilter] = useState<HabitHistoryDateFilter>('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(() => localDate(timezone));

  const todayStr = localDate(timezone);
  const weekCutoff = weekStartDate(timezone, weekStart);
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

  // For each active date, show every habit that was active and scheduled that
  // day (counter and boolean), synthesising a "missed" row when there's no
  // record. Closed habits (date past endDate) and off-schedule weekdays are
  // skipped so they don't appear as missed.
  type DisplayRecord = HabitHistoryRow & { _synthetic?: boolean };
  const groups = new Map<string, DisplayRecord[]>();
  for (const date of activeDates) {
    const dow = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
    const entries: DisplayRecord[] = [];
    for (const habit of habits) {
      if (habit.endDate && date > habit.endDate) continue;
      if (habit.days.length > 0 && !habit.days.includes(dow)) continue;
      const record = allRecords.find(r => r.habitId === habit.id && r.date === date);
      if (record) { entries.push(record); continue; }
      // Don't fabricate "missed" days before the habit existed. createdAt is a UTC
      // instant; compare its local calendar date (in the user's tz) against the
      // local `date`, otherwise late-evening creations in UTC− zones skip a day.
      if (habit.createdAt && date < new Date(habit.createdAt).toLocaleDateString('en-CA', { timeZone: timezone })) continue;
      entries.push({ habitId: habit.id, date, done: false, count: 0, updatedAt: '', _synthetic: true });
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
                        {habit.timeUnit
                          ? `${fmtHabitTime(count)}${goalUsed != null ? ` / ${fmtHabitTime(goalUsed)}` : ''}`
                          : `${count}${goalUsed != null ? ` / ${goalUsed}` : ''}${habit.unit ? ` ${habit.unit}` : ''}`}
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

function MenuRow({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', width: '100%', textAlign: 'left',
        background: 'none', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12, color: danger ? '#f87171' : 'var(--color-text)',
      }}
    >
      <span style={{ width: 14, textAlign: 'center', fontSize: 11, color: danger ? '#f87171' : 'var(--color-text-muted)', flexShrink: 0 }}>{icon}</span>
      {label}
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

// pastStreak = consecutive scheduled days completed up to (not including)
// today, matching the flame streakLabel's existing "don't count today until
// it's actually done" semantics. daysDone adds today back in once it's
// done — used for the 21-day challenge counter, which should tick up the
// moment today is completed rather than waiting until tomorrow.
function computeHabitStreak(
  habit: Pick<HabitDef, 'kind' | 'goal' | 'days'>,
  historyByDate: Map<string, HabitHistoryRow>,
  timezone: string,
): { pastStreak: number; doneToday: boolean; daysDone: number } {
  const isHabitDone = (row: HabitHistoryRow | undefined): boolean => {
    if (!row) return false;
    return habit.kind === 'counter' ? (row.count ?? 0) >= (habit.goal ?? 1) : (row.done ?? false);
  };

  const today = localDate(timezone);
  const todayDow = (new Date(today + 'T12:00:00').getDay() + 6) % 7;
  const scheduledToday = habit.days.length === 0 || habit.days.includes(todayDow);
  const doneToday = scheduledToday && isHabitDone(historyByDate.get(today));

  // 3650 days (10 years) rather than 365 — a challenge longer than a year is
  // unusual but not implausible for a habit tracker, and this is a handful
  // of cheap Map lookups either way, not worth capping tighter.
  let pastStreak = 0;
  for (let i = 1; i < 3650; i++) {
    const dateStr = localDate(timezone, -i);
    const dow = (new Date(dateStr + 'T12:00:00').getDay() + 6) % 7;
    if (habit.days.length > 0 && !habit.days.includes(dow)) continue;
    if (isHabitDone(historyByDate.get(dateStr))) pastStreak++;
    else break;
  }

  return { pastStreak, doneToday, daysDone: pastStreak + (doneToday ? 1 : 0) };
}

export interface ChallengeView {
  state: ChallengeState;
  progress: ChallengeProgress;
}

export interface ChallengeActions {
  onKeepGoing: (habitId: string) => void;
  onStartOver: (habitId: string) => void;
  onKeepAsHabit: (habitId: string) => void;
}

function ChallengeAction({ label, hint, tone, onClick }: {
  label: string;
  hint?: string;
  tone: 'primary' | 'quiet';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: '6px 8px', cursor: 'pointer',
        borderRadius: 'var(--radius-sm)', lineHeight: 1.3,
        border: `1px solid ${tone === 'primary' ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: tone === 'primary' ? 'var(--color-accent)' : 'transparent',
        color: tone === 'primary' ? '#fff' : 'var(--color-text-muted)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
      {hint && (
        <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.85, marginTop: 1 }}>{hint}</div>
      )}
    </button>
  );
}

/** "Tuesday", or "Tuesday and Wednesday", or "3 days". */
function missedDaysLabel(dates: string[]): string {
  const dayName = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  if (dates.length === 1) return dayName(dates[0]!);
  if (dates.length === 2) return `${dayName(dates[0]!)} and ${dayName(dates[1]!)}`;
  return `${dates.length} days`;
}

function ChallengeCard({ habit, view, actions }: {
  habit: HabitDef;
  view: ChallengeView;
  actions?: ChallengeActions;
}) {
  const { state, progress } = view;
  const length = state.lengthDays;
  const clamped = challengeDaysShown(progress.daysDone, length);
  const complete = progress.complete;
  const needsDecision = challengeNeedsDecision(progress);
  const canKeepGoing = challengeCanKeepGoing(state, progress.missedDays);
  const skipsLeft = challengeSkipsLeft(state);
  const earnsBadge = challengeEarnsBadge(state);

  // When the habit isn't daily, the run spans more calendar than its name
  // suggests — 21 weekdays is four weeks and a day. Showing the date it lands
  // on is the only way the count stops being misleading, and it moves as skips
  // are spent, so it is derived here rather than stored.
  const scheduledOn = (date: string): boolean =>
    habit.days.length === 0 || habit.days.includes((new Date(date + 'T12:00:00').getDay() + 6) % 7);
  const projectedEnd = complete
    ? null
    : challengeProjectedEnd(state.startedAt, length, scheduledOn, state.skippedDays.length);

  const accent = complete
    ? 'var(--color-success)'
    : needsDecision ? 'var(--color-border-strong)' : 'var(--color-accent)';

  return (
    <div style={{
      background: complete ? 'var(--color-success-bg)' : 'var(--color-accent-bg, rgba(200,85,61,0.08))',
      border: `1px solid ${accent}`,
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
      marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <HabitIcon kind={habit.icon} size={16} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{habit.name}</span>
        {complete && <span style={{ fontSize: 12 }} title="Challenge complete">🏆</span>}
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
        {needsDecision
          ? `You missed ${missedDaysLabel(progress.missedDays)}.`
          : challengeProgressLabel(clamped, length)}
      </div>

      <div style={{ height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
        <div style={{
          width: `${(clamped / length) * 100}%`, height: '100%',
          background: complete ? 'var(--color-success)' : 'var(--color-accent)',
        }} />
      </div>

      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', marginTop: 6 }}>
        {complete && state.completedAt
          ? `Finished ${new Date(state.completedAt + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              + (state.skippedDays.length > 0 ? ` · ${state.skippedDays.length} skipped` : '')
          : challengeStreakLabel(clamped, length)}
      </div>

      {projectedEnd && !needsDecision && (
        <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 3 }}>
          {habit.days.length === 0 ? 'Finishes' : 'Finishes around'} {fmtShortDate(projectedEnd)}
        </div>
      )}

      {/* Completed: the run is over, so offer a way out of it. Without this a
          finished card sits in Today forever with nothing to do about it. */}
      {complete && actions && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <ChallengeAction tone="primary" label="Go again" onClick={() => actions.onStartOver(habit.id)} />
          <ChallengeAction tone="quiet" label="Keep as habit" onClick={() => actions.onKeepAsHabit(habit.id)} />
        </div>
      )}

      {/* Broken: never silent, and the cost of each option is on the button.
          Spending a skip saves the run but forfeits the badge, so finding that
          out at day 21 would be the worst version of this. */}
      {!complete && needsDecision && actions && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {canKeepGoing ? (
            <ChallengeAction
              tone="primary"
              label="Keep going"
              hint={earnsBadge
                ? `${skipsLeft} skip${skipsLeft === 1 ? '' : 's'} left · gives up the badge`
                : `${skipsLeft} skip${skipsLeft === 1 ? '' : 's'} left`}
              onClick={() => actions.onKeepGoing(habit.id)}
            />
          ) : (
            <div style={{ flex: 1, fontSize: 10, color: 'var(--color-text-faint)', alignSelf: 'center', lineHeight: 1.4 }}>
              No skips left — this run has to start over.
            </div>
          )}
          <ChallengeAction
            tone={canKeepGoing ? 'quiet' : 'primary'}
            label="Start over"
            {...(canKeepGoing && earnsBadge ? { hint: 'keeps the badge in play' } : {})}
            onClick={() => actions.onStartOver(habit.id)}
          />
        </div>
      )}
    </div>
  );
}

// Challenges are a distinct thing from the habit list — a fixed-length run with
// an end — so they get their own titled block rather than floating above the
// Habits header unlabelled. Rendered in both the Habits tab and (when pinned)
// Today, hence the shared component.
function ChallengesSection({ habits, views, actions, showInToday, onToggleShowInToday }: {
  habits: HabitDef[];
  views: Map<string, ChallengeView>;
  /** Omitted on Today, where the cards are a read-only summary — the decisions
   *  live on the Habits tab so one stray tap can't end a 20-day run. */
  actions?: ChallengeActions;
  showInToday?: boolean;
  onToggleShowInToday?: () => void;
}) {
  if (habits.length === 0) return null;
  const done = habits.filter(h => views.get(h.id)?.progress.complete).length;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          Challenges {done > 0 && <span style={{ color: 'var(--color-success)' }}>· {done} done</span>}
        </span>
        {onToggleShowInToday && (
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
        )}
      </div>
      {habits.map(h => {
        const view = views.get(h.id);
        return view ? (
          <ChallengeCard key={h.id} habit={h} view={view} {...(actions ? { actions } : {})} />
        ) : null;
      })}
    </div>
  );
}

const TIER_STYLE: Record<AchievementTier, { ring: string; glow: string; label: string }> = {
  bronze:   { ring: '#B08D57', glow: 'rgba(176,141,87,0.25)',  label: 'Bronze' },
  silver:   { ring: '#A8B0B8', glow: 'rgba(168,176,184,0.28)', label: 'Silver' },
  gold:     { ring: '#D4AF37', glow: 'rgba(212,175,55,0.30)',  label: 'Gold' },
  platinum: { ring: '#7FD3E0', glow: 'rgba(127,211,224,0.32)', label: 'Platinum' },
};

/**
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Only earned badges are shown. A grid of locked placeholders turns the tab
 * into a checklist of things you haven't done, which is the opposite of what
 * finishing a 21-day run should feel like.
 */
function AchievementBadge({ kind, count }: { kind: string; count: number }) {
  const tier = achievementTier(count);
  if (!tier) return null;
  const style = TIER_STYLE[tier];
  const meta = badgeKind(kind);
  const next = nextAchievementTier(count);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          title={`${style.label} · ${count} earned`}
          style={{
            width: 52, height: 52, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24,
            border: `2px solid ${style.ring}`,
            background: `radial-gradient(circle at 50% 35%, ${style.glow}, transparent 70%)`,
            boxShadow: `0 0 10px ${style.glow}`,
          }}
        >
          🏆
        </div>
        {count > 1 && (
          <span style={{
            position: 'absolute', bottom: -2, right: -4,
            padding: '1px 5px', borderRadius: 8,
            fontSize: 10, fontWeight: 700, lineHeight: 1.4,
            background: style.ring, color: '#fff',
            border: '1px solid var(--color-bg)',
          }}>
            x{count}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{style.label} {meta.noun}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{meta.describe(count)}</div>
        {next && (
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 2 }}>
            {next.remaining} more for {TIER_STYLE[next.tier].label}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Every kind present is rendered, not a hard-coded one: `kind` is free text on
 * the wire so a new badge ships without a migration, and a medal awarded by a
 * newer client must not be invisible here.
 *
 * Only earned badges are shown. A grid of locked placeholders turns the tab
 * into a checklist of things you haven't done, which is the opposite of what
 * finishing a 21-day run should feel like.
 */
function AchievementsSection({ achievements }: { achievements: AchievementRow[] }) {
  const counts = new Map<string, number>();
  for (const a of achievements) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  if (counts.size === 0) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 8 }}>
        Achievements
      </div>
      {[...counts].map(([kind, count]) => (
        <AchievementBadge key={kind} kind={kind} count={count} />
      ))}
    </div>
  );
}

interface HabitsContentProps {
  habits: HabitDef[];
  habitCounters: Record<string, number>;
  habitDone: Record<string, boolean>;
  showInToday: boolean;
  weekStart: number;
  timezone: string;
  onCounterChange: (id: string, delta: number) => void;
  onToggle: (id: string) => void;
  onToggleShowInToday: () => void;
  onAddHabit: () => void;
  onEditHabit: (habit: HabitDef) => void;
  onDeleteHabit: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  showChallengesInToday: boolean;
  onToggleShowChallengesInToday: () => void;
  challengeViews: Map<string, ChallengeView>;
  challengeActions: ChallengeActions;
  achievements: AchievementRow[];
  /** Per-habit streak/challenge progress, computed once in HomeState. */
  streaks: Map<string, { pastStreak: number; doneToday: boolean; daysDone: number }>;
}

function HabitsContent({ habits, habitCounters, habitDone, showInToday, weekStart, timezone, onCounterChange, onToggle, onToggleShowInToday, onAddHabit, onEditHabit, onDeleteHabit, onReorder, showChallengesInToday, onToggleShowChallengesInToday, streaks, challengeViews, challengeActions, achievements }: HabitsContentProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragGuard = useDragResizeGuard();
  const today = new Date();
  const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Habits past their end date are "closed": hidden from the list (and progress)
  // by default, revealed behind a "Show closed" link. Same filter the Today tab uses.
  const todayStr = localDate(timezone);
  const activeHabits = habits.filter(h => !h.endDate || todayStr <= h.endDate);
  const closedHabits = habits.filter(h => h.endDate && todayStr > h.endDate);
  const [showClosed, setShowClosed] = useState(false);

  // Streaks arrive from HomeState, which needs them for Today's challenge cards
  // too — this used to run its own full-history query.
  const streaksById = streaks;
  // Unlike the habit list, challenges include closed ones: a finished 21-day run
  // is a result, and hiding it the day after it ends is what you least want.
  const challengeHabits = habits.filter(h => (h.challengeLengthDays ?? 0) > 0);

  const doneCount = activeHabits.filter(h =>
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
            {doneCount} of {activeHabits.length} habits done
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1, color: 'var(--color-success)' }}>
          {doneCount}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-text-muted)' }}>/{activeHabits.length}</span>
        </div>
      </div>

      <AchievementsSection achievements={achievements} />

      <ChallengesSection
        habits={challengeHabits}
        views={challengeViews}
        actions={challengeActions}
        showInToday={showChallengesInToday}
        onToggleShowInToday={onToggleShowChallengesInToday}
      />

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={DND_MEASURING}
          onDragStart={dragGuard.onDragStart}
          onDragCancel={dragGuard.onDragSettled}
          onDragEnd={(event) => {
            dragGuard.onDragSettled();
            const next = reorderedIdsFromDrag(activeHabits.map(h => h.id), event);
            // Closed habits are rendered in their own section below and are not
            // part of this context, so the drop only ever reorders active ones.
            if (next) onReorder(next);
          }}
        >
          <SortableContext items={activeHabits.map(h => h.id)} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeHabits.map(habit => {
                const isDone = habit.kind === 'boolean'
                  ? (habitDone[habit.id] ?? false)
                  : (habitCounters[habit.id] ?? 0) >= (habit.goal ?? 1);
                return (
                  <SortableHabitCard key={habit.id} id={habit.id}>
                    <HabitRow
                      habit={habit}
                      count={habitCounters[habit.id] ?? 0}
                      checked={habitDone[habit.id] ?? false}
                      isDone={isDone}
                      streakLabel={habitStreakLabel(streaksById.get(habit.id)?.pastStreak ?? 0)}
                      onCounterChange={(delta) => onCounterChange(habit.id, delta)}
                      onToggle={() => onToggle(habit.id)}
                      onEdit={() => onEditHabit(habit)}
                      onDelete={() => onDeleteHabit(habit.id)}
                    />
                  </SortableHabitCard>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {closedHabits.length > 0 && (
          <button
            onClick={() => setShowClosed(v => !v)}
            style={{
              width: '100%', marginTop: -2, padding: '6px 0', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center',
            }}
          >
            {showClosed ? 'Hide closed' : `Show closed (${closedHabits.length})`}
          </button>
        )}

        {showClosed && closedHabits.map(habit => (
          <HabitRow
            key={habit.id}
            habit={habit}
            count={0}
            checked={false}
            isDone={false}
            readOnly
            streakLabel={habitStreakLabel(streaksById.get(habit.id)?.pastStreak ?? 0)}
            onCounterChange={() => {}}
            onToggle={() => {}}
            onEdit={() => onEditHabit(habit)}
            onDelete={() => onDeleteHabit(habit.id)}
          />
        ))}
      </div>

      <WeekStrip habits={activeHabits} weekStart={weekStart} timezone={timezone} />
    </div>
  );
}

// The Habits tab renders habits as standalone cards, so the grip lives in a
// gutter beside the card (as with tasks) rather than inside its grid.
function SortableHabitCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={dragStyle(CSS.Transform.toString(transform), transition, isDragging)}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function HabitRow({ habit, count, checked, isDone, readOnly, streakLabel, onCounterChange, onToggle, onEdit, onDelete }: {
  habit: HabitDef;
  count: number;
  checked: boolean;
  isDone: boolean;
  readOnly?: boolean;
  streakLabel: string;
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
      background: !readOnly && isDone ? 'var(--color-success-bg)' : 'var(--color-surface)',
      border: `1px solid ${!readOnly && isDone ? 'var(--color-success-bg)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-md)',
      opacity: readOnly ? 0.6 : 1,
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
          {streakLabel}
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
          {readOnly && habit.endDate && (
            <span style={{ marginLeft: 6, color: 'var(--color-text-faint)' }}>
              · Closed {habit.endDate.slice(8, 10)}/{habit.endDate.slice(5, 7)}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {readOnly ? null : habit.kind === 'counter' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <button onClick={() => onCounterChange(-(habit.timeUnit ? (habit.unitAmount || 60) : 1))} style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>−</button>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14, minWidth: habit.timeUnit ? 60 : 32, textAlign: 'center' }}>
                {habit.timeUnit
                  ? <>{fmtHabitTime(count)}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{fmtHabitTime(habit.goal ?? 0)}</span></>
                  : <>{count}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/{habit.goal}</span></>}
              </div>
              <button onClick={() => onCounterChange(habit.timeUnit ? (habit.unitAmount || 60) : 1)} style={{ width: 26, height: 26, borderRadius: 5, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 600 }}>+</button>
            </div>
            {!habit.timeUnit && habit.unit && habit.unitAmount && (
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

function WeekStrip({ habits, weekStart, timezone }: { habits: HabitDef[]; weekStart: number; timezone: string }) {
  const today = localDate(timezone);
  const todayDow = (new Date(today + 'T12:00:00').getDay() + 6) % 7; // 0=Mon…6=Sun
  const daysSinceStart = (todayDow - weekStart + 7) % 7;

  // Build the 7 dates of this week starting from weekStart, only up to today
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDates.push(localDate(timezone, i - daysSinceStart));
  }

  const cutoff = weekDates[0]!;
  const habitIds = new Set(habits.map(h => h.id));

  const records = useLiveQuery(
    () => db.habitHistory.where('date').between(cutoff, today, true, true).toArray(),
    [cutoff, today],
  ) ?? [];

  const recordsByDate = new Map<string, typeof records>();
  for (const r of records) {
    if (!habitIds.has(r.habitId)) continue;
    if (!recordsByDate.has(r.date)) recordsByDate.set(r.date, []);
    recordsByDate.get(r.date)!.push(r);
  }

  const habitMap = new Map(habits.map(h => [h.id, h]));

  const cells = weekDates.map(date => {
    const isFuture = date > today;
    const dayRecords = recordsByDate.get(date) ?? [];
    let completed = 0;
    for (const r of dayRecords) {
      const h = habitMap.get(r.habitId);
      if (!h) continue;
      if (h.kind === 'boolean' && r.done) completed++;
      else if (h.kind === 'counter' && (r.count ?? 0) >= (h.goal ?? 1)) completed++;
    }
    const total = habits.length;
    // 0 = nothing done, 1 = every habit met. Drives the cell's color intensity.
    const ratio = isFuture || total === 0 ? 0 : completed / total;
    return { date, label: WEEK_DAYS[(weekDates.indexOf(date) + weekStart) % 7]!, completed, total, ratio, isToday: date === today, isFuture };
  });

  const totalCompletions = cells.reduce((s, c) => s + c.completed, 0);
  const maxCompletions = cells.filter(c => !c.isFuture).length * habits.length;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>This week</span>
        <span style={{ fontSize: 11, color: 'var(--color-text-faint)' }}>{totalCompletions} / {maxCompletions} completions</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map(({ date, label, completed, ratio, isToday, isFuture }) => {
          // Empty cells stay neutral; the more habits met, the stronger the green.
          // pct scales 20% → 100% so even a single completion reads as a light tint.
          const pct = Math.round(20 + ratio * 80);
          const fill = ratio <= 0
            ? 'var(--color-bg)'
            : `color-mix(in srgb, var(--color-success) ${pct}%, transparent)`;
          const border = ratio <= 0 ? 'var(--color-border)' : fill;
          const textColor = ratio <= 0
            ? 'var(--color-text-muted)'
            : ratio >= 0.5 ? '#fff' : 'var(--color-success)';
          return (
            <div key={date} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase', color: 'var(--color-text-faint)' }}>
                {label}
              </span>
              <div style={{
                width: '100%', aspectRatio: '1', borderRadius: 4,
                background: fill,
                border: `1px solid ${border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
                color: textColor,
                boxShadow: isToday ? '0 0 0 1.5px var(--color-accent)' : 'none',
                opacity: isFuture ? 0.35 : 1,
              }}>
                {!isFuture && completed > 0 ? completed : ''}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Habit time helpers ──────────────────────────────────────────────────────
// Time-unit habits store their goal/value in seconds and render as mm:ss (or
// h:mm:ss for >= 1h).
function fmtHabitTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
// Accepts "mm:ss", "h:mm:ss", or a plain number (interpreted as minutes).
function parseHabitTime(str: string): number {
  const parts = str.split(':').map(p => parseInt(p, 10) || 0);
  // Destructured with defaults because noUncheckedIndexedAccess can't tell
  // that the length checks below already make these indexes safe. The map
  // above already coerces every element to a number, so the defaults only
  // ever apply to positions the checks exclude anyway.
  const [first = 0, second = 0, third = 0] = parts;
  if (parts.length === 3) return first * 3600 + second * 60 + third;
  if (parts.length === 2) return first * 60 + second;
  return first * 60;
}

const PRESET_UNITS = ['ml', 'min', 'pages', 'km', 'steps', 'cal', 'glasses', 'reps'];

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

/** The cautionary strip the habit form uses for anything that blocks a save. */
const FORM_NOTICE_STYLE: React.CSSProperties = {
  fontSize: 10, marginTop: 6, lineHeight: 1.5, padding: '6px 8px',
  color: 'var(--color-accent)', background: 'rgba(200,85,61,0.07)',
  border: '1px solid rgba(200,85,61,0.2)', borderRadius: 'var(--radius-sm)',
};

/** "Mon, Oct 19" — the same shape the challenge card already uses for dates. */
function fmtShortDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00')
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Inclusive span in calendar days, which is how a person counts them. */
function daysBetween(from: string, to: string): number {
  const ms = new Date(to + 'T12:00:00').getTime() - new Date(from + 'T12:00:00').getTime();
  return Math.round(ms / 86400000) + 1;
}

function HabitForm({ initialHabit, today, onSave, onCancel }: {
  initialHabit?: HabitDef;
  /**
   * The user's today, in their configured timezone.
   *
   * Passed in rather than read from the browser: the reconciling effect stamps
   * a new run's start date with this same value, so a form projecting from
   * `new Date()` would disagree with the run it is describing whenever the two
   * fall on different days — and would validate the end date against the wrong
   * finish.
   */
  today: string;
  onSave: (habit: Omit<HabitDef, 'updatedAt'>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialHabit?.name ?? '');
  const [kind, setKind] = useState<HabitKind>(initialHabit?.kind ?? 'boolean');
  const [icon, setIcon] = useState<HabitIconKind>(initialHabit?.icon ?? 'water');
  const [unitMode, setUnitMode] = useState<'none' | 'preset' | 'time' | 'custom'>(
    initialHabit?.timeUnit ? 'time'
      : initialHabit?.unit ? (PRESET_UNITS.includes(initialHabit.unit) ? 'preset' : 'custom')
        : 'none',
  );
  const [unit, setUnit] = useState(initialHabit?.unit ?? '');
  const [unitAmount, setUnitAmount] = useState(initialHabit?.unitAmount?.toString() ?? '');
  // Time habits keep goal/step as mm:ss strings; everything else as plain numbers.
  const [goal, setGoal] = useState(
    initialHabit?.timeUnit ? fmtHabitTime(initialHabit.goal ?? 0) : (initialHabit?.goal?.toString() ?? ''),
  );
  const [timeStep, setTimeStep] = useState(
    initialHabit?.timeUnit ? fmtHabitTime(initialHabit.unitAmount || 60) : '1:00',
  );
  const [endDate, setEndDate] = useState(initialHabit?.endDate ?? '');
  const [isChallenge, setIsChallenge] = useState((initialHabit?.challengeLengthDays ?? 0) > 0);
  const [challengeLengthDays, setChallengeLengthDays] = useState((initialHabit?.challengeLengthDays ?? 21).toString());
  const [selectedDays, setSelectedDays] = useState<number[]>(
    initialHabit ? (initialHabit.days.length === 0 ? [0,1,2,3,4,5,6] : initialHabit.days) : [0,1,2,3,4,5,6]
  );

  const isTime = kind === 'counter' && unitMode === 'time';

  // Stored shape: seven days means "every day" and is kept as an empty array.
  const daysValue = selectedDays.length === 7 ? [] : selectedDays;
  const scheduledOn = (date: string): boolean =>
    daysValue.length === 0 || daysValue.includes((new Date(date + 'T12:00:00').getDay() + 6) % 7);

  const parsedLength = parseInt(challengeLengthDays, 10);
  const lengthIsUsable = isChallenge && !isNaN(parsedLength)
    && parsedLength > 0 && parsedLength <= MAX_CHALLENGE_LENGTH_DAYS;
  const lengthOutOfRange = isChallenge && challengeLengthDays.trim() !== '' && !lengthIsUsable;

  const sameLength = initialHabit?.challengeLengthDays === parsedLength;
  const sameScheduleAsBefore = sameSchedule(initialHabit?.days ?? [], daysValue);

  // Only a run that actually exists can be restarted — a challenge being
  // switched on for the first time has nothing to lose.
  const hasLiveRun = Boolean(initialHabit?.challengeLengthDays && initialHabit?.challengeStartedAt);
  const restartsRun = hasLiveRun && lengthIsUsable && (!sameLength || !sameScheduleAsBefore);

  // A run that survives this edit keeps its own start and the days it has
  // spent. One that is about to be restarted must be projected from today, not
  // from the run it is replacing — otherwise the finish shown here, and the end
  // date validated against it, both belong to a run that is being thrown away.
  const keepsRun = hasLiveRun && lengthIsUsable && !restartsRun;
  const runStart = (keepsRun && initialHabit?.challengeStartedAt) || today;
  const spentSkips = keepsRun ? (initialHabit?.challengeSkippedDays?.length ?? 0) : 0;
  const projectedEnd = lengthIsUsable
    ? challengeProjectedEnd(runStart, parsedLength, scheduledOn, spentSkips)
    : null;
  // No projection means the run cannot be shown to fit inside ten years of
  // lookahead. Treated as a validation failure rather than waved through: a
  // null here used to switch the end-date check off silently, which is the
  // opposite of what an unprojectable run deserves.
  const projectionUnavailable = lengthIsUsable && projectedEnd === null;

  // Counting scheduled days means "21 days" can be twenty-nine of calendar, so
  // say so rather than leaving the user to discover it in week five.
  const spansMoreThanItSays = projectedEnd !== null && daysValue.length > 0;

  // The end date closes the habit, so one that falls before the run can finish
  // makes the challenge unwinnable — the habit stops being tickable while the
  // run keeps accruing missed days the user can no longer answer.
  const endDateCutsChallenge = Boolean(projectedEnd && endDate && endDate < projectedEnd);

  // Finishing exactly on the end date is legal but leaves no room to ever use
  // a skip: "keep going" adds a forgiven day, which pushes the finish past a
  // date after which the habit is read-only. Worth saying, not worth blocking —
  // a user who never skips is fine, and refusing the save would force margin
  // onto people who do not need it.
  // The allowance is the run's total, not a further grant on top of what has
  // been spent — challengeSkipsLeft reads `allowance - spent` — so the latest
  // a run can finish is with `allowance` days forgiven, full stop. Adding the
  // spent ones projected too far and warned about end dates that were fine.
  // The max() only guards a run carrying more spent days than its length now
  // allows, which a length edit on an older client could leave behind.
  const worstCaseSkips = Math.max(spentSkips, challengeSkipAllowance(parsedLength || 1));
  const skipRoom = lengthIsUsable
    ? challengeProjectedEnd(runStart, parsedLength, scheduledOn, worstCaseSkips)
    : null;
  const endDateLeavesNoSkipRoom = Boolean(
    !endDateCutsChallenge && skipRoom && endDate && endDate < skipRoom,
  );

  const [confirmRestart, setConfirmRestart] = useState(false);
  const canSaveHabit = Boolean(name.trim())
    && !endDateCutsChallenge && !projectionUnavailable && !lengthOutOfRange;
  // Reverting the schedule takes the question away again.
  const awaitingRestartConfirm = confirmRestart && restartsRun;

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (endDateCutsChallenge || projectionUnavailable || lengthOutOfRange) return;
    // Restarting is destructive, and silent otherwise: the card would simply
    // read "Day 1" next time it was opened, with no hint that weeks of
    // progress had been dropped by a schedule edit. Confirmed inline rather
    // than with confirm() — a native dialog is used nowhere else in this
    // popup, and it takes focus, which is what closes a popup window.
    if (restartsRun && !confirmRestart) { setConfirmRestart(true); return; }
    const effUnit = (unitMode === 'preset' || unitMode === 'custom') ? unit.trim() : '';
    const hasUnit = effUnit.length > 0;
    const parsedUnitAmount = parseInt(unitAmount, 10);
    const hasUnitAmount = !isTime && hasUnit && !isNaN(parsedUnitAmount) && parsedUnitAmount > 0;
    const parsedChallengeLength = parseInt(challengeLengthDays, 10);
    const hasChallenge = isChallenge && !isNaN(parsedChallengeLength) && parsedChallengeLength > 0;
    // The run survives an edit only when the challenge it belongs to is
    // untouched. Same length, same schedule, still enabled — anything else is
    // a new run.
    //
    // The schedule matters as much as the length, and less obviously: progress
    // is replayed from the start date against the habit's *current* days, so
    // widening Mon–Fri to every day retroactively turns every past weekend
    // into a missed day and breaks a healthy run on the spot. Narrowing it
    // does the reverse and quietly heals a broken one. Either way the run is
    // being judged by a rule it did not run under, so it is a new run.
    const sameScheduleAsBefore = sameSchedule(initialHabit?.days ?? [], daysValue);
    const keepsSameRun = hasChallenge
      && initialHabit?.challengeLengthDays === parsedChallengeLength
      && sameScheduleAsBefore;
    onSave({
      id: initialHabit?.id ?? crypto.randomUUID(),
      createdAt: initialHabit?.createdAt ?? now(),
      name: name.trim(),
      kind,
      icon,
      ...(kind === 'counter'
        ? { goal: (isTime ? parseHabitTime(goal) : parseInt(goal, 10)) || 1 }
        : {}),
      ...(isTime ? { timeUnit: true, unitAmount: parseHabitTime(timeStep) || 60 } : {}),
      ...(hasUnit ? { unit: effUnit } : {}),
      ...(hasUnitAmount ? { unitAmount: parsedUnitAmount } : {}),
      ...(endDate ? { endDate } : {}),
      ...(hasChallenge ? { challengeLengthDays: parsedChallengeLength } : {}),
      // Carried through rather than rebuilt: onSave does a full-replace put, so
      // anything the form doesn't name is erased. sortOrder learned this the
      // hard way (every edit sent the habit to the bottom of the list); the
      // challenge run is the same trap, and losing it would turn a finished
      // 21-day challenge back into a fresh one starting today.
      ...(initialHabit?.sortOrder !== undefined ? { sortOrder: initialHabit.sortOrder } : {}),
      // ...but only while it is still the same run. Turning the challenge off,
      // or changing its length, starts a new one — carrying the old start date,
      // forgiven days and completion into it would make a freshly configured
      // 30-day challenge show up already finished.
      ...(keepsSameRun ? {
        ...(initialHabit?.challengeStartedAt !== undefined ? { challengeStartedAt: initialHabit.challengeStartedAt } : {}),
        ...(initialHabit?.challengeCompletedAt !== undefined ? { challengeCompletedAt: initialHabit.challengeCompletedAt } : {}),
        ...(initialHabit?.challengeSkippedDays !== undefined ? { challengeSkippedDays: initialHabit.challengeSkippedDays } : {}),
      } : {}),
      streakLabel: initialHabit?.streakLabel ?? 'New habit',
      days: selectedDays.length === 7 ? [] : selectedDays,
      workspaceId: null, // habits are user-global
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
          <FormLabel>Unit</FormLabel>
          <select
            value={unitMode === 'preset' ? unit : unitMode === 'time' ? '__time__' : unitMode === 'custom' ? '__custom__' : ''}
            onChange={e => {
              const v = e.target.value;
              if (v === '') { setUnitMode('none'); setUnit(''); }
              else if (v === '__time__') setUnitMode('time');
              else if (v === '__custom__') { setUnitMode('custom'); setUnit(''); setUnitAmount(''); }
              else { setUnitMode('preset'); setUnit(v); setUnitAmount(''); }
            }}
            style={{ ...FORM_INPUT_STYLE, cursor: 'pointer' }}
          >
            <option value="">None (just a count)</option>
            {PRESET_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            <option value="__time__">Time (min:seg)</option>
            <option value="__custom__">Custom…</option>
          </select>
          {unitMode === 'custom' && (
            <input
              value={unit}
              onChange={e => setUnit(e.target.value)}
              placeholder="custom unit (e.g. laps)"
              style={{ ...FORM_INPUT_STYLE, marginTop: 6 }}
            />
          )}
        </div>
      )}

      {kind === 'counter' && (
        <div style={{ marginBottom: 12 }}>
          <FormLabel>Daily goal</FormLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder={isTime ? '10:00' : '8'}
              inputMode={isTime ? 'text' : 'numeric'}
              style={{ ...FORM_INPUT_STYLE, width: isTime ? 90 : 70 }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {isTime ? 'mm:ss per day' : 'per day'}
            </span>
          </div>
        </div>
      )}

      {isTime && (
        <div style={{ marginBottom: 12 }}>
          <FormLabel>+/- step <span style={{ fontWeight: 400, color: 'var(--color-text-faint)' }}>(mm:ss)</span></FormLabel>
          <input
            value={timeStep}
            onChange={e => setTimeStep(e.target.value)}
            placeholder="1:00"
            style={{ ...FORM_INPUT_STYLE, width: 90 }}
          />
        </div>
      )}

      {kind === 'counter' && !isTime && (unitMode === 'preset' || unitMode === 'custom') && unit.trim() && (
        <div style={{ marginBottom: 12 }}>
          <FormLabel>Amount per step <span style={{ fontWeight: 400, color: 'var(--color-text-faint)' }}>(optional)</span></FormLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              value={unitAmount}
              onChange={e => setUnitAmount(e.target.value)}
              placeholder="250"
              min={1}
              style={{ ...FORM_INPUT_STYLE, width: 70 }}
            />
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
              {unit.trim()} / step
            </span>
          </div>
        </div>
      )}

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

      <div style={{ marginBottom: 16 }}>
        <FormLabel>End date <span style={{ fontWeight: 400, color: 'var(--color-text-faint)' }}>(optional)</span></FormLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{ ...FORM_INPUT_STYLE, width: 'auto' }}
          />
          {endDate
            ? <button onClick={() => setEndDate('')} style={{ fontSize: 11, color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
            : <button onClick={() => setEndDate(new Date().toLocaleDateString('en-CA'))} style={{ fontSize: 11, color: 'var(--color-text-faint)', background: 'none', border: 'none', cursor: 'pointer' }}>End today</button>}
        </div>
        {endDate && !endDateCutsChallenge && (
          <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4 }}>
            Stops appearing in Today after this date — history is kept.
          </div>
        )}
        {endDateCutsChallenge && (
          <div style={FORM_NOTICE_STYLE}>
            This ends the habit on {fmtShortDate(endDate)}, before the challenge can finish
            on {fmtShortDate(projectedEnd!)}. The habit would stop appearing in Today while
            the run kept counting days you could no longer tick — an unwinnable challenge.
            Move the end date, or turn the challenge off.
          </div>
        )}
        {endDateLeavesNoSkipRoom && (
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            The challenge fits, but only exactly. Choosing <strong>Keep going</strong> after a
            missed day adds a day to the run, which would push the finish past
            {' '}{fmtShortDate(endDate)} — after which the habit is read-only. Ending on
            {' '}{fmtShortDate(skipRoom!)} or later leaves room for every skip.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: isChallenge ? 8 : 0 }}>
          <input type="checkbox" checked={isChallenge} onChange={e => setIsChallenge(e.target.checked)} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {BADGE_CHALLENGE_LENGTH}-day challenge
          </span>
        </label>
        {isChallenge && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number"
                min={1}
                value={challengeLengthDays}
                onChange={e => setChallengeLengthDays(e.target.value)}
                style={{ ...FORM_INPUT_STYLE, width: 60 }}
              />
              <span style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>
                {spansMoreThanItSays ? 'scheduled days' : 'days'}
              </span>
            </div>
            {lengthOutOfRange && (
              <div style={FORM_NOTICE_STYLE}>
                Enter a number from 1 to {MAX_CHALLENGE_LENGTH_DAYS}.
              </div>
            )}
            {projectionUnavailable && (
              <div style={FORM_NOTICE_STYLE}>
                This run can't be placed on the calendar — {parsedLength} scheduled days on
                this schedule reach past the ten years the app looks ahead. Shorten it, or
                schedule the habit on more days.
              </div>
            )}
            {projectedEnd && (
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                {spansMoreThanItSays
                  ? <>Counts the days this habit is scheduled, so it finishes around{' '}
                      <strong>{fmtShortDate(projectedEnd)}</strong> — {daysBetween(runStart, projectedEnd)} days
                      of calendar, not {parsedLength}.</>
                  : <>Finishes around <strong>{fmtShortDate(projectedEnd)}</strong>.</>}
                {spentSkips > 0 && <> A spent skip has already pushed this out.</>}
              </div>
            )}
            {restartsRun && (
              <div style={FORM_NOTICE_STYLE}>
                {awaitingRestartConfirm ? 'Press again to confirm: this' : 'Saving'} starts the run
                over from today, losing its current progress. Days are counted against the habit's
                schedule, so a different schedule is a different run.
              </div>
            )}
            <div style={{ fontSize: 10, color: 'var(--color-text-faint)', marginTop: 4, lineHeight: 1.5 }}>
              Shows a progress card counting the days you complete. Miss a day and you choose:
              keep going (costs a skip) or start over.
              {Number(challengeLengthDays) === BADGE_CHALLENGE_LENGTH ? (
                <> Finishing this one with no skips earns an achievement. 🏆</>
              ) : (
                <> Only {BADGE_CHALLENGE_LENGTH}-day challenges earn an achievement.</>
              )}
            </div>
          </>
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
          disabled={!canSaveHabit}
          style={{
            flex: 2, padding: '8px 0', border: 'none', borderRadius: 'var(--radius-md)',
            background: canSaveHabit ? 'var(--color-accent)' : 'var(--color-border)',
            color: canSaveHabit ? '#fff' : 'var(--color-text-muted)',
            fontSize: 13, fontWeight: 600, cursor: canSaveHabit ? 'pointer' : 'not-allowed',
          }}
        >
          {awaitingRestartConfirm
            ? 'Start over and save'
            : initialHabit ? 'Save changes' : 'Save habit'}
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
