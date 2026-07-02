// ─── Primitives ──────────────────────────────────────────────────────────────

export type UUID = string;
export type ISODate = string;       // "2026-05-25"
export type ISOTimestamp = string;  // "2026-05-25T14:32:00Z"

// ─── User ─────────────────────────────────────────────────────────────────────

export interface User {
  id: UUID;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

// ─── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  id: UUID;
  name: string;
  color: string;
  owner_id: UUID;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
}

export interface WorkspaceMember {
  id: UUID;
  workspace_id: UUID;
  user_id: UUID;
  role: 'owner';
  joined_at: ISOTimestamp;
}

// ─── Subscription & Entitlements ─────────────────────────────────────────────

export type Plan = 'free' | 'founder_lifetime' | 'pro';
export type SubscriptionStatus = 'active' | 'trialing' | 'cancelled' | 'past_due';

export interface Subscription {
  id: UUID;
  user_id: UUID;
  plan: Plan;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: ISOTimestamp | null;
  trial_ends_at: ISOTimestamp | null;
  cancelled_at: ISOTimestamp | null;
  feature_overrides: Partial<EntitlementFeatures> | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

export interface EntitlementFeatures {
  sync: boolean;
  dashboard: boolean;
  multi_workspace: boolean;
  calendar: boolean;
  ai_summary: boolean;
  history_unlimited: boolean;
  api_integrations: boolean;
  max_devices: number;
  max_workspaces: number;
  history_days: number;
}

export interface Entitlements {
  plan: Plan;
  features: EntitlementFeatures;
}

export const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  features: {
    sync: false,
    dashboard: false,
    multi_workspace: false,
    calendar: false,
    ai_summary: false,
    history_unlimited: false,
    api_integrations: false,
    max_devices: 1,
    max_workspaces: 1,
    history_days: 30,
  },
};

export const PRO_ENTITLEMENTS: Entitlements = {
  plan: 'pro',
  features: {
    sync: true,
    dashboard: true,
    multi_workspace: true,
    calendar: true,
    ai_summary: false,
    history_unlimited: true,
    api_integrations: false,
    max_devices: 10,
    max_workspaces: 999,
    history_days: 9999,
  },
};

// ─── Project ──────────────────────────────────────────────────────────────────

export interface Project {
  id: UUID;
  workspace_id: UUID;
  name: string;
  color: string;
  archived_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
  synced_at: ISOTimestamp | null;
}

// ─── Ticket ───────────────────────────────────────────────────────────────────

export type TicketProviderKind = 'linear' | 'github' | 'sentry' | 'arxiv' | 'manual' | 'custom';

export interface DetectionRule {
  id: string;
  name: string;
  urlPattern: string;
  active: boolean;
  kind: 'preset' | 'custom';
  presetId?: string;
}

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'in_review'
  | 'merged'
  | 'waiting'
  | 'blocked'
  | 'done';

export interface Ticket {
  id: UUID;
  workspace_id: UUID;
  project_id: UUID | null;
  provider_kind: TicketProviderKind;
  external_id: string;
  external_url: string;
  title: string;
  status: TicketStatus;
  status_source: 'manual' | 'synced';
  linked_pr_url: string | null;
  linked_pr_number: string | null;
  notes: string;
  first_seen_at: ISOTimestamp;
  last_worked_at: ISOTimestamp;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
  synced_at: ISOTimestamp | null;
}

// Detected by content script — not yet persisted
export interface TicketRef {
  provider_kind: TicketProviderKind;
  external_id: string;
  external_url: string;
  title: string;
  status?: TicketStatus;
  linked_pr?: { url: string; number: string };
}

export interface TicketProviderAdapter {
  id: TicketProviderKind;
  name: string;
  urlPatterns: RegExp[];
  detectTicket(url: string, doc: Document): TicketRef | null;
}

// ─── Recurrence ───────────────────────────────────────────────────────────────

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval?: number;        // repeat every N units (default 1); e.g. 2 = biweekly
  carryOver?: boolean;      // if missed, stay in Today until done/cancelled (default true)
  weekdays?: number[];      // [0=Sun..6=Sat], only for freq='weekly'
  monthDay?: number;        // 1-31, only for freq='monthly'
  yearMonth?: number;       // 1-12, only for freq='yearly'
  yearDay?: number;         // 1-31, only for freq='yearly'
  time?: string | null;     // 'HH:MM' or null for all-day
  startDate: string;        // YYYY-MM-DD
  endDate?: string | null;  // YYYY-MM-DD or null = no end
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: UUID;
  workspace_id: UUID;
  title: string;
  is_priority: boolean;
  ticket_id: UUID | null;
  scheduled_for: ISODate;
  completed_at: ISOTimestamp | null;
  notes: string;
  position: number;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
  synced_at: ISOTimestamp | null;
}

// ─── Pomodoro Session ─────────────────────────────────────────────────────────

export type TimerMode = 'pomodoro' | 'stopwatch' | 'manual';
export type SessionKind = 'focus' | 'break_short' | 'break_long';
export type SessionStatus = 'active' | 'completed' | 'interrupted' | 'cancelled';

export interface PomodoroSession {
  id: UUID;
  workspace_id: UUID;
  task_id: UUID;
  ticket_id: UUID | null;
  mode: TimerMode;
  started_at: ISOTimestamp;
  ended_at: ISOTimestamp | null;
  planned_duration_seconds: number | null;
  actual_duration_seconds: number;
  kind: SessionKind;
  status: SessionStatus;
  note: string;
  device_id: string;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  synced_at: ISOTimestamp | null;
}

