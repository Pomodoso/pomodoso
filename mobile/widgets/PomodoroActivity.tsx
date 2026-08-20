import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

// name must match app.json's expo-widgets plugin config ("PomodoroActivity").
const NAME = 'PomodoroActivity';

// Props are plain JSON-safe primitives (epoch ms, not Date objects) — the
// 'widget' directive below compiles this function to native SwiftUI code, a
// real cross-language boundary, not an interpreted JS call at runtime.
// Matches Expo's own documented Live Activity example, which passes
// primitives and constructs any Date the timer display needs inside the
// layout body itself.
export interface PomodoroActivityProps {
  mode: 'pomodoro' | 'stopwatch';
  kind: 'focus' | 'short_break' | 'long_break';
  taskTitle: string | null;
  startedAtMs: number;
  plannedDurationSeconds: number | null; // null for stopwatch (open-ended)
  pausedAtMs: number | null; // set only while paused
}

function kindLabel(mode: PomodoroActivityProps['mode'], kind: PomodoroActivityProps['kind']): string {
  if (mode === 'stopwatch') return 'Stopwatch';
  if (kind === 'short_break') return 'Short break';
  if (kind === 'long_break') return 'Long break';
  return 'Focus session';
}

function kindIcon(kind: PomodoroActivityProps['kind']): string {
  return kind === 'focus' ? '🍅' : '☕';
}

// STOPWATCH_HORIZON: Text's timerInterval needs a real upper bound even for
// an open-ended stopwatch (SwiftUI has no "count up forever" mode) — 24h is
// far beyond any realistic single session, so countsDown=false effectively
// shows unbounded elapsed time in practice.
const STOPWATCH_HORIZON_MS = 24 * 60 * 60 * 1000;

const PomodoroActivity = (props: PomodoroActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const accentColor = environment.colorScheme === 'dark' ? '#FFFFFF' : '#C8553D';
  const lower = new Date(props.startedAtMs);
  const upper =
    props.plannedDurationSeconds != null
      ? new Date(props.startedAtMs + props.plannedDurationSeconds * 1000)
      : new Date(props.startedAtMs + STOPWATCH_HORIZON_MS);
  const pauseTime = props.pausedAtMs != null ? new Date(props.pausedAtMs) : undefined;
  const countsDown = props.plannedDurationSeconds != null;
  const label = kindLabel(props.mode, props.kind);
  const icon = kindIcon(props.kind);

  const timerText = (size: number) => (
    <Text timerInterval={{ lower, upper }} countsDown={countsDown} pauseTime={pauseTime} modifiers={[font({ size, weight: 'bold' })]} />
  );

  return {
    banner: (
      <VStack modifiers={[padding({ all: 14 })]}>
        <HStack>
          <Text modifiers={[font({ size: 20 })]}>{icon}</Text>
          <Text modifiers={[font({ weight: 'semibold' }), foregroundStyle(accentColor)]}>{label}</Text>
        </HStack>
        {props.taskTitle && <Text modifiers={[font({ size: 13 }), foregroundStyle('#98948A')]}>{props.taskTitle}</Text>}
        {timerText(32)}
      </VStack>
    ),
    compactLeading: <Text modifiers={[font({ size: 15 })]}>{icon}</Text>,
    compactTrailing: timerText(15),
    minimal: <Text modifiers={[font({ size: 13 })]}>{icon}</Text>,
    expandedLeading: (
      <VStack modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ size: 18 })]}>{icon}</Text>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accentColor)]}>{label}</Text>
      </VStack>
    ),
    expandedTrailing: <VStack modifiers={[padding({ all: 10 })]}>{timerText(22)}</VStack>,
    expandedBottom: props.taskTitle ? (
      <Text modifiers={[padding({ horizontal: 10 }), font({ size: 12 }), foregroundStyle('#98948A')]}>{props.taskTitle}</Text>
    ) : undefined,
  };
};

export default createLiveActivity<PomodoroActivityProps>(NAME, PomodoroActivity);
