import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { syncNow } from '@/utils/sync';

// Ports extension's SettingsState.tsx AccountPage.
export default function AccountSettingsScreen(): React.JSX.Element {
  const auth = useAuth();
  const isPro = auth.entitlements.features.sync;
  const [syncing, setSyncing] = useState(false);

  function handleSignOut(): void {
    Alert.alert('Sign out?', 'Sync stays off either way — this device keeps all its local data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void auth.signOut() },
    ]);
  }

  async function handleSyncNow(): Promise<void> {
    setSyncing(true);
    try {
      await syncNow();
    } catch (err) {
      Alert.alert('Sync failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Account & Sync</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {!auth.isConfigured || auth.loading ? (
          <ActivityIndicator color={colors.textTertiary} style={{ marginTop: 40 }} />
        ) : auth.session ? (
          <>
            <View style={styles.accountRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.accountEmail}>{auth.session.user.email}</Text>
                <Text style={[styles.hint, isPro && styles.proHint]}>{isPro ? '✓ Pro' : 'Free plan'}</Text>
              </View>
              <Pressable style={styles.actionBtnOutline} onPress={handleSignOut}>
                <Text style={styles.actionBtnOutlineText}>Sign out</Text>
              </Pressable>
            </View>

            {isPro ? (
              <Pressable style={[styles.actionBtnOutlineFull, syncing && styles.actionBtnDisabled]} onPress={() => void handleSyncNow()} disabled={syncing}>
                {syncing ? (
                  <ActivityIndicator color={colors.text} size="small" />
                ) : (
                  <>
                    <Ionicons name="sync-outline" size={15} color={colors.text} />
                    <Text style={styles.actionBtnOutlineText}>Sync now</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View style={styles.upgradeCard}>
                <Text style={styles.fieldLabel}>Upgrade to Pro</Text>
                <Text style={styles.hint}>Sync across devices · Unlimited workspaces · Web dashboard</Text>
                <Pressable
                  style={styles.actionBtn}
                  onPress={() => {
                    void WebBrowser.openBrowserAsync('https://pomodoso.com/pricing').catch(() => {
                      Alert.alert('Could not open pricing page', 'Please try again later.');
                    });
                  }}
                >
                  <Text style={styles.actionBtnText}>Upgrade to Pro →</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : (
          <View style={styles.field}>
            <Text style={styles.hint}>Sign in to unlock sync and paid features once they launch. Your local data works fine without it.</Text>
            <Pressable style={styles.actionBtn} onPress={() => router.push('/login')}>
              <Ionicons name="log-in-outline" size={15} color={colors.surface} />
              <Text style={styles.actionBtnText}>Sign in</Text>
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
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  accountEmail: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  proHint: { color: colors.accent, fontWeight: '700' },
  upgradeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  hint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 10,
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
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionBtnOutlineText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnOutlineFull: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
  },
});
