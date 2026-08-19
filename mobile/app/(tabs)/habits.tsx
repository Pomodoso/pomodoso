import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitFormModal } from '@/components/HabitFormModal';
import { HabitRow } from '@/components/HabitRow';
import { toMondayFirstDow } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import type { HabitWithProgress } from '@/hooks/useHabits';
import { useHabits } from '@/hooks/useHabits';

export default function HabitsScreen() {
  const { habits, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit } = useHabits();
  const [formVisible, setFormVisible] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithProgress | null>(null);

  function openCreate(): void {
    setEditingHabit(null);
    setFormVisible(true);
  }

  function openEdit(habit: HabitWithProgress): void {
    setEditingHabit(habit);
    setFormVisible(true);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Habits</Text>
        <Pressable onPress={openCreate} hitSlop={8}>
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
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
            days={habit.days}
            kind={habit.kind}
            done={habit.done}
            count={habit.count}
            goal={habit.goal}
            weekFilled={habit.weekFilled}
            todayIndex={toMondayFirstDow(new Date())}
            onPress={() => openEdit(habit)}
            onToggle={() => toggleHabit(habit.id)}
            onIncrement={delta => incrementHabit(habit.id, delta)}
          />
        ))}
      </ScrollView>

      <HabitFormModal
        visible={formVisible}
        initialHabit={editingHabit}
        onSave={input => {
          if (editingHabit) updateHabit(editingHabit.id, input);
          else addHabit(input);
          setFormVisible(false);
        }}
        onDelete={() => {
          if (editingHabit) removeHabit(editingHabit.id);
          setFormVisible(false);
        }}
        onCancel={() => setFormVisible(false)}
      />
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
