import type { SoundSettings, TaskStatusConfig } from '@pomodoso/types';
import { DEFAULT_TASK_STATUS_CONFIG, parseTaskStatusConfig } from '@pomodoso/types';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useRef } from 'react';

import { db } from '@/db/client';
import { markSettingDirty } from '@/utils/syncedSettings';
import { triggerSync } from '@/utils/sync';
import { settings } from '@/db/schema';

export interface AppSettings {
  focusSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  longBreakEvery: number;
  dailyGoal: number;
  maxPriorities: number;
  weekStart: number; // 0=Mon..6=Sun, same convention as habit.days
  workDays: number[]; // same convention
  // Stored as one JSON blob (not flattened into per-field keys, unlike the
  // rest of AppSettings) — mirrors extension's own single `sound_settings`
  // key exactly (db.ts), and the shape is already cohesive from
  // @pomodoso/types, so there's nothing to gain from splitting it up.
  soundSettings: SoundSettings;
  // Mirrors the extension's "📌 Show in Today" pins (HomeState.tsx's
  // showHabitsInToday/showChallengesInToday/showScheduleInToday) — each pins a
  // whole section off Home rather than per-item. Persisted on both clients now
  // (the extension's habits pin used to be unpersisted React state that reset
  // on every popup open). Default true, same as the extension.
  // Today's sections reorder themselves as work resolves: done/cancelled sink,
  // in-progress rises, todo/delayed hold their hand-chosen place. On by default
  // — the setting is there to switch it off. Mirrors extension's
  // `auto_sort_by_status`.
  autoSortByStatus: boolean;
  showHabitsInToday: boolean;
  showChallengesInToday: boolean;
  showMeetingsInToday: boolean;
  // User-defined task statuses (see @pomodoso/types task-status.ts). Synced.
  taskStatuses: TaskStatusConfig;
}

// Matches @pomodoso/types' DEFAULT_SOUND_SETTINGS exactly (kept as a literal
// here rather than importing the value — Metro can't resolve @pomodoso/types'
// bundler-mode "export * from './types/index.js'" for anything beyond
// type-only imports, which get erased before Metro ever sees them; SoundSettings
// above is fine as import type for the same reason).
const DEFAULT_SOUND_SETTINGS: SoundSettings = {
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

// Matches extension's DEFAULT_TIMER_SETTINGS (shared/types/src/types/index.ts)
// plus its General page defaults (App.tsx: maxPriorities ?? 3, weekStart ??
// 0, workDays ?? [0,1,2,3,4]) — same values, same "row absent = default"
// semantics as the extension's own settings table.
export const DEFAULT_SETTINGS: AppSettings = {
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  longBreakEvery: 4,
  dailyGoal: 12,
  maxPriorities: 3,
  weekStart: 0,
  workDays: [0, 1, 2, 3, 4],
  soundSettings: DEFAULT_SOUND_SETTINGS,
  autoSortByStatus: true,
  showHabitsInToday: true,
  showChallengesInToday: true,
  showMeetingsInToday: true,
  taskStatuses: DEFAULT_TASK_STATUS_CONFIG,
};

const KEYS: Record<keyof AppSettings, string> = {
  focusSeconds: 'focus_seconds',
  shortBreakSeconds: 'short_break_seconds',
  longBreakSeconds: 'long_break_seconds',
  longBreakEvery: 'long_break_every',
  dailyGoal: 'daily_goal',
  maxPriorities: 'max_priorities',
  weekStart: 'week_start',
  workDays: 'work_days',
  soundSettings: 'sound_settings',
  autoSortByStatus: 'auto_sort_by_status',
  showHabitsInToday: 'show_habits_in_today',
  showChallengesInToday: 'show_challenges_in_today',
  showMeetingsInToday: 'show_meetings_in_today',
  taskStatuses: 'task_statuses',
};

/**
 * The stored task statuses, read now rather than from the last render. Edits
 * on the Task statuses screen land back to back (a rename commits on blur, and
 * the tap that causes the blur is itself an edit); building each from the
 * rendered value let the second overwrite the first. Writes here are
 * synchronous, so this read always sees the previous edit.
 */
export function readTaskStatuses(): TaskStatusConfig {
  const raw = db.select().from(settings).where(eq(settings.key, KEYS.taskStatuses)).all()[0]?.value;
  try {
    return parseTaskStatusConfig(raw === undefined ? undefined : JSON.parse(raw));
  } catch {
    return DEFAULT_TASK_STATUS_CONFIG;
  }
}

export function useSettings() {
  const { data: rows } = useLiveQuery(db.select().from(settings));
  // useLiveQuery's `data` starts as `[]` and only resolves to the real rows
  // after an async first tick (drizzle-orm/expo-sqlite wraps even this sync
  // DB's first read in a microtask) — code that can run before that tick
  // (e.g. starting a timer session right after mount) would otherwise see
  // defaults instead of a saved non-default value. Closed by reading once,
  // synchronously, on first call and preferring that until the live query
  // actually has rows.
  const syncFallbackRef = useRef<{ key: string; value: string }[] | null>(null);
  if (syncFallbackRef.current === null) {
    syncFallbackRef.current = db.select().from(settings).all();
  }
  const effectiveRows = rows.length > 0 ? rows : syncFallbackRef.current;
  const byKey = new Map(effectiveRows.map(r => [r.key, r.value]));

  function get<K extends keyof AppSettings>(field: K): AppSettings[K] {
    const raw = byKey.get(KEYS[field]);
    if (raw === undefined) return DEFAULT_SETTINGS[field];
    try {
      return JSON.parse(raw) as AppSettings[K];
    } catch {
      return DEFAULT_SETTINGS[field];
    }
  }

  const value: AppSettings = {
    focusSeconds: get('focusSeconds'),
    shortBreakSeconds: get('shortBreakSeconds'),
    longBreakSeconds: get('longBreakSeconds'),
    longBreakEvery: get('longBreakEvery'),
    dailyGoal: get('dailyGoal'),
    maxPriorities: get('maxPriorities'),
    weekStart: get('weekStart'),
    workDays: get('workDays'),
    soundSettings: get('soundSettings'),
    autoSortByStatus: get('autoSortByStatus'),
    showHabitsInToday: get('showHabitsInToday'),
    showChallengesInToday: get('showChallengesInToday'),
    showMeetingsInToday: get('showMeetingsInToday'),
    // Parsed, not cast: it arrives from other devices, and a malformed entry
    // must cost that entry rather than every status picker.
    taskStatuses: parseTaskStatusConfig(get('taskStatuses')),
  };

  function update<K extends keyof AppSettings>(field: K, next: AppSettings[K]): void {
    const key = KEYS[field];
    const json = JSON.stringify(next);
    db.insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json } })
      .run();
    // Settings that other devices share travel; the rest (show habits/meetings
    // in Today) describe this screen and stay put. markSettingDirty decides
    // which is which, and no-ops for the local-only ones.
    markSettingDirty(key);
    triggerSync();
  }

  return { settings: value, update };
}
