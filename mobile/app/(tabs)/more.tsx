import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { scheduleTestNotification } from '@/notifications';

const ITEMS: { icon: ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { icon: 'person-outline', label: 'Account' },
  { icon: 'briefcase-outline', label: 'Workspace' },
  { icon: 'notifications-outline', label: 'Notifications' },
  { icon: 'cloud-outline', label: 'Data & sync' },
  { icon: 'log-out-outline', label: 'Sign out' },
];

// M0 spike (docs/mobile-app-plan.md): manual trigger to verify a scheduled
// notification survives the app being backgrounded/killed on a real device.
// Background the app (or kill it) right after tapping — remove once the real
// pomodoro timer schedules its own end-of-session notification the same way.
const TEST_DELAYS = [10, 60, 25 * 60];

export default function MoreScreen() {
  const [status, setStatus] = useState<string | null>(null);

  async function handleTestNotification(seconds: number): Promise<void> {
    try {
      await scheduleTestNotification(seconds);
      setStatus(`Scheduled for ${seconds}s from now — background the app now.`);
    } catch (err) {
      Alert.alert('Could not schedule notification', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>More</Text>
      </View>
      <View style={styles.list}>
        {ITEMS.map(item => (
          <View key={item.label} style={styles.row}>
            <Ionicons name={item.icon} size={19} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Dev: background notification spike</Text>
      <View style={styles.testRow}>
        {TEST_DELAYS.map(seconds => (
          <Pressable key={seconds} style={styles.testBtn} onPress={() => handleTestNotification(seconds)}>
            <Text style={styles.testBtnText}>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</Text>
          </Pressable>
        ))}
      </View>
      {status && <Text style={styles.status}>{status}</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingVertical: 10 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  list: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '500', color: colors.text },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  testRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
  testBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  testBtnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  status: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: 20, marginTop: 10 },
});
