import { Ionicons } from '@expo/vector-icons';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { db } from '@/db/client';
import { habits, pomodoroSession, task } from '@/db/schema';
import { scheduleTestNotification } from '@/notifications';

const TEST_DELAYS = [10, 60, 25 * 60];

function useNotificationPermission() {
  const [granted, setGranted] = useState<boolean | null>(null);

  async function refresh(): Promise<void> {
    const result = await Notifications.getPermissionsAsync();
    setGranted(result.granted);
  }

  useEffect(() => {
    refresh();
    // Re-check on foreground — the only way permission changes is the user
    // going to OS Settings and back, which always passes through this.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, []);

  return granted;
}

export default function MoreScreen() {
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const notificationsGranted = useNotificationPermission();
  const { data: allTasks } = useLiveQuery(db.select().from(task));
  const { data: allHabits } = useLiveQuery(db.select().from(habits));
  const { data: completedSessions } = useLiveQuery(
    db.select().from(pomodoroSession).where(eq(pomodoroSession.status, 'completed')),
  );

  async function handleTestNotification(seconds: number): Promise<void> {
    try {
      await scheduleTestNotification(seconds);
      setTestStatus(`Scheduled for ${seconds}s from now — background the app now.`);
    } catch (err) {
      Alert.alert('Could not schedule notification', err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>More</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.list}>
          <View style={[styles.row, styles.rowDisabled]}>
            <Ionicons name="person-outline" size={19} color={colors.textTertiary} />
            <Text style={[styles.rowLabel, styles.rowLabelDisabled]}>Account</Text>
            <Text style={styles.soonBadge}>Coming soon</Text>
          </View>
          <View style={[styles.row, styles.rowDisabled]}>
            <Ionicons name="briefcase-outline" size={19} color={colors.textTertiary} />
            <Text style={[styles.rowLabel, styles.rowLabelDisabled]}>Workspace</Text>
            <Text style={styles.rowValue}>Work</Text>
          </View>
          <View style={[styles.row, styles.rowDisabled]}>
            <Ionicons name="log-out-outline" size={19} color={colors.textTertiary} />
            <Text style={[styles.rowLabel, styles.rowLabelDisabled]}>Sign out</Text>
            <Text style={styles.soonBadge}>Coming soon</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.list}>
          <Pressable
            style={styles.row}
            onPress={notificationsGranted === false ? () => Linking.openSettings() : undefined}
          >
            <Ionicons
              name={notificationsGranted ? 'notifications' : 'notifications-off-outline'}
              size={19}
              color={notificationsGranted ? colors.success : colors.textSecondary}
            />
            <Text style={styles.rowLabel}>Pomodoro alerts</Text>
            {notificationsGranted === null ? (
              <Text style={styles.rowValue}>Checking…</Text>
            ) : notificationsGranted ? (
              <Text style={[styles.rowValue, styles.rowValueGood]}>Enabled</Text>
            ) : (
              <Text style={styles.rowLink}>Open Settings</Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.sectionTitle}>Data & sync</Text>
        <View style={styles.list}>
          <View style={styles.row}>
            <Ionicons name="cloud-offline-outline" size={19} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Sync across devices</Text>
            <Text style={styles.soonBadge}>Coming soon</Text>
          </View>
          <View style={styles.row}>
            <Ionicons name="server-outline" size={19} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Stored on this device</Text>
            <Text style={styles.rowValue}>
              {(allTasks ?? []).length} tasks · {(allHabits ?? []).length} habits · {(completedSessions ?? []).length} sessions
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Dev: background notification spike</Text>
        <View style={styles.testRow}>
          {TEST_DELAYS.map(seconds => (
            <Pressable key={seconds} style={styles.testBtn} onPress={() => handleTestNotification(seconds)}>
              <Text style={styles.testBtnText}>{seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}</Text>
            </Pressable>
          ))}
        </View>
        {testStatus && <Text style={styles.status}>{testStatus}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingVertical: 10 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  scroll: { paddingBottom: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  list: { paddingHorizontal: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowDisabled: { opacity: 0.55 },
  rowLabel: { flex: 1, fontSize: 14.5, fontWeight: '500', color: colors.text },
  rowLabelDisabled: { color: colors.textSecondary },
  rowValue: { fontSize: 12.5, color: colors.textTertiary, flexShrink: 1, textAlign: 'right' },
  rowValueGood: { color: colors.success, fontWeight: '600' },
  rowLink: { fontSize: 12.5, color: colors.info, fontWeight: '600' },
  soonBadge: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.textTertiary,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