// ─── Timer Settings (persisted in chrome.storage.local as 'pom_timer_settings') ─

export interface TimerSettings {
  focusSeconds: number;       // default: 25 * 60
  shortBreakSeconds: number;  // default: 5 * 60
  longBreakSeconds: number;   // default: 15 * 60
  longBreakEvery: number;     // default: 4
  dailyGoal: number;          // default: 12
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  longBreakEvery: 4,
  dailyGoal: 12,
};

// ─── Timer State (extension-local, not persisted to DB) ──────────────────────

export interface TimerState {
  status: 'idle' | 'active' | 'paused' | 'break' | 'pomo-done' | 'break-done';
  mode: TimerMode;
  sessionId: UUID | null;

  // Pomodoro countdown (mode === 'pomodoro')
  pomodoroStartedAt: number | null;      // Date.now() ms, never adjusted
  pomoPausedAt: number | null;           // Date.now() ms when pomo was paused
  plannedDurationSeconds: number | null;

  // Break
  breakStartedAt: number | null;
  breakDurationSeconds: number | null;
  pendingBreakDurationSeconds: number | null; // set in pomo-done, consumed when starting break
  breakPromptEndsAt: number | null;           // timestamp when the auto-break fires (pomo-done countdown)

  // Task tracking (may be null even with an active pomodoro)
  taskId: UUID | null;
  taskTitle: string | null;
  ticketId: UUID | null;
  ticketExternalId: string | null;
  taskSegmentStartedAt: number | null;   // when this task was attached; reset on each switch

  // Segment that couldn't be logged because the popup was closed when the alarm fired
  pendingSegment: { taskId: UUID; durationSeconds: number; startedAt: string } | null;

  // Pomodoro paused by a meeting stopwatch — resumes automatically when the stopwatch stops
  pausedPomodoro: { remainingSeconds: number; plannedDurationSeconds: number } | null;

  // Global counters
  pomosCompletedToday: number;
  pomosDate: string | null;              // YYYY-MM-DD (local) when the count was last incremented
  pomosGoal: number;                     // cached from TimerSettings for the badge
}

export const IDLE_TIMER_STATE: TimerState = {
  status: 'idle',
  mode: 'pomodoro',
  sessionId: null,
  pomodoroStartedAt: null,
  pomoPausedAt: null,
  plannedDurationSeconds: null,
  breakStartedAt: null,
  breakDurationSeconds: null,
  pendingBreakDurationSeconds: null,
  breakPromptEndsAt: null,
  taskId: null,
  taskTitle: null,
  ticketId: null,
  ticketExternalId: null,
  taskSegmentStartedAt: null,
  pendingSegment: null,
  pausedPomodoro: null,
  pomosCompletedToday: 0,
  pomosDate: null,
  pomosGoal: 12,
};

// ─── Habit ────────────────────────────────────────────────────────────────────

export type HabitKind = 'boolean' | 'counter';
export type HabitFrequency = 'daily' | 'weekdays' | 'custom';

export interface Habit {
  id: UUID;
  workspace_id: UUID;
  name: string;
  icon: string;
  kind: HabitKind;
  target_count: number | null;
  frequency: HabitFrequency;
  frequency_days: string | null; // "1,2,3,4,5" Mon-Fri
  position: number;
  archived_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  deleted_at: ISOTimestamp | null;
  synced_at: ISOTimestamp | null;
}

export interface HabitLog {
  id: UUID;
  habit_id: UUID;
  workspace_id: UUID;
  date: ISODate;
  value: number;
  completed_at: ISOTimestamp | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
  synced_at: ISOTimestamp | null;
}

// ─── Sound Settings ───────────────────────────────────────────────────────────

export type SoundEvent = 'pomo-done' | 'break-start' | 'break-done' | 'focus-start' | 'task-done';

export interface SoundSettings {
  enabled: boolean;
  volume: number; // 0.0–1.0
  events: {
    pomoDone: boolean;
    breakStart: boolean;
    breakDone: boolean;
    focusStart: boolean;
    taskDone: boolean;
  };
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 0.6,
  events: {
    pomoDone: true,
    breakStart: true,
    breakDone: true,
    focusStart: false,
    taskDone: true,
  },
};

// ─── Extension messaging ──────────────────────────────────────────────────────

export type ExtensionMessage =
  | { type: 'timer.getState' }
  | { type: 'timer.start'; payload: TimerStartPayload }
  | { type: 'timer.attachTask'; payload: TimerAttachPayload }
  | { type: 'timer.detachTask' }
  | { type: 'timer.pause' }
  | { type: 'timer.resume' }
  | { type: 'timer.complete' }
  | { type: 'timer.startBreak' }
  | { type: 'timer.snooze' }
  | { type: 'timer.stop' }
  | { type: 'timer.clearPendingSegment' }
  | { type: 'timer.extendBreak' }
  | { type: 'timer.startNextPomo' }
  | { type: 'ticket.detected'; payload: TicketRef | null }
  | { type: 'ticket.getDetected' }
  | { type: 'calendar.connect'; wsId: string }
  | { type: 'sync.request' };

export interface TimerStartPayload {
  mode: TimerMode;
  taskId: UUID | null;
  taskTitle: string | null;
  ticketId: UUID | null;
  ticketExternalId: string | null;
}

export interface TimerAttachPayload {
  taskId: UUID;
  taskTitle: string;
  ticketId: UUID | null;
  ticketExternalId: string | null;
}

export type ExtensionResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
