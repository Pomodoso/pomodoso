import type { RecurrenceFreq, RecurrenceRule } from '@pomodoso/types';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';
import { formatRecurrenceLabel } from '@/utils/recurrence';

interface RecurrenceFormModalProps {
  visible: boolean;
  initialRule: RecurrenceRule | null; // null = not recurring
  onSave: (rule: RecurrenceRule | null) => void;
  onCancel: () => void;
}

const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const FREQ_UNIT: Record<RecurrenceFreq, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

// RecurrenceRule.weekdays is 0=Sun..6=Sat (JS Date#getDay(), see
// utils/recurrence.ts) — a DIFFERENT convention from constants/habitDays.ts's
// 0=Mon..6=Sun, so this label set is local to this form, not shared.
const SUN_FIRST_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function todayYmd(): string {
  return new Date().toLocaleDateString('en-CA');
}

// Text fields, not a date/time picker (see file header) — validate the
// contracts recurrence.ts's date math assumes, since an unparseable
// startDate silently makes shouldOccurOn refuse every date (string
// comparison against "date < rule.startDate" never true) and an
// out-of-range time silently skews shouldBeInTodayNow's cutoff.
function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === s;
}
function isValidTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Ports extension's recurrence form (TaskDetailState.tsx, ~lines 167-259 &
// 407-490) — same fields and defaults-from-today behavior, minus a native
// date-picker dependency the codebase doesn't have yet: start/end date are
// plain YYYY-MM-DD text fields instead of a calendar widget.
export function RecurrenceFormModal({ visible, initialRule, onSave, onCancel }: RecurrenceFormModalProps) {
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const [interval, setIntervalStr] = useState('1');
  const [carryOver, setCarryOver] = useState(true);
  const [weekdays, setWeekdays] = useState<number[]>([new Date().getDay()]);
  const [monthDay, setMonthDay] = useState(String(new Date().getDate()));
  const [yearMonth, setYearMonth] = useState(String(new Date().getMonth() + 1));
  const [yearDay, setYearDay] = useState(String(new Date().getDate()));
  const [allDay, setAllDay] = useState(true);
  const [time, setTime] = useState('');
  const [startDate, setStartDate] = useState(todayYmd());
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!visible) return;
    const r = initialRule;
    setFreq(r?.freq ?? 'weekly');
    setIntervalStr(String(r?.interval ?? 1));
    setCarryOver(r?.carryOver ?? true);
    setWeekdays(r?.weekdays ?? [new Date().getDay()]);
    setMonthDay(String(r?.monthDay ?? new Date().getDate()));
    setYearMonth(String(r?.yearMonth ?? new Date().getMonth() + 1));
    setYearDay(String(r?.yearDay ?? new Date().getDate()));
    setAllDay(r ? !r.time : true);
    setTime(r?.time ?? '');
    setStartDate(r?.startDate ?? todayYmd());
    setHasEnd(!!r?.endDate);
    setEndDate(r?.endDate ?? '');
  }, [visible, initialRule]);

  function toggleWeekday(day: number): void {
    setWeekdays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  function clampInt(raw: string, min: number, max: number, fallback: number): number {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  const intervalN = clampInt(interval, 1, 99, 1);
  const weekdaysValid = freq !== 'weekly' || weekdays.length > 0;
  const startDateValid = isValidYmd(startDate.trim());
  const timeValid = allDay || isValidTime(time.trim());
  const endDateValid = !hasEnd || isValidYmd(endDate.trim());
  const dateRangeValid = !hasEnd || !startDateValid || !endDateValid || endDate.trim() >= startDate.trim();
  const formValid = weekdaysValid && startDateValid && timeValid && endDateValid && dateRangeValid;

  function buildRule(): RecurrenceRule {
    return {
      freq,
      ...(intervalN > 1 && { interval: intervalN }),
      ...(carryOver === false && { carryOver: false }),
      ...(freq === 'weekly' && { weekdays }),
      ...(freq === 'monthly' && { monthDay: clampInt(monthDay, 1, 31, 1) }),
      ...(freq === 'yearly' && { yearMonth: clampInt(yearMonth, 1, 12, 1), yearDay: clampInt(yearDay, 1, 31, 1) }),
      time: allDay ? null : time.trim(),
      startDate: startDate.trim(),
      endDate: hasEnd ? endDate.trim() : null,
    };
  }

  function handleSave(): void {
    if (!formValid) return;
    onSave(buildRule());
  }

  function handleRemove(): void {
    onSave(null);
  }

  const previewRule = formValid ? buildRule() : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.prompt}>{initialRule ? 'Edit recurrence' : 'Make recurring'}</Text>

            <Text style={styles.label}>Repeats</Text>
            <View style={styles.freqRow}>
              {FREQ_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  style={[styles.freqBtn, freq === opt.value && styles.freqBtnActive]}
                  onPress={() => setFreq(opt.value)}
                >
                  <Text style={[styles.freqBtnText, freq === opt.value && styles.freqBtnTextActive]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.inlineRow}>
              <Text style={styles.inlineLabel}>Every</Text>
              <TextInput style={styles.smallInput} value={interval} onChangeText={setIntervalStr} keyboardType="number-pad" />
              <Text style={styles.inlineLabel}>
                {FREQ_UNIT[freq]}
                {intervalN > 1 ? 's' : ''}
              </Text>
            </View>

            {freq === 'weekly' && (
              <View style={styles.field}>
                <Text style={styles.label}>On</Text>
                <View style={styles.dayRow}>
                  {SUN_FIRST_LABELS.map((label, i) => {
                    const active = weekdays.includes(i);
                    return (
                      <Pressable key={i} style={[styles.dayBtn, active && styles.dayBtnActive]} onPress={() => toggleWeekday(i)}>
                        <Text style={[styles.dayBtnText, active && styles.dayBtnTextActive]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!weekdaysValid && <Text style={styles.errorText}>Pick at least one day.</Text>}
              </View>
            )}

            {freq === 'monthly' && (
              <View style={styles.inlineRow}>
                <Text style={styles.inlineLabel}>Day</Text>
                <TextInput style={styles.smallInput} value={monthDay} onChangeText={setMonthDay} keyboardType="number-pad" />
                <Text style={styles.inlineLabel}>of the month</Text>
              </View>
            )}

            {freq === 'yearly' && (
              <View style={styles.inlineRow}>
                <Text style={styles.inlineLabel}>Month</Text>
                <TextInput style={styles.smallInput} value={yearMonth} onChangeText={setYearMonth} keyboardType="number-pad" />
                <Text style={styles.inlineLabel}>Day</Text>
                <TextInput style={styles.smallInput} value={yearDay} onChangeText={setYearDay} keyboardType="number-pad" />
              </View>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>All day</Text>
              <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: colors.accent }} />
            </View>
            {!allDay && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textTertiary}
                  value={time}
                  onChangeText={setTime}
                />
                {!timeValid && <Text style={styles.errorText}>Time must be HH:MM, 24-hour (e.g. 09:30).</Text>}
              </>
            )}

            <Text style={styles.label}>Starts</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              value={startDate}
              onChangeText={setStartDate}
            />
            {!startDateValid && <Text style={styles.errorText}>Enter a valid date as YYYY-MM-DD.</Text>}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Has an end date</Text>
              <Switch value={hasEnd} onValueChange={setHasEnd} trackColor={{ true: colors.accent }} />
            </View>
            {hasEnd && (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  value={endDate}
                  onChangeText={setEndDate}
                />
                {!endDateValid && <Text style={styles.errorText}>Enter a valid date as YYYY-MM-DD.</Text>}
                {endDateValid && !dateRangeValid && <Text style={styles.errorText}>End date can&apos;t be before the start date.</Text>}
              </>
            )}

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Carry over if missed</Text>
                <Text style={styles.switchHint}>Stays in Today until done, instead of resetting each day.</Text>
              </View>
              <Switch value={carryOver} onValueChange={setCarryOver} trackColor={{ true: colors.accent }} />
            </View>

            {previewRule && <Text style={styles.previewText}>{formatRecurrenceLabel(previewRule)}</Text>}

            <Pressable style={[styles.saveBtn, !formValid && styles.saveBtnDisabled]} onPress={handleSave} disabled={!formValid}>
              <Text style={styles.saveBtnText}>Save</Text>
            </Pressable>

            {initialRule && (
              <Pressable style={styles.removeBtn} onPress={handleRemove}>
                <Text style={styles.removeBtnText}>Remove recurrence</Text>
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
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  field: { marginBottom: 14 },
  freqRow: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  freqBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  freqBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  freqBtnText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  freqBtnTextActive: { color: colors.accent },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  inlineLabel: { fontSize: 13, color: colors.textSecondary },
  smallInput: {
    width: 52,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 13,
    textAlign: 'center',
    color: colors.text,
  },
  dayRow: { flexDirection: 'row', gap: 4 },
  dayBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'transparent' },
  dayBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  dayBtnText: { fontSize: 12, fontWeight: '700', color: colors.textTertiary },
  dayBtnTextActive: { color: colors.accent },
  errorText: { fontSize: 11, color: colors.accent, marginTop: 6 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.text,
    marginBottom: 14,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  switchLabel: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  switchHint: { fontSize: 11, color: colors.textTertiary, marginTop: 2, maxWidth: 240 },
  previewText: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4, marginBottom: 4 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  removeBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  removeBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.accent },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
