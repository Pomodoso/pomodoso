import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { challengeProgressLabel, challengeStreakLabel } from '@pomodoso/types';

import { colors } from '@/constants/theme';
import type { HabitWithProgress } from '@/hooks/useHabits';

interface ChallengesSectionProps {
  habits: HabitWithProgress[];
  /** Renders the "Show in Today" pin. Omitted on Home, where the pin lives on
   *  the Habits tab (same arrangement as the habits and meetings sections). */
  showInToday?: boolean;
  onToggleShowInToday?: () => void;
}

/**
 * A challenge is a fixed-length run with an end, not just another habit, so it
 * gets its own titled block instead of floating above the habit list unlabelled.
 *
 * Unlike the habit list this deliberately includes habits past their end date:
 * a finished 21-day run is a result, and hiding it the day after it completes
 * is exactly when you least want it gone.
 */
export function ChallengesSection({ habits, showInToday, onToggleShowInToday }: ChallengesSectionProps) {
  if (habits.length === 0) return null;
  const completed = habits.filter(h => h.daysDone >= (h.challengeLengthDays ?? 21)).length;

  return (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>
          Challenges{completed > 0 ? <Text style={styles.doneCount}> · {completed} done</Text> : null}
        </Text>
        {onToggleShowInToday && (
          <Pressable
            style={[styles.pinButton, showInToday && styles.pinButtonActive]}
            onPress={onToggleShowInToday}
            hitSlop={6}
          >
            <Ionicons name="pin" size={11} color={showInToday ? colors.accent : colors.textTertiary} />
            <Text style={[styles.pinButtonText, showInToday && styles.pinButtonTextActive]}>
              {showInToday ? 'In Today' : 'Show in Today'}
            </Text>
          </Pressable>
        )}
      </View>

      {habits.map(habit => {
        const length = habit.challengeLengthDays ?? 21;
        const clamped = Math.min(habit.daysDone, length);
        const complete = clamped >= length;
        return (
          <View key={habit.id} style={[styles.card, complete && styles.cardComplete]}>
            <View style={styles.titleRow}>
              <Ionicons
                name={habit.icon as ComponentProps<typeof Ionicons>['name']}
                size={16}
                color={complete ? colors.success : colors.accent}
              />
              <Text style={styles.title}>{habit.name}</Text>
              {complete && <Ionicons name="trophy" size={14} color={colors.success} />}
            </View>
            <Text style={styles.desc}>{challengeProgressLabel(clamped, length)}</Text>
            <View style={styles.progress}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${(clamped / length) * 100}%` },
                  complete && styles.progressFillComplete,
                ]}
              />
            </View>
            <Text style={styles.meta}>{challengeStreakLabel(clamped, length)}</Text>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  doneCount: { color: colors.success },
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
  },
  pinButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pinButtonText: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
  pinButtonTextActive: { color: colors.accent },
  card: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  cardComplete: { backgroundColor: colors.successSoft, borderColor: colors.success },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  title: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  desc: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  progress: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  progressFillComplete: { backgroundColor: colors.success },
  meta: { fontSize: 11, fontWeight: '600', color: colors.textTertiary, marginTop: 6 },
});
