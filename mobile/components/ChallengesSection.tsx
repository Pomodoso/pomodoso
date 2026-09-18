import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  challengeCanKeepGoing,
  challengeDaysShown,
  challengeEarnsBadge,
  challengeNeedsDecision,
  challengeProgressLabel,
  challengeSkipsLeft,
  challengeStreakLabel,
} from '@pomodoso/types';

import { colors } from '@/constants/theme';
import type { HabitWithProgress } from '@/hooks/useHabits';

export interface ChallengeActions {
  onKeepGoing: (habitId: string) => void;
  onStartOver: (habitId: string) => void;
  onKeepAsHabit: (habitId: string) => void;
}

/** "Tuesday", or "Tuesday and Wednesday", or "3 days". */
function missedDaysLabel(dates: string[]): string {
  const dayName = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  if (dates.length === 1) return dayName(dates[0]!);
  if (dates.length === 2) return `${dayName(dates[0]!)} and ${dayName(dates[1]!)}`;
  return `${dates.length} days`;
}

function CardAction({ label, hint, tone, onPress }: {
  label: string;
  hint?: string;
  tone: 'primary' | 'quiet';
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.action, tone === 'primary' && styles.actionPrimary]} onPress={onPress}>
      <Text style={[styles.actionText, tone === 'primary' && styles.actionTextPrimary]}>{label}</Text>
      {hint && (
        <Text style={[styles.actionHint, tone === 'primary' && styles.actionHintPrimary]}>{hint}</Text>
      )}
    </Pressable>
  );
}

interface ChallengesSectionProps {
  habits: HabitWithProgress[];
  /** Omitted on Home, where the cards are a read-only summary — the decisions
   *  live on the Habits tab so one stray tap can't end a 20-day run. */
  actions?: ChallengeActions;
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
export function ChallengesSection({ habits, actions, showInToday, onToggleShowInToday }: ChallengesSectionProps) {
  if (habits.length === 0) return null;
  const completed = habits.filter(h => h.challenge?.progress.complete).length;

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
        const run = habit.challenge;
        if (!run) return null;
        const length = run.state.lengthDays;
        const clamped = challengeDaysShown(run.progress.daysDone, length);
        const complete = run.progress.complete;
        const needsDecision = challengeNeedsDecision(run.progress);
        const canKeepGoing = challengeCanKeepGoing(run.state, run.progress.missedDays);
        const skipsLeft = challengeSkipsLeft(run.state);
        const earnsBadge = challengeEarnsBadge(run.state);
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
            <Text style={styles.desc}>
              {needsDecision
                ? `You missed ${missedDaysLabel(run.progress.missedDays)}.`
                : challengeProgressLabel(clamped, length)}
            </Text>
            <View style={styles.progress}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${(clamped / length) * 100}%` },
                  complete && styles.progressFillComplete,
                ]}
              />
            </View>
            <Text style={styles.meta}>
              {complete && run.state.completedAt
                ? `Finished ${new Date(run.state.completedAt + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  + (run.state.skippedDays.length > 0 ? ` · ${run.state.skippedDays.length} skipped` : '')
                : challengeStreakLabel(clamped, length)}
            </Text>

            {complete && actions && (
              <View style={styles.actionRow}>
                <CardAction tone="primary" label="Go again" onPress={() => actions.onStartOver(habit.id)} />
                <CardAction tone="quiet" label="Keep as habit" onPress={() => actions.onKeepAsHabit(habit.id)} />
              </View>
            )}

            {!complete && needsDecision && actions && (
              <View style={styles.actionRow}>
                {canKeepGoing ? (
                  <CardAction
                    tone="primary"
                    label="Keep going"
                    hint={earnsBadge
                      ? `${skipsLeft} skip${skipsLeft === 1 ? '' : 's'} left · gives up the badge`
                      : `${skipsLeft} skip${skipsLeft === 1 ? '' : 's'} left`}
                    onPress={() => actions.onKeepGoing(habit.id)}
                  />
                ) : (
                  <Text style={styles.noSkips}>No skips left — this run has to start over.</Text>
                )}
                <CardAction
                  tone={canKeepGoing ? 'quiet' : 'primary'}
                  label="Start over"
                  {...(canKeepGoing && earnsBadge ? { hint: 'keeps the badge in play' } : {})}
                  onPress={() => actions.onStartOver(habit.id)}
                />
              </View>
            )}
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
  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  action: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
  },
  actionPrimary: { borderColor: colors.accent, backgroundColor: colors.accent },
  actionText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  actionTextPrimary: { color: '#fff' },
  actionHint: { fontSize: 9, color: colors.textTertiary, marginTop: 1, textAlign: 'center' },
  actionHintPrimary: { color: '#fff', opacity: 0.85 },
  noSkips: { flex: 1, fontSize: 10, color: colors.textTertiary, alignSelf: 'center', lineHeight: 14 },
});
