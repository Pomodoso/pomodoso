import { Ionicons } from '@expo/vector-icons';
import { isValidYmd, taskScheduleLabel, taskSchedulePresets } from '@pomodoso/types';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

// The day a task moves into Today. Mirrors the extension's ScheduleField
// (TaskDetailState.tsx): two quick picks and any other day, typed as
// YYYY-MM-DD like the recurrence form, since mobile has no date picker.
export function ScheduleEditor({ value, today, onChange }: {
  value: string | null;
  today: string;
  onChange: (date: string | null) => void;
}): React.JSX.Element {
  const { tomorrow, nextMonday } = taskSchedulePresets(today);
  const [custom, setCustom] = useState('');
  const trimmed = custom.trim();
  const customValid = isValidYmd(trimmed) && trimmed > today;

  const chip = (label: string, date: string): React.JSX.Element => {
    const active = value === date;
    return (
      <Pressable key={label} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(date)}>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Ionicons name="calendar-outline" size={18} color={value ? colors.info : colors.textTertiary} />
        {value ? (
          <Text style={styles.text}>
            Moves into Today on {taskScheduleLabel(value, today)}
            {taskScheduleLabel(value, today) !== value && <Text style={styles.faint}> · {value}</Text>}
          </Text>
        ) : (
          <Text style={styles.textMuted}>Not scheduled</Text>
        )}
        {value && (
          <Pressable onPress={() => onChange(null)} hitSlop={8}>
            <Text style={styles.remove}>Remove</Text>
          </Pressable>
        )}
      </View>
      <View style={styles.chips}>
        {chip('Tomorrow', tomorrow)}
        {nextMonday !== tomorrow && chip('Next Monday', nextMonday)}
      </View>
      <View style={styles.customRow}>
        <TextInput
          style={[styles.input, trimmed !== '' && !customValid && styles.inputError]}
          value={custom}
          onChangeText={setCustom}
          placeholder="Other day: YYYY-MM-DD"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          maxLength={10}
        />
        <Pressable
          style={[styles.setBtn, !customValid && { opacity: 0.5 }]}
          disabled={!customValid}
          onPress={() => { onChange(trimmed); setCustom(''); }}
        >
          <Text style={styles.setBtnText}>Set</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  text: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  textMuted: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.textTertiary },
  faint: { fontWeight: '400', color: colors.textTertiary },
  remove: { fontSize: 13, fontWeight: '600', color: colors.accent },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontSize: 12.5, color: colors.textSecondary },
  chipTextActive: { color: colors.accent, fontWeight: '700' },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13.5,
    color: colors.text,
  },
  inputError: { borderColor: colors.accent },
  setBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 16 },
  setBtnText: { fontSize: 13, fontWeight: '700', color: colors.surface },
});
