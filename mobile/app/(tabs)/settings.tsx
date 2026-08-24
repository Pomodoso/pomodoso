import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useWorkspace } from '@/hooks/useWorkspace';

// Ports extension's SettingsState.tsx main menu — a list of nav rows into
// sub-pages rather than one long scroll. No "task detection" row: that's
// DOM-based ticket parsing on browsed pages, with no mobile equivalent.
//
// This is the fourth tab, replacing the old "More" screen. That screen was
// written during M0 and never updated, so it still advertised Account, Sign
// out and sync as "Coming soon" long after they shipped, hard-coded the
// workspace name to "Work" (contradicting the real one shown everywhere
// else), and exposed the M0 background-notification spike's test buttons to
// users. Rather than keep two settings screens that disagreed, the tab now
// *is* the real one — Home's gear routes here too.

function useNotificationPermission(): boolean | null {
  const [granted, setGranted] = useState<boolean | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await Notifications.getPermissionsAsync();
    setGranted(result.granted);
  }, []);

  useEffect(() => {
    void refresh();
    // Re-check on foreground — the only way permission changes is the user
    // going to OS Settings and back, which always passes through this.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return granted;
}

interface NavRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  onPress: () => void;
  isLast?: boolean;
}

function NavRow({ icon, title, description, onPress, isLast }: NavRowProps): React.JSX.Element {
  return (
    <Pressable style={[styles.navRow, isLast && styles.navRowLast]} onPress={onPress}>
      <View style={styles.navIcon}>
        <Ionicons name={icon} size={17} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.navTitle}>{title}</Text>
        <Text style={styles.navDescription} numberOfLines={1}>
          {description}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const auth = useAuth();
  const { workspace } = useWorkspace();
  const { settings } = useSettings();
  const notificationsGranted = useNotificationPermission();
  const isPro = auth.entitlements.features.sync;

  const accountDescription = !auth.isConfigured || auth.loading
    ? '...'
    : auth.session
      ? isPro
        ? 'Pro · syncing'
        : 'Free · upgrade for sync'
      : 'Sign in to sync across devices';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.group}>
          <NavRow icon="person-circle-outline" title="Account & Sync" description={accountDescription} onPress={() => router.push('/settings/account')} isLast />
        </View>

        <View style={styles.group}>
          <NavRow icon="timer-outline" title="Timer defaults" description="Pomodoro duration and modes" onPress={() => router.push('/settings/timer-defaults')} />
          <NavRow icon="calendar-outline" title="Calendar" description="Google Calendar connection" onPress={() => router.push('/calendar')} />
          <NavRow icon="grid-outline" title="Workspace" description={workspace.name} onPress={() => router.push('/workspaces')} />
          <NavRow
            icon="musical-notes-outline"
            title="Sounds"
            description={settings.soundSettings.enabled ? `On · ${Math.round(settings.soundSettings.volume * 100)}% volume` : 'Off'}
            onPress={() => router.push('/settings/sounds')}
          />
          <NavRow icon="options-outline" title="General" description={`Max ${settings.maxPriorities} priorities`} onPress={() => router.push('/settings/general')} />
          <NavRow icon="swap-vertical-outline" title="Data" description="Export or import all your data" onPress={() => router.push('/settings/data')} isLast />
        </View>

        {/* Permission state, not a preference — the timer can't announce the
            end of a session without it, and the only fix is the OS settings
            app, so this offers that rather than a toggle it cannot honour. */}
        <View style={styles.group}>
          <Pressable
            style={[styles.navRow, styles.navRowLast]}
            onPress={notificationsGranted === false ? () => void Linking.openSettings() : undefined}
          >
            <View style={styles.navIcon}>
              <Ionicons
                name={notificationsGranted ? 'notifications-outline' : 'notifications-off-outline'}
                size={17}
                color={notificationsGranted ? colors.success : colors.textSecondary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.navTitle}>Pomodoro alerts</Text>
              <Text style={styles.navDescription} numberOfLines={1}>
                {notificationsGranted === null
                  ? 'Checking…'
                  : notificationsGranted
                    ? 'Notifications enabled'
                    : 'Blocked — tap to open system settings'}
              </Text>
            </View>
            {notificationsGranted === false && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  pageTitle: { fontSize: 26, fontWeight: '700', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navRowLast: { borderBottomWidth: 0 },
  navIcon: { width: 22, alignItems: 'center' },
  navTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  navDescription: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
});
