import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AchievementsSection } from '@/components/AchievementsSection';
import { ChallengesSection } from '@/components/ChallengesSection';
import { HabitFormModal } from '@/components/HabitFormModal';
import { ReorderableSection } from '@/components/ReorderableSection';
import { HabitRow } from '@/components/HabitRow';
import { toMondayFirstDow } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import type { HabitWithProgress } from '@/hooks/useHabits';
import { useAchievements } from '@/hooks/useAchievements';
import { useHabits } from '@/hooks/useHabits';
import { useSettings } from '@/hooks/useSettings';

export default function HabitsScreen() {
  const {
    habits, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit, reorderHabits,
    keepChallengeGoing, startChallengeOver, keepChallengeAsHabit,
  } = useHabits();
  const { count: achievementCount } = useAchievements();
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
        <AchievementsSection count={achievementCount} />

        <ChallengesSection
          habits={challengeHabits}
          actions={{
            onKeepGoing: keepChallengeGoing,
            onStartOver: startChallengeOver,
            onKeepAsHabit: keepChallengeAsHabit,
          }}
          showInToday={settings.showChallengesInToday}
          onToggleShowInToday={() => update('showChallengesInToday', !settings.showChallengesInToday)}
        />

        <ReorderableSection
          title="Today"
          items={habits}
          keyOf={h => h.id}
          // The full list is on screen here, so unlike the Today tab no
          // re-slotting is needed — this IS the habit order.
          onReorder={reorderHabits}
          headerRight={
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
          }
          renderItem={habit => (
            <HabitRow
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
          )}
        />
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
});
