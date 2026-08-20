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
import { useSettings } from '@/hooks/useSettings';

export default function HabitsScreen() {
  const { habits, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit } = useHabits();
  const { settings, update } = useSettings();
  const [formVisible, setFormVisible] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithProgress | null>(null);
  const challengeHabits = habits.filter(h => (h.challengeLengthDays ?? 0) > 0);

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
        {challengeHabits.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>21-Day challenge</Text>
            {challengeHabits.map(habit => {
              const length = habit.challengeLengthDays ?? 21;
              const clamped = Math.min(habit.daysDone, length);
              const complete = clamped >= length;
              return (
                <View key={habit.id} style={styles.challengeCard}>
                  <View style={styles.challengeTitleRow}>
                    <Ionicons name={habit.icon as ComponentProps<typeof Ionicons>['name']} size={16} color={colors.accent} />
                    <Text style={styles.challengeTitle}>{habit.name}</Text>
                  </View>
                  <Text style={styles.challengeDesc}>
                    {complete ? `¡Completado! ${length}/${length} días` : `Día ${clamped} de ${length}. Un día a la vez.`}
                  </Text>
                  <View style={styles.challengeProgress}>
                    <View style={[styles.challengeProgressFill, { width: `${(clamped / length) * 100}%` }]} />
                  </View>
                  <Text style={styles.challengeMeta}>
                    {clamped}/{length} días · {clamped > 0 ? 'racha activa' : 'sin racha'}
                  </Text>
                </View>
              );
            })}
          </>
        )}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Today</Text>
          <Pressable
            style={[styles.pinButton, settings.showHabitsInToday && styles.pinButtonActive]}
            onPress={() => update('showHabitsInToday', !settings.showHabitsInToday)}
            hitSlop={6}
          >
            <Ionicons name="pin" size={11} color={settings.showHabitsInToday ? colors.accent : colors.textTertiary} />
            <Text style={[styles.pinButtonText, settings.showHabitsInToday && styles.pinButtonTextActive]}>
              {settings.showHabitsInToday ? 'In Today' : 'Show in Today'}
            </Text>
          </Pressable>
        </View>

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
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pinButtonActive: { borderColor: colors.accent },
  pinButtonText: { fontSize: 10, fontWeight: '400', color: colors.textTertiary },
  pinButtonTextActive: { fontWeight: '600', color: colors.accent },
  challengeCard: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  challengeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  challengeTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  challengeDesc: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  challengeProgress: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  challengeProgressFill: { width: '33%', height: '100%', backgroundColor: colors.accent },
  challengeMeta: { fontSize: 11, fontWeight: '600', color: colors.textTertiary, marginTop: 6 },
});
