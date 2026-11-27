import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fmtHabitTime, habitTimeStep } from '@pomodoso/types';

import { colors, fontMono } from '@/constants/theme';

interface HabitControlProps {
  kind: 'boolean' | 'counter';
  done: boolean;
  count: number;
  goal: number | null;
  /** A time habit: count and goal are seconds, and a step is unitAmount. */
  timeUnit?: boolean;
  unitAmount?: number | null;
  onToggle: () => void;
  onIncrement: (delta: number) => void;
  /** A paused challenge: shown but not tappable. */
  disabled?: boolean;
  /** Timer habits: ▶ starts the clock, ⏸ stops it. */
  clock?: { running: boolean; onPress: () => void } | undefined;
}

// Shared between the Habits tab and Home's Today strip — both need the exact
// same boolean-check / counter-stepper interaction, matching how the
// extension's Today view and Habits tab both reuse the same habit row shape.
export function HabitControl({ kind, done, count, goal, timeUnit = false, unitAmount, onToggle, onIncrement, disabled = false, clock }: HabitControlProps) {
  if (kind === 'counter') {
    const step = timeUnit ? habitTimeStep(unitAmount) : 1;
    return (
      <View style={[styles.counter, disabled && styles.disabled]}>
        <Pressable style={styles.counterBtn} onPress={() => onIncrement(-step)} hitSlop={6} disabled={disabled}>
          <Text style={styles.counterBtnText}>−</Text>
        </Pressable>
        <Text style={styles.counterValue}>
          {timeUnit ? `${fmtHabitTime(count)}/${fmtHabitTime(goal ?? 0)}` : `${count}/${goal}`}
        </Text>
        <Pressable style={styles.counterBtn} onPress={() => onIncrement(step)} hitSlop={6} disabled={disabled}>
          <Text style={styles.counterBtnText}>+</Text>
        </Pressable>
        {clock && (
          <Pressable
            style={[styles.counterBtn, clock.running && styles.clockOn]}
            onPress={clock.onPress}
            hitSlop={6}
            disabled={disabled}
            accessibilityLabel={clock.running ? 'Stop the clock' : 'Start the clock'}
          >
            <Ionicons name={clock.running ? 'pause' : 'play'} size={13} color={clock.running ? colors.surface : colors.textSecondary} />
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.check, done && styles.checkDone, disabled && styles.disabled]}
      onPress={onToggle}
      hitSlop={8}
      disabled={disabled}
      accessibilityState={{ disabled, checked: done }}
    >
      {done && <Ionicons name="checkmark" size={15} color={colors.surface} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  check: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  disabled: { opacity: 0.35 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  counterBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  counterBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  counterValue: { fontFamily: fontMono, fontWeight: '700', fontSize: 14, color: colors.text, minWidth: 34, textAlign: 'center' },
});
