import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
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
}

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
};

export function useSettings() {
  const { data: rows } = useLiveQuery(db.select().from(settings));
  const byKey = new Map((rows ?? []).map(r => [r.key, r.value]));

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
  };

  function update<K extends keyof AppSettings>(field: K, next: AppSettings[K]): void {
    const key = KEYS[field];
    const json = JSON.stringify(next);
    db.insert(settings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: settings.key, set: { value: json } })
      .run();
  }

  return { settings: value, update };
}
