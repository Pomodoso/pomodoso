import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useSettings } from '@/hooks/useSettings';

// Ports extension's SettingsState.tsx TimerDefaultsPage — same preset
// values, same "pill + custom minutes" pattern.

interface DurationPickerProps {
  label: string;
  presets: { label: string; seconds: number }[];
  value: number;
  onChange: (seconds: number) => void;
}

function DurationPicker({ label, presets, value, onChange }: DurationPickerProps): React.JSX.Element {
  const isPreset = presets.some(p => p.seconds === value);
  const [customMin, setCustomMin] = useState(String(Math.round(value / 60)));

  // useState's initializer only runs on mount — without this, a `value` that
  // changes for a reason other than this component's own onChange (e.g. the
  // settings live-query catching up after mount) wouldn't be reflected here.
  useEffect(() => {
    setCustomMin(String(Math.round(value / 60)));
  }, [value]);

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

export default function TimerDefaultsScreen(): React.JSX.Element {
  const { settings, update } = useSettings();
  const [longEveryStr, setLongEveryStr] = useState(String(settings.longBreakEvery));
  const [goalStr, setGoalStr] = useState(String(settings.dailyGoal));

  useEffect(() => {
    setLongEveryStr(String(settings.longBreakEvery));
  }, [settings.longBreakEvery]);

  useEffect(() => {
    setGoalStr(String(settings.dailyGoal));
  }, [settings.dailyGoal]);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Timer defaults</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
        <View style={[styles.inlineRow, { marginBottom: 18 }]}>
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
});
