import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DAY_LABELS } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import type { AppSettings } from '@/hooks/useSettings';
import { useSettings } from '@/hooks/useSettings';

// Ports extension's SettingsState.tsx GeneralPage, minus Timezone — mobile
// has no per-workspace-timezone concept, local time only.
export default function GeneralSettingsScreen(): React.JSX.Element {
  const { settings, update } = useSettings();

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
        <Text style={styles.headerTitle}>General</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
  hint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
});
