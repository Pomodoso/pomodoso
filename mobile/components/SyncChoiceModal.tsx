import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { resolveSyncChoiceAndSync } from '@/utils/sync';
import { getPendingSyncChoice, subscribeSyncChoice, type SyncChoice } from '@/utils/syncChoice';

// Asked once per (account, backend), the first time an account signs in on a
// device that already has data of its own. See utils/syncChoice.ts for why
// the silent merge that used to happen here is the wrong default.

export function SyncChoiceModal(): React.JSX.Element | null {
  // Seeded from the current value rather than null: syncNow() runs on cold
  // start and may already have published a pending scope before this mounts.
  const [scope, setScope] = useState<string | null>(getPendingSyncChoice);
  const [busy, setBusy] = useState<SyncChoice | null>(null);

  useEffect(() => subscribeSyncChoice(setScope), []);

  async function choose(choice: SyncChoice): Promise<void> {
    if (busy) return;
    setBusy(choice);
    try {
      await resolveSyncChoiceAndSync(scope!, choice);
    } catch (err) {
      // The choice is recorded before the sync runs, so a failure here is a
      // failed first sync, not an unanswered question — the automatic
      // triggers will retry. Saying so beats a dialog that reappears.
      Alert.alert('Sync failed', err instanceof Error ? err.message : 'It will retry automatically.');
    } finally {
      setBusy(null);
    }
  }

  if (scope === null) return null;

  return (
    // Not dismissable: every path out of it is a decision. onRequestClose is
    // required on Android (hardware back) and deliberately does nothing.
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>This device already has data</Text>
          <Text style={styles.body}>
            You signed in on a device that already has tasks and habits on it. Choose what happens to them.
          </Text>

          <Pressable
            style={[styles.option, busy === 'merge' && styles.optionBusy]}
            onPress={() => void choose('merge')}
            disabled={busy !== null}
          >
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Combine them</Text>
              <Text style={styles.optionHint}>
                Keep what&apos;s here and add it to your account. Right if this device was already yours.
              </Text>
            </View>
            {busy === 'merge' && <ActivityIndicator color={colors.accent} />}
          </Pressable>

          <Pressable
            style={[styles.option, busy === 'cloud' && styles.optionBusy]}
            onPress={() => void choose('cloud')}
            disabled={busy !== null}
          >
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Use my account only</Text>
              <Text style={[styles.optionHint, styles.warn]}>
                Deletes what&apos;s on this device and downloads your account. Nothing here is uploaded.
              </Text>
            </View>
            {busy === 'cloud' && <ActivityIndicator color={colors.accent} />}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(26,26,23,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 6, marginBottom: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  optionBusy: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  optionHint: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 3 },
  warn: { color: colors.accent },
});
