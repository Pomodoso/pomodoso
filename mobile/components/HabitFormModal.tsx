import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  challengeProjectedEnd,
  fmtHabitTime,
  isValidYmd,
  MAX_CHALLENGE_LENGTH_DAYS,
  parseHabitTime,
  sameSchedule,
} from '@pomodoso/types';

import { DAY_LABELS } from '@/constants/habitDays';
import { HABIT_ICON_OPTIONS } from '@/constants/habitIcons';
import { colors } from '@/constants/theme';
import type { HabitInput, HabitWithProgress } from '@/hooks/useHabits';

interface HabitFormModalProps {
  visible: boolean;
  initialHabit: HabitWithProgress | null; // null = create mode
  onSave: (input: HabitInput) => void;
  onDelete: () => void;
  onCancel: () => void;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// Must not exceed useHabits.ts's computeStreak scan bound (3650) — a longer
// challenge would be accepted here but could never reach 100% since the
// streak calculation itself can't count past that many days.
// Shared with the projection horizon: a longer run cannot be projected, so
// it cannot be reasoned about either.

// Mirrors extension's habit form (HomeState.tsx): name, icon, boolean/counter
// kind, days-of-week toggle row defaulting to every day, no separate
// "weekdays" preset — just per-day toggles, same as the extension actually
// has (no dedicated weekdays button there either).
export function HabitFormModal({ visible, initialHabit, onSave, onDelete, onCancel }: HabitFormModalProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(HABIT_ICON_OPTIONS[0]);
  const [kind, setKind] = useState<'boolean' | 'counter'>('boolean');
  const [goal, setGoal] = useState('');
  const [unit, setUnit] = useState('');
  const [unitAmount, setUnitAmount] = useState('');
  const [timeUnit, setTimeUnit] = useState(false);
  const [timeGoal, setTimeGoal] = useState('15:00');
  const [timeStep, setTimeStep] = useState('1:00');
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [isChallenge, setIsChallenge] = useState(false);
  const [challengeLengthDays, setChallengeLengthDays] = useState('21');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (initialHabit) {
      setName(initialHabit.name);
      setIcon(initialHabit.icon);
      setKind(initialHabit.kind);
      setGoal(initialHabit.goal?.toString() ?? '');
      setUnit(initialHabit.unit ?? '');
      setUnitAmount(initialHabit.unitAmount?.toString() ?? '');
      setTimeUnit(initialHabit.timeUnit);
      setTimeGoal(initialHabit.timeUnit ? fmtHabitTime(initialHabit.goal ?? 0) : '15:00');
      setTimeStep(initialHabit.timeUnit ? fmtHabitTime(initialHabit.unitAmount || 60) : '1:00');
      setEndDate(initialHabit.endDate ?? '');
      setDays(initialHabit.days.length === 0 ? ALL_DAYS : initialHabit.days);
      setIsChallenge((initialHabit.challengeLengthDays ?? 0) > 0);
      setChallengeLengthDays((initialHabit.challengeLengthDays ?? 21).toString());
    } else {
      setName('');
      setIcon(HABIT_ICON_OPTIONS[0]);
      setKind('boolean');
      setGoal('');
      setUnit('');
      setUnitAmount('');
      setTimeUnit(false);
      setTimeGoal('15:00');
      setTimeStep('1:00');
      setEndDate('');
      setDays(ALL_DAYS);
      setIsChallenge(false);
      setChallengeLengthDays('21');
    }
    setConfirmingDelete(false);
  }, [visible, initialHabit]);

  function toggleDay(day: number): void {
    setDays(prev => {
      // [] is the canonical "every day" sentinel (matching the extension),
      // not "no days" — deselecting the last remaining day would silently
      // flip the habit from "scheduled nowhere" to "scheduled everywhere".
      // Refuse the last deselection instead; "reset to every day" already
      // covers the intentional path back to [].
      if (prev.includes(day)) return prev.length > 1 ? prev.filter(d => d !== day) : prev;
      return [...prev, day].sort((a, b) => a - b);
    });
  }

  const isTime = kind === 'counter' && timeUnit;
  const parsedGoal = isTime ? parseHabitTime(timeGoal) : parseInt(goal, 10);
  const goalValid = kind === 'boolean' || (!isNaN(parsedGoal) && parsedGoal > 0);
  const trimmedEnd = endDate.trim();
  const endDateValid = trimmedEnd === '' || isValidYmd(trimmedEnd);

  const parsedChallengeLength = parseInt(challengeLengthDays, 10);
  const challengeLengthValid =
    !isChallenge || (!isNaN(parsedChallengeLength) && parsedChallengeLength > 0 && parsedChallengeLength <= MAX_CHALLENGE_LENGTH_DAYS);

  // The end date closes the habit, so one before the run can finish makes the
  // challenge unwinnable. Same check as the extension's form: projected from
  // the run this edit keeps, or from today for a new or restarted one.
  const today = new Date().toLocaleDateString('en-CA');
  const keepsRun = Boolean(
    initialHabit?.challenge
    && initialHabit.challengeLengthDays === parsedChallengeLength
    && sameSchedule(initialHabit.days, days.length === 7 ? [] : days),
  );
  const runStart = keepsRun ? initialHabit!.challenge!.state.startedAt : today;
  const scheduledOn = (date: string): boolean =>
    days.length === 7 || days.includes((new Date(date + 'T12:00:00').getDay() + 6) % 7);
  const projectedEnd = isChallenge && challengeLengthValid
    ? challengeProjectedEnd(runStart, parsedChallengeLength, scheduledOn, keepsRun ? initialHabit!.challenge!.state.skippedDays.length : 0)
    : null;
  const endDateCutsChallenge = Boolean(projectedEnd && endDateValid && trimmedEnd && trimmedEnd < projectedEnd);
  // No projection means the run can't be shown to fit inside the lookahead
  // (a long challenge on a sparse schedule), so no end date can be checked
  // against it. Refused, as the extension's form does, rather than letting a
  // missing estimate switch the check off.
  const projectionUnavailable = isChallenge && challengeLengthValid && projectedEnd === null;
  const canSave = Boolean(name.trim()) && goalValid && challengeLengthValid && endDateValid
    && !endDateCutsChallenge && !projectionUnavailable;

  function handleSave(): void {
    const trimmed = name.trim();
    if (!trimmed || !canSave) return;
    const parsedUnitAmount = parseInt(unitAmount, 10);
    onSave({
      name: trimmed,
      icon,
      kind,
      // goalValid already guarantees parsedGoal > 0 for counter habits — a
      // 0 or missing goal would make isDone() (useHabits.ts) true at any
      // count via its `?? 0` fallback, marking the habit complete before
      // any progress is logged.
      goal: kind === 'counter' ? parsedGoal : null,
      unit: kind === 'counter' && !isTime && unit.trim() ? unit.trim() : null,
      unitAmount: isTime
        ? (parseHabitTime(timeStep) || 60)
        : kind === 'counter' && !isNaN(parsedUnitAmount) ? parsedUnitAmount : null,
      timeUnit: isTime,
      endDate: trimmedEnd || null,
      days,
      challengeLengthDays: isChallenge ? parsedChallengeLength : null,
    });
  }

  function handleDelete(): void {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.prompt}>{initialHabit ? 'Edit habit' : 'New habit'}</Text>

            <TextInput
              style={styles.input}
              placeholder="Habit name"
              placeholderTextColor={colors.textTertiary}
              value={name}
              onChangeText={setName}
              autoFocus
            />

            <Text style={styles.label}>Icon</Text>
            <View style={styles.iconRow}>
              {HABIT_ICON_OPTIONS.map(opt => (
                <Pressable key={opt} style={[styles.iconBtn, icon === opt && styles.iconBtnActive]} onPress={() => setIcon(opt)}>
                  <Ionicons
                    name={opt as ComponentProps<typeof Ionicons>['name']}
                    size={18}
                    color={icon === opt ? colors.accent : colors.textTertiary}
                  />
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Type</Text>
            <View style={styles.kindRow}>
              <Pressable style={[styles.kindBtn, kind === 'boolean' && styles.kindBtnActive]} onPress={() => setKind('boolean')}>
                <Text style={[styles.kindBtnText, kind === 'boolean' && styles.kindBtnTextActive]}>Checkbox</Text>
              </Pressable>
              <Pressable style={[styles.kindBtn, kind === 'counter' && styles.kindBtnActive]} onPress={() => setKind('counter')}>
                <Text style={[styles.kindBtnText, kind === 'counter' && styles.kindBtnTextActive]}>Counter</Text>
              </Pressable>
            </View>

            {kind === 'counter' && (
              <View style={styles.kindRow}>
                <Pressable style={[styles.kindBtn, !timeUnit && styles.kindBtnActive]} onPress={() => setTimeUnit(false)}>
                  <Text style={[styles.kindBtnText, !timeUnit && styles.kindBtnTextActive]}>Number</Text>
                </Pressable>
                <Pressable style={[styles.kindBtn, timeUnit && styles.kindBtnActive]} onPress={() => setTimeUnit(true)}>
                  <Text style={[styles.kindBtnText, timeUnit && styles.kindBtnTextActive]}>Time</Text>
                </Pressable>
              </View>
            )}

            {isTime && (
              <View style={styles.counterRow}>
                <View style={styles.counterInput}>
                  <Text style={styles.fieldHint}>Daily goal (mm:ss)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="15:00"
                    placeholderTextColor={colors.textTertiary}
                    value={timeGoal}
                    onChangeText={setTimeGoal}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
                <View style={styles.counterInput}>
                  <Text style={styles.fieldHint}>+/− step (mm:ss)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="1:00"
                    placeholderTextColor={colors.textTertiary}
                    value={timeStep}
                    onChangeText={setTimeStep}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
            )}

            {kind === 'counter' && !isTime && (
              <View style={styles.counterRow}>
                <TextInput
                  style={[styles.input, styles.counterInput]}
                  placeholder="Goal (required)"
                  placeholderTextColor={colors.textTertiary}
                  value={goal}
                  onChangeText={setGoal}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[styles.input, styles.counterInput]}
                  placeholder="Amount/step"
                  placeholderTextColor={colors.textTertiary}
                  value={unitAmount}
                  onChangeText={setUnitAmount}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[styles.input, styles.counterInput]}
                  placeholder="Unit (ml)"
                  placeholderTextColor={colors.textTertiary}
                  value={unit}
                  onChangeText={setUnit}
                />
              </View>
            )}

            <View style={styles.daysHeader}>
              <Text style={styles.label}>Days</Text>
              {days.length < 7 && (
                <Pressable onPress={() => setDays(ALL_DAYS)}>
                  <Text style={styles.resetText}>Reset to every day</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.daysRow}>
              {DAY_LABELS.map((label, i) => {
                const active = days.includes(i);
                return (
                  <Pressable key={i} style={[styles.dayBtn, active && styles.dayBtnActive]} onPress={() => toggleDay(i)}>
                    <Text style={[styles.dayBtnText, active && styles.dayBtnTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {days.length === 7 && <Text style={styles.everyDayHint}>Every day. Tap a day to customize.</Text>}

            <View style={styles.daysHeader}>
              <Text style={[styles.label, { marginTop: 18 }]}>End date (optional)</Text>
              <Pressable onPress={() => setEndDate(trimmedEnd ? '' : today)}>
                <Text style={[styles.resetText, { marginTop: 18 }]}>{trimmedEnd ? 'Clear' : 'End today'}</Text>
              </Pressable>
            </View>
            <TextInput
              style={[styles.input, !endDateValid && styles.inputError]}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              value={endDate}
              onChangeText={setEndDate}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
            />
            {trimmedEnd !== '' && endDateValid && !endDateCutsChallenge && (
              <Text style={[styles.everyDayHint, { marginTop: -8 }]}>Stops appearing in Today after this date. History is kept.</Text>
            )}
            {endDateCutsChallenge && (
              <Text style={[styles.everyDayHint, styles.challengeLengthError, { marginTop: -8 }]}>
                The challenge needs until {projectedEnd}. Move the end date or shorten the challenge.
              </Text>
            )}

            <View style={styles.challengeHeader}>
              <Text style={styles.label}>21-day challenge</Text>
              <Switch value={isChallenge} onValueChange={setIsChallenge} trackColor={{ true: colors.accent }} />
            </View>
            {isChallenge && (
              <>
                <View style={[styles.counterRow, { alignItems: 'center' }]}>
                  <TextInput
                    style={[styles.input, styles.counterInput, { flex: 0, width: 70, marginBottom: 0 }]}
                    value={challengeLengthDays}
                    onChangeText={setChallengeLengthDays}
                    keyboardType="number-pad"
                  />
                  <Text style={styles.everyDayHint}>days</Text>
                </View>
                <Text style={styles.everyDayHint}>
                  Shows a progress card counting today&apos;s active streak toward the goal. Missing a scheduled day resets it.
                </Text>
                {projectionUnavailable && (
              <Text style={[styles.everyDayHint, styles.challengeLengthError]}>
                This challenge can&apos;t finish within ten years on this schedule. Shorten it or add days.
              </Text>
            )}
            {!challengeLengthValid && (
                  <Text style={[styles.everyDayHint, styles.challengeLengthError]}>
                    Enter a number from 1 to {MAX_CHALLENGE_LENGTH_DAYS}.
                  </Text>
                )}
              </>
            )}

            <Pressable
              style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canSave}
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </Pressable>

            {initialHabit && (
              <Pressable style={styles.deleteBtn} onPress={handleDelete}>
                <Text style={styles.deleteBtnText}>{confirmingDelete ? 'Tap again to delete' : 'Delete habit'}</Text>
              </Pressable>
            )}

            <Pressable style={styles.cancel} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '85%',
  },
  prompt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: 14,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  kindRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  kindBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  kindBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  kindBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.textSecondary },
  kindBtnTextActive: { color: colors.accent },
  counterRow: { flexDirection: 'row', gap: 8 },
  counterInput: { flex: 1 },
  fieldHint: { fontSize: 11, color: colors.textTertiary, marginBottom: 4 },
  inputError: { borderColor: colors.accent },
  daysHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  resetText: { fontSize: 11, color: colors.textTertiary },
  daysRow: { flexDirection: 'row', gap: 4 },
  dayBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  dayBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  dayBtnText: { fontSize: 12, fontWeight: '700', color: colors.textTertiary },
  dayBtnTextActive: { color: colors.accent },
  everyDayHint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
  challengeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  challengeLengthError: { color: colors.accent },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 18 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  deleteBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  deleteBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.accent },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
