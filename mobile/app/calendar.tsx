import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';

// Mirrors extension's WorkspaceCalendarSection (SettingsState.tsx):
// disconnected state has marketing copy + a Connect button; connected state
// shows the account email, last-synced time, a Sync now button, Disconnect,
// and a checklist of every calendar on the account (selectedCalendarIds
// controls which get fetched — per-meeting track_mode, not built here, is
// set elsewhere once a Schedule/Today tracking UI exists, same division the
// extension has).
//
// Deliberately NOT gated on entitlements.features.calendar — confirmed via
// research (Fase B6 planning) that the extension's own shipped UI has no
// such gate either, despite the flag existing in the entitlements model.
// Mirroring real behavior, not introducing a stricter gate that doesn't
// exist in the product today.
export default function CalendarScreen(): React.JSX.Element {
  const { connection, calendars, lastSynced, loading, connecting, syncing, connect, disconnect, syncNow, toggleCalendar } =
    useGoogleCalendar();
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleConnect(): Promise<void> {
    try {
      await connect();
    } catch (err) {
      Alert.alert('Connect failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleDisconnect(): void {
    Alert.alert('Disconnect Google Calendar?', 'Meetings already imported on this device stay put, but no new ones will sync in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDisconnecting(true);
            try {
              await disconnect();
            } catch (err) {
              Alert.alert('Disconnect failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setDisconnecting(false);
            }
          })();
        },
      },
    ]);
  }

  async function handleSyncNow(): Promise<void> {
    try {
      await syncNow();
    } catch (err) {
      Alert.alert('Sync failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function handleToggleCalendar(id: string): void {
    toggleCalendar(id).catch(err => {
      Alert.alert("Couldn't update calendars", err instanceof Error ? err.message : 'Unknown error');
    });
  }

  function formatRelative(iso: string): string {
    const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(iso).toLocaleDateString();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Calendar</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={colors.textTertiary} style={{ marginTop: 40 }} />
        ) : connection ? (
          <>
            <View style={styles.card}>
              <View style={{ flex: 1 }}>
                <Text style={styles.email}>{connection.email}</Text>
                <Text style={styles.hint}>
                  Connected {new Date(connection.connectedAt).toLocaleDateString()}
                  {lastSynced ? ` · Synced ${formatRelative(lastSynced)}` : ''}
                </Text>
              </View>
            </View>

            <View style={styles.rowGap}>
              <Pressable style={[styles.actionBtnOutline, { flex: 1 }, syncing && styles.disabled]} onPress={() => void handleSyncNow()} disabled={syncing}>
                {syncing ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <>
                    <Ionicons name="sync-outline" size={15} color={colors.text} />
                    <Text style={styles.actionBtnOutlineText}>Sync now</Text>
                  </>
                )}
              </Pressable>
              <Pressable style={[styles.actionBtnOutline, disconnecting && styles.disabled]} onPress={handleDisconnect} disabled={disconnecting}>
                {disconnecting ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.actionBtnOutlineText}>Disconnect</Text>}
              </Pressable>
            </View>

            <Text style={styles.sectionTitle}>Calendars</Text>
            <Text style={styles.hint}>Choose which calendars sync into meetings.</Text>
            {calendars.length === 0 ? (
              <Text style={[styles.hint, { marginTop: 12 }]}>No calendars found on this account.</Text>
            ) : (
              calendars.map(cal => {
                const selected = connection.selectedCalendarIds.includes(cal.id);
                return (
                  <Pressable key={cal.id} style={styles.calRow} onPress={() => handleToggleCalendar(cal.id)}>
                    <View style={[styles.calDot, { backgroundColor: cal.backgroundColor ?? colors.textTertiary }]} />
                    <Text style={styles.calName} numberOfLines={1}>
                      {cal.summary}
                      {cal.primary ? ' (primary)' : ''}
                    </Text>
                    <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={20} color={selected ? colors.accent : colors.textTertiary} />
                  </Pressable>
                );
              })
            )}
          </>
        ) : (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Connect Google Calendar</Text>
            <Text style={styles.hint}>
              See today&apos;s meetings alongside your tasks, and log time spent in them. Your calendar connection stays on this device — it
              isn&apos;t shared with other devices signed into your account.
            </Text>
            <Pressable style={[styles.actionBtn, connecting && styles.disabled]} onPress={() => void handleConnect()} disabled={connecting}>
              {connecting ? (
                <ActivityIndicator color={colors.surface} size="small" />
              ) : (
                <>
                  <Ionicons name="calendar-outline" size={15} color={colors.surface} />
                  <Text style={styles.actionBtnText}>Connect Google Calendar</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  email: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  hint: { fontSize: 11.5, color: colors.textTertiary, marginTop: 4, lineHeight: 17 },
  rowGap: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  field: { marginTop: 8 },
  fieldLabel: { fontSize: 14.5, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 22,
    marginBottom: 6,
  },
  calRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  calDot: { width: 10, height: 10, borderRadius: 5 },
  calName: { flex: 1, fontSize: 13.5, color: colors.text },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 14,
  },
  actionBtnText: { fontSize: 13.5, fontWeight: '700', color: colors.surface },
  actionBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  actionBtnOutlineText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  disabled: { opacity: 0.6 },
});
