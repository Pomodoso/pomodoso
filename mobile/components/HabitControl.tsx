import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontMono } from '@/constants/theme';

interface HabitControlProps {
  kind: 'boolean' | 'counter';
  done: boolean;
  count: number;
  goal: number | null;
  onToggle: () => void;
  onIncrement: (delta: number) => void;
}

// Shared between the Habits tab and Home's Today strip — both need the exact
// same boolean-check / counter-stepper interaction, matching how the
// extension's Today view and Habits tab both reuse the same habit row shape.
export function HabitControl({ kind, done, count, goal, onToggle, onIncrement }: HabitControlProps) {
  if (kind === 'counter') {
    return (
      <View style={styles.counter}>
        <Pressable style={styles.counterBtn} onPress={() => onIncrement(-1)} hitSlop={6}>
          <Text style={styles.counterBtnText}>−</Text>
        </Pressable>
        <Text style={styles.counterValue}>
          {count}/{goal}
        </Text>
        <Pressable style={styles.counterBtn} onPress={() => onIncrement(1)} hitSlop={6}>
          <Text style={styles.counterBtnText}>+</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable style={[styles.check, done && styles.checkDone]} onPress={onToggle} hitSlop={8}>
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
  counterBtnText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
  counterValue: { fontFamily: fontMono, fontWeight: '700', fontSize: 14, color: colors.text, minWidth: 34, textAlign: 'center' },
});
