import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DAY_LABELS } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import type { AppSettings } from '@/hooks/useSettings';
import { useSettings } from '@/hooks/useSettings';

// Ports extension's TimerDefaultsPage + GeneralPage (SettingsState.tsx) —
// same preset values, same "pill + custom minutes" pattern, minus Timezone
// (mobile has no per-workspace-timezone concept, local time only).

interface DurationPickerProps {
  label: string;
  presets: { label: string; seconds: number }[];
  value: number;
  onChange: (seconds: number) => void;
}

function DurationPicker({ label, presets, value, onChange }: DurationPickerProps): React.JSX.Element {
  const isPreset = presets.some(p => p.seconds === value);
  const [customMin, setCustomMin] = useState(String(Math.round(value / 60)));

  function handleCustomChange(raw: string): void {
    setCustomMin(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) onChange(n * 60);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.pillRow}>
        {presets.map(p => (
          <Pressable
            key={p.label}
            style={[styles.pill, value === p.seconds && styles.pillActive]}
            onPress={() => {
              onChange(p.seconds);
              setCustomMin(String(Math.round(p.seconds / 60)));
            }}
          >
            <Text style={[styles.pillText, value === p.seconds && styles.pillTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
        <TextInput
          style={[styles.customInput, !isPreset && styles.pillActive]}
          value={customMin}
          onChangeText={handleCustomChange}
          keyboardType="number-pad"
          placeholder="custom"
          placeholderTextColor={colors.textTertiary}
        />
        <Text style={styles.unitLabel}>min</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { settings, update } = useSettings();
  const [longEveryStr, setLongEveryStr] = useState(String(settings.longBreakEvery));
  const [goalStr, setGoalStr] = useState(String(settings.dailyGoal));

  function handleLongEveryChange(raw: string): void {
    setLongEveryStr(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) update('longBreakEvery', n);
  }

  function handleGoalChange(raw: string): void {
    setGoalStr(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) update('dailyGoal', n);
  }

  function toggleWorkDay(day: number): void {
    const active = settings.workDays.includes(day);
    const next = active ? settings.workDays.filter(d => d !== day) : [...settings.workDays, day].sort((a, b) => a - b);
    update('workDays', next);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Timer defaults</Text>

        <DurationPicker
          label="Focus"
          presets={[
            { label: '15m', seconds: 15 * 60 },
            { label: '25m', seconds: 25 * 60 },
            { label: '30m', seconds: 30 * 60 },
          ]}
          value={settings.focusSeconds}
          onChange={s => update('focusSeconds', s)}
        />

        <DurationPicker
          label="Short break"
          presets={[
            { label: '5m', seconds: 5 * 60 },
            { label: '10m', seconds: 10 * 60 },
          ]}
          value={settings.shortBreakSeconds}
          onChange={s => update('shortBreakSeconds', s)}
        />

        <DurationPicker
          label="Long break"
          presets={[
            { label: '10m', seconds: 10 * 60 },
            { label: '15m', seconds: 15 * 60 },
            { label: '20m', seconds: 20 * 60 },
          ]}
          value={settings.longBreakSeconds}
          onChange={s => update('longBreakSeconds', s)}
        />
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>After every</Text>
          <TextInput
            style={styles.smallInput}
            value={longEveryStr}
            onChangeText={handleLongEveryChange}
            keyboardType="number-pad"
          />
          <Text style={styles.inlineLabel}>pomodoros</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Daily goal</Text>
          <View style={styles.inlineRow}>
            <TextInput style={styles.smallInput} value={goalStr} onChangeText={handleGoalChange} keyboardType="number-pad" />
            <Text style={styles.inlineLabel}>pomodoros per day</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>General</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Max priority tasks</Text>
          <View style={styles.pillRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable
                key={n}
                style={[styles.numBox, settings.maxPriorities === n && styles.pillActive]}
                onPress={() => update('maxPriorities', n)}
              >
                <Text style={[styles.pillText, settings.maxPriorities === n && styles.pillTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Max tasks shown in Today&apos;s priorities. Default is 3.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Week starts on</Text>
          <View style={styles.pillRow}>
            {([0, 6] as const).map(day => (
              <Pressable
                key={day}
                style={[styles.pill, settings.weekStart === day && styles.pillActive]}
                onPress={() => update('weekStart', day as AppSettings['weekStart'])}
              >
                <Text style={[styles.pillText, settings.weekStart === day && styles.pillTextActive]}>
                  {day === 0 ? 'Monday' : 'Sunday'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Used for &quot;this week&quot; in history.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Work days</Text>
          <View style={styles.pillRow}>
            {DAY_LABELS.map((label, i) => (
              <Pressable
                key={i}
                style={[styles.dayBox, settings.workDays.includes(i) && styles.pillActive]}
                onPress={() => toggleWorkDay(i)}
              >
                <Text style={[styles.pillText, settings.workDays.includes(i) && styles.pillTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 22,
    marginBottom: 12,
  },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  pillText: { fontSize: 12.5, fontWeight: '500', color: colors.textTertiary },
  pillTextActive: { fontWeight: '700', color: colors.surface },
  customInput: {
    width: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 12.5,
    color: colors.text,
  },
  unitLabel: { fontSize: 11, color: colors.textTertiary },
  numBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  inlineLabel: { fontSize: 12.5, color: colors.textTertiary },
  smallInput: {
    width: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 13,
    textAlign: 'center',
    color: colors.text,
  },
  hint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
});
