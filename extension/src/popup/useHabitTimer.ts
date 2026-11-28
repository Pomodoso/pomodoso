import { useCallback, useEffect, useState } from 'react';
import { habitTimerElapsed, type HabitTimerState } from '@pomodoso/types';

import { HABIT_TIMER_KEY, readHabitTimer, startHabitTimer, stopHabitTimer } from '../habitTimer';
import { triggerSync } from '../syncEngine';

export interface HabitTimerView {
  /** The habit the clock runs on, or null. */
  habitId: string | null;
  /** Seconds run and not yet added to the count. */
  running: number;
  start: (habitId: string, day: string) => void;
  stop: () => void;
}

/**
 * The habit clock as the popup sees it: the stored state (kept live through
 * chrome.storage, since the background commits at the goal), and a tick each
 * second while it runs.
 */
export function useHabitTimer(): HabitTimerView {
  const [state, setState] = useState<HabitTimerState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void readHabitTimer().then(setState);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && HABIT_TIMER_KEY in changes) {
        setState((changes[HABIT_TIMER_KEY]!.newValue as HabitTimerState | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (!state) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback((habitId: string, day: string) => {
    void startHabitTimer(habitId, day).then(() => triggerSync());
  }, []);
  const stop = useCallback(() => {
    void stopHabitTimer().then(() => triggerSync());
  }, []);

  return {
    habitId: state?.habitId ?? null,
    running: state ? habitTimerElapsed(state, now) : 0,
    start,
    stop,
  };
}
