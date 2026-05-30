import type { TimerMode } from '@pomodoso/types';

interface ModeToggleProps {
  value: TimerMode;
  onChange: (mode: TimerMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ value, onChange, disabled = false }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Tracking mode"
      style={{
        display: 'inline-flex',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: '2px',
        gap: '2px',
        opacity: disabled ? 0.5 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {(['pomodoro', 'stopwatch'] as const).map((mode) => {
        const isSelected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(mode)}
            style={{
              padding: '4px 10px',
              borderRadius: 'calc(var(--radius-md) - 2px)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: isSelected ? 600 : 400,
              background: isSelected ? 'var(--color-surface)' : 'transparent',
              color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)',
              boxShadow: isSelected ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            {mode === 'pomodoro' ? '🍅 Pomodoro' : '⏱ Stopwatch'}
          </button>
        );
      })}
    </div>
  );
}
