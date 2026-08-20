import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useWorkspace } from '@/hooks/useWorkspace';

// Ports extension's SettingsState.tsx main menu (SettingsPage 'main') — a
// list of nav rows into sub-pages, rather than one long scroll. Calendar and
// Workspace already had their own routed screens (Fase B6b-2/B3); this
// splits the rest of what used to be one flat settings.tsx into matching
// sub-screens. No "task detection" row — that's DOM-based ticket parsing on
// browsed web pages, which has no equivalent on mobile.

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
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
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
