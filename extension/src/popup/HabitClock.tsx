import { createContext, useContext } from 'react';
import type React from 'react';
import { fmtClock, fmtHabitTime } from '@pomodoso/types';

import type { HabitRow } from '../db';
import type { HabitTimerView } from './useHabitTimer';

// The clock on timer habits: a ▶/⏸ next to the counter, and a digital clock
// under the habit while it runs. Separate from the main pomodoro timer; both
// can run at once.

export const HabitClockContext = createContext<(HabitTimerView & { today: string }) | null>(null);

/** ▶ to start the habit's clock, ⏸ to stop it. Starting one stops any other. */
export function HabitClockButton({ habit, disabled = false, size = 22 }: { habit: HabitRow; disabled?: boolean; size?: number }) {
  const clock = useContext(HabitClockContext);
  if (!clock || !habit.timer || !habit.timeUnit) return null;
  const running = clock.habitId === habit.id;
  return (
    <button
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (running) clock.stop(); else clock.start(habit.id, clock.today); }}
      title={running ? 'Stop the clock (keeps the time)' : 'Start the clock'}
      style={{
        width: size, height: size, borderRadius: 4, flexShrink: 0,
        border: `1px solid ${running ? 'var(--color-accent)' : 'var(--color-border)'}`,
        background: running ? 'var(--color-accent)' : 'var(--color-bg)',
        color: running ? '#fff' : 'var(--color-text-muted)',
        fontSize: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      }}
    >
      {running ? '⏸' : '▶'}
    </button>
  );
}

/**
 * The digital clock under a habit whose clock is running: today's total
 * against the goal. Past the goal it turns green and keeps counting.
 */
export function HabitClockBar({ habit, total, style }: { habit: HabitRow; total: number; style?: React.CSSProperties }) {
  const clock = useContext(HabitClockContext);
  if (!clock || clock.habitId !== habit.id) return null;
  const goal = habit.goal ?? 0;
  const reached = goal > 0 && total >= goal;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginTop: 5,
      padding: '4px 8px', borderRadius: 'var(--radius-sm)',
      background: reached ? 'var(--color-success-bg)' : 'var(--color-accent-soft)',
      border: `1px solid ${reached ? 'var(--color-success)' : 'var(--color-accent)'}`,
      ...style,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, letterSpacing: '0.02em', color: reached ? 'var(--color-success)' : 'var(--color-text)' }}>
        {fmtClock(total)}
      </span>
      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flex: 1 }}>
        {reached ? `✓ Done · still counting` : `of ${fmtHabitTime(goal)}`}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); clock.stop(); }}
        style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-muted)' }}
      >
        ⏸ Stop
      </button>
    </div>
  );
}
