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
  timeUnit?: boolean;
  unitAmount?: number | null;
  /** Ended habits: shown with their history, nothing to tick. */
  readOnly?: boolean;
  /** Shown under the name instead of the streak, e.g. "Ended Nov 3". */
  note?: string | undefined;
  weekFilled: boolean[]; // 7 entries, Monday..Sunday
  todayIndex: number;
  onPress?: () => void;
  /** Long-press: picks the row up to move it (ReorderableSection). */
  onLongPress?: () => void;
  onToggle: () => void;
  onIncrement: (delta: number) => void;
  /** A challenge waiting on a missed day: the control is locked until it's answered. */
  paused?: boolean;
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
  timeUnit = false,
  unitAmount,
  readOnly = false,
  note,
  weekFilled,
  todayIndex,
  onPress,
  onLongPress,
  onToggle,
  onIncrement,
  paused = false,
}: HabitRowProps) {
  const schedule = daysSummary(days);

  return (
    <View style={[styles.card, paused && styles.cardPaused, readOnly && styles.cardReadOnly]}>
      <View style={styles.top}>
        <View style={[styles.icon, !done && styles.iconPending]}>
          <Ionicons name={icon} size={19} color={done ? colors.success : colors.textTertiary} />
        </View>
        <Pressable style={styles.nameBlock} onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress}>
          <Text style={styles.name}>{name}</Text>
          {paused ? (
            <Text style={styles.paused}>⚠ Challenge paused</Text>
          ) : (
            <Text style={styles.streak}>
              {note ?? streakLabel}
              {schedule ? ` · ${schedule}` : ''}
            </Text>
          )}
        </Pressable>
        {!readOnly && (
          <HabitControl
            kind={kind}
            done={done}
            count={count}
            goal={goal}
            timeUnit={timeUnit}
            unitAmount={unitAmount}
            onToggle={onToggle}
            onIncrement={onIncrement}
            disabled={paused}
          />
        )}
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
  cardPaused: { backgroundColor: colors.warningSoft },
  cardReadOnly: { opacity: 0.7 },
  paused: { fontSize: 12.5, fontWeight: '600', color: colors.warning, marginTop: 2 },
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
