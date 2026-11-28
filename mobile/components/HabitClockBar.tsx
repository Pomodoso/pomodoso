import { fmtClock, fmtHabitTime } from '@pomodoso/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontMono } from '@/constants/theme';

/**
 * The digital clock under a habit whose clock is running (mobile's side of
 * the extension's HabitClockBar): today's total against the goal. Past the
 * goal it turns green and keeps counting.
 */
export function HabitClockBar({ total, goal, onStop }: { total: number; goal: number; onStop: () => void }): React.JSX.Element {
  const reached = goal > 0 && total >= goal;
  return (
    <View style={[styles.bar, reached && styles.barDone]}>
      <Text style={[styles.clock, reached && styles.clockDone]}>{fmtClock(total)}</Text>
      <Text style={styles.label} numberOfLines={1}>{reached ? '✓ Done · still counting' : `of ${fmtHabitTime(goal)}`}</Text>
      <Pressable style={styles.stop} onPress={onStop} hitSlop={6}>
        <Text style={styles.stopText}>⏸ Stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  barDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  clock: { fontFamily: fontMono, fontSize: 18, fontWeight: '700', color: colors.text },
  clockDone: { color: colors.success },
  label: { flex: 1, fontSize: 11.5, color: colors.textSecondary },
  stop: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stopText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
});
