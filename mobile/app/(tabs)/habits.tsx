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
import { reorderSubset } from '@pomodoso/types';

import { toMondayFirstDow } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import type { HabitWithProgress } from '@/hooks/useHabits';
import { useAchievements } from '@/hooks/useAchievements';
import { useHabits } from '@/hooks/useHabits';
import { habitClockProps, useHabitTimer } from '@/hooks/useHabitTimer';
import { useTodayDate } from '@/hooks/useTodayDate';
import { useSettings } from '@/hooks/useSettings';

export default function HabitsScreen() {
  const {
    habits, toggleHabit, incrementHabit, addHabit, updateHabit, removeHabit, reorderHabits, archiveHabit,
    keepChallengeGoing, startChallengeOver, keepChallengeAsHabit,
  } = useHabits();
  const { counts: achievementCounts } = useAchievements();
  const { settings, update } = useSettings();
  const [formVisible, setFormVisible] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithProgress | null>(null);
  // Challenges include closed habits: a finished run is a result worth
  // keeping on screen. The habit list doesn't (same split as the extension).
  // Archived habits leave the list and Challenges; they're listed under
  // Archived at the bottom, and Ended (past their end date) the same way.
  const liveHabits = habits.filter(h => !h.archived);
  const challengeHabits = liveHabits.filter(h => (h.challengeLengthDays ?? 0) > 0);
  const activeHabits = liveHabits.filter(h => !h.closed);
  const closedHabits = liveHabits.filter(h => h.closed);
  const archivedHabits = habits.filter(h => h.archived);
  const [showClosed, setShowClosed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const habitTimer = useHabitTimer();
  const today = useTodayDate();

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
        <AchievementsSection counts={achievementCounts} />

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
          items={activeHabits}
          keyOf={h => h.id}
          // Closed habits are off this list, so the drop is re-slotted into
          // the full order before it's saved, or they'd fall out of it.
          onReorder={ids => reorderHabits(reorderSubset(habits.map(h => h.id), ids))}
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
          renderItem={habit => {
            const live = habitClockProps(habit, habitTimer, today);
            return (
            <HabitRow
              icon={habit.icon as ComponentProps<typeof Ionicons>['name']}
              name={habit.name}
              streakLabel={habit.streakLabel}
              days={habit.days}
              kind={habit.kind}
              done={live.done}
              count={live.count}
              clock={live.clock}
              goal={habit.goal}
              timeUnit={habit.timeUnit}
              unitAmount={habit.unitAmount}
              weekFilled={habit.weekFilled}
              todayIndex={toMondayFirstDow(new Date())}
              onPress={() => openEdit(habit)}
              onToggle={() => toggleHabit(habit.id)}
              onIncrement={delta => incrementHabit(habit.id, delta)}
              paused={habit.paused}
            />
            );
          }}
        />

        {closedHabits.length > 0 && (
          <GroupToggle label="Ended" count={closedHabits.length} open={showClosed} onToggle={() => setShowClosed(v => !v)} />
        )}
        {showClosed && closedHabits.map(habit => (
          <HabitRow
            key={habit.id}
            icon={habit.icon as ComponentProps<typeof Ionicons>['name']}
            name={habit.name}
            streakLabel={habit.streakLabel}
            note={habit.endDate ? `Ended ${fmtDay(habit.endDate)}` : undefined}
            days={habit.days}
            kind={habit.kind}
            done={habit.done}
            count={habit.count}
            goal={habit.goal}
            weekFilled={habit.weekFilled}
            todayIndex={toMondayFirstDow(new Date())}
            onPress={() => openEdit(habit)}
            onToggle={() => {}}
            onIncrement={() => {}}
            readOnly
          />
        ))}

        {archivedHabits.length > 0 && (
          <GroupToggle label="Archived" count={archivedHabits.length} open={showArchived} onToggle={() => setShowArchived(v => !v)} />
        )}
        {showArchived && archivedHabits.map(habit => (
          <HabitRow
            key={habit.id}
            icon={habit.icon as ComponentProps<typeof Ionicons>['name']}
            name={habit.name}
            streakLabel={habit.streakLabel}
            note={habit.archivedAt ? `Archived ${fmtDay(habit.archivedAt.slice(0, 10))}` : undefined}
            days={habit.days}
            kind={habit.kind}
            done={habit.done}
            count={habit.count}
            goal={habit.goal}
            weekFilled={habit.weekFilled}
            todayIndex={toMondayFirstDow(new Date())}
            onPress={() => openEdit(habit)}
            onToggle={() => {}}
            onIncrement={() => {}}
            readOnly
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
        onArchive={archived => {
          if (!editingHabit) return;
          // A running clock on it stops (and keeps its time) first.
          if (archived && habitTimer.habitId === editingHabit.id) habitTimer.stop();
          archiveHabit(editingHabit.id, archived);
          setFormVisible(false);
        }}
        onCancel={() => setFormVisible(false)}
      />
    </SafeAreaView>
  );
}

/** "▸ Ended (2)": folds a group of habits that left the list. */
function GroupToggle({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <Pressable style={styles.groupToggle} onPress={onToggle} hitSlop={6}>
      <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textTertiary} />
      <Text style={styles.groupToggleText}>{label} ({count})</Text>
    </Pressable>
  );
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  groupToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, marginTop: 6 },
  groupToggleText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textTertiary },
});
