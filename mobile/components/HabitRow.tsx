import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { daysSummary } from '@/constants/habitDays';
import { colors } from '@/constants/theme';

import { HabitControl } from './HabitControl';

interface HabitRowProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  name: string;
  streakLabel: string;
  days: number[];
  kind: 'boolean' | 'counter';
  done: boolean;
  count: number;
  goal: number | null;
  weekFilled: boolean[]; // 7 entries, Monday..Sunday
  todayIndex: number;
  onPress?: () => void;
  onToggle: () => void;
  onIncrement: (delta: number) => void;
}

export function HabitRow({
  icon,
  name,
  streakLabel,
  days,
  kind,
  done,
  count,
  goal,
  weekFilled,
  todayIndex,
  onPress,
  onToggle,
  onIncrement,
}: HabitRowProps) {
  const schedule = daysSummary(days);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.icon, !done && styles.iconPending]}>
          <Ionicons name={icon} size={19} color={done ? colors.success : colors.textTertiary} />
        </View>
        <Pressable style={styles.nameBlock} onPress={onPress} disabled={!onPress}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.streak}>
            {streakLabel}
            {schedule ? ` · ${schedule}` : ''}
          </Text>
        </Pressable>
        <HabitControl kind={kind} done={done} count={count} goal={goal} onToggle={onToggle} onIncrement={onIncrement} />
      </View>
      <View style={styles.week}>
        {weekFilled.map((filled, i) => (
          <View
            key={i}
            style={[
              styles.day,
              filled && styles.dayFilled,
              i === todayIndex && styles.dayToday,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPending: { backgroundColor: colors.bg },
  nameBlock: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  streak: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
  week: { flexDirection: 'row', gap: 5 },
  day: { flex: 1, height: 22, borderRadius: 5, backgroundColor: colors.border },
  dayFilled: { backgroundColor: colors.success },
  dayToday: { borderWidth: 2, borderColor: colors.accentSoft },
});
