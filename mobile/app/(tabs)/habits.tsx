import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitRow } from '@/components/HabitRow';
import { colors } from '@/constants/theme';
import { useHabits } from '@/hooks/useHabits';

const TODAY_INDEX = 6; // Sunday, last column — matches the week strip in the mockups

// Week strips aren't in the SQLite spike schema yet (that's per-day habit_log
// data, out of scope until the shared/core extraction) — kept static per habit.
const WEEK_FILLED: Record<string, boolean[]> = {
  water: [true, true, true, true, true, true, true],
  exercise: [true, false, true, true, true, false, true],
  read: [false, false, true, false, true, false, false],
  sleep: [true, false, false, true, false, false, false],
};

export default function HabitsScreen() {
  const { habits, toggleHabit } = useHabits();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Habits</Text>
        <Ionicons name="add" size={20} color={colors.textTertiary} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>21-Day challenge</Text>
        <View style={styles.challengeCard}>
          <View style={styles.challengeTitleRow}>
            <Ionicons name="flame" size={16} color={colors.accent} />
            <Text style={styles.challengeTitle}>No sugar</Text>
          </View>
          <Text style={styles.challengeDesc}>Día 7 de 21. Un día a la vez.</Text>
          <View style={styles.challengeProgress}>
            <View style={styles.challengeProgressFill} />
          </View>
          <Text style={styles.challengeMeta}>7 / 21 días · racha activa</Text>
        </View>

        <Text style={styles.sectionTitle}>Today</Text>

        {habits.map(habit => (
          <HabitRow
            key={habit.id}
            icon={habit.icon as ComponentProps<typeof Ionicons>['name']}
            name={habit.name}
            streakLabel={habit.streakLabel}
            done={habit.done}
            weekFilled={WEEK_FILLED[habit.id] ?? []}
            todayIndex={TODAY_INDEX}
            onToggle={() => toggleHabit(habit.id, !habit.done)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 16,
    marginBottom: 10,
  },
  challengeCard: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: 14,
    padding: 16,
  },
  challengeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  challengeTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  challengeDesc: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  challengeProgress: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  challengeProgressFill: { width: '33%', height: '100%', backgroundColor: colors.accent },
  challengeMeta: { fontSize: 11, fontWeight: '600', color: colors.textTertiary, marginTop: 6 },
});
