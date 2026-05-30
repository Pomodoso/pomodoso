import type { TimerMode } from '@pomodoso/types';

interface TimerRingProps {
  mode: TimerMode;
  progress: number;   // 0..1, used only in pomodoro mode
  timeLabel: string;  // "14:32" or "00:42:18"
  isActive: boolean;
}

const SIZE = 120;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TimerRing({ mode, progress, timeLabel, isActive }: TimerRingProps) {
  const isStopwatch = mode === 'stopwatch';
  const strokeColor = isStopwatch ? 'var(--color-success)' : 'var(--color-accent)';
  const dashOffset = isStopwatch ? 0 : CIRCUMFERENCE * (1 - progress);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE, height: SIZE }}>
      <svg
        width={SIZE}
        height={SIZE}
        style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={STROKE}
        />
        {/* Progress / border */}
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          style={{ transition: isActive ? 'stroke-dashoffset 1s linear' : 'none' }}
        />
      </svg>

      <span
        style={{
          color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          position: 'relative',
        }}
      >
        {timeLabel}
      </span>
    </div>
  );
}
