import { Ionicons } from '@expo/vector-icons';
import { getDirectoryPage, PublicApiClient, recordInstall } from '@pomodoso/api';
import { validatePluginData, type PluginManifest } from '@pomodoso/types/plugins';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, PluginIcon, ui } from '@/components/apps/primitives';
import { SettingsFields } from '@/components/apps/SettingsFields';
import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { API_URL } from '@/lib/supabase';
import { defaultSettings, deviceTimeZone, installedBySlug, installPlugin } from '@/utils/plugins';

// Ports the extension's install preview (AppsTab.tsx's InstallPreview): what
// the app adds, its settings, and Install. Opened from the directory.

type Loaded = { manifest: PluginManifest } | { error: string };

export default function InstallScreen(): React.JSX.Element {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { session } = useAuth();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [showOnToday, setShowOnToday] = useState(true);
  const [issues, setIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!API_URL || !slug) {
      setLoaded({ error: 'The app directory is not available.' });
      return;
    }
    getDirectoryPage(new PublicApiClient(API_URL), slug)
      .then(page => {
        const r = validatePluginData(page.manifest);
        if (!r.ok) {
          setLoaded({ error: 'This app needs a newer version of Pomodoso.' });
          return;
        }
        setSettings(defaultSettings(r.manifest));
        setShowOnToday(r.manifest.today?.default_on ?? false);
        setLoaded({ manifest: r.manifest });
      })
      .catch(() => setLoaded({ error: "Couldn't load this app. Check your connection." }));
  }, [slug]);

  const existing = slug ? installedBySlug(slug) : undefined;

  function install(manifest: PluginManifest): void {
    const r = installPlugin(manifest, deviceTimeZone(), { settings, showOnToday, source: 'directory' });
    if (!r.ok) {
      setIssues(r.issues.map(i => i.message));
      return;
    }
    // Anonymous: only the count goes up. A failure never affects the install.
    if (API_URL) void recordInstall(new PublicApiClient(API_URL), r.plugin.slug).catch(() => {});
    router.replace(`/apps/${r.plugin.id}`);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Install app</Text>
        <View style={{ width: 24 }} />
      </View>
      {!loaded ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : 'error' in loaded ? (
        <Text style={ui.empty}>{loaded.error}</Text>
      ) : (
        <Preview
          manifest={loaded.manifest}
          settings={settings}
          setSetting={(k, v) => setSettings(s => ({ ...s, [k]: v }))}
          showOnToday={showOnToday}
          setShowOnToday={setShowOnToday}
          issues={issues}
          installedId={existing?.id}
          signedIn={session !== null}
          onInstall={() => install(loaded.manifest)}
        />
      )}
    </SafeAreaView>
  );
}

function Preview({ manifest: m, settings, setSetting, showOnToday, setShowOnToday, issues, installedId, signedIn, onInstall }: {
  manifest: PluginManifest;
  settings: Record<string, unknown>;
  setSetting: (key: string, value: unknown) => void;
  showOnToday: boolean;
  setShowOnToday: (v: boolean) => void;
  issues: string[];
  installedId: string | undefined;
  signedIn: boolean;
  onInstall: () => void;
}): React.JSX.Element {
  const prompts = (m.hooks ?? []).flatMap(h => ('ask' in h ? [h.ask] : []));
  const reports = (m.hooks ?? []).filter(h => !('ask' in h)).length;
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.top}>
        <PluginIcon icon={m.icon} name={m.name} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>
            {m.name} <Text style={styles.version}>v{m.version}</Text>
          </Text>
          {m.author ? <Text style={styles.meta}>by {m.author}</Text> : null}
        </View>
      </View>
      {m.description ? <Text style={styles.description}>{m.description}</Text> : null}

      <View style={ui.card}>
        <Text style={[ui.label, { marginBottom: 6 }]}>What it adds</Text>
        <Text style={styles.item}>• {m.views.length === 1 ? 'A screen' : `${m.views.length} screens`} in Apps</Text>
        {m.today ? <Text style={styles.item}>• A widget for Today: “{m.today.widget.label}”</Text> : null}
        {prompts.map(q => (
          <Text key={q} style={styles.item}>• Asks: “{q}”</Text>
        ))}
        {reports > 0 ? <Text style={styles.item}>• Adds a line to your reports</Text> : null}
        <Text style={styles.item}>• Stores: {m.collections.map(c => c.key.replace(/_/g, ' ')).join(', ')}, on this device (and your account, with sync)</Text>
        <Text style={[styles.item, { color: colors.textTertiary, marginTop: 6 }]}>Apps only see their own data. They can&apos;t read your tasks or run code.</Text>
      </View>

      {(m.settings?.length ?? 0) > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={styles.section}>Settings</Text>
          <SettingsFields manifest={m} values={settings} onChange={setSetting} />
        </View>
      ) : null}

      {m.today ? (
        <View style={styles.switchRow}>
          <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>Show on Today</Text>
          <Switch value={showOnToday} onValueChange={setShowOnToday} trackColor={{ true: colors.accent, false: colors.border }} />
        </View>
      ) : null}

      {issues.map(i => (
        <Text key={i} style={{ color: colors.accent, fontSize: 13 }}>{i}</Text>
      ))}

      {installedId ? (
        <Button kind="secondary" label="Open app" onPress={() => router.replace(`/apps/${installedId}`)} />
      ) : (
        <Button kind="primary" label="Install" onPress={onInstall} />
      )}
      {!signedIn ? <Text style={styles.hint}>You can install it now; adding entries needs an account.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  name: { fontSize: 19, fontWeight: '700', color: colors.text },
  version: { fontSize: 13, fontWeight: '400', color: colors.textTertiary },
  meta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  description: { fontSize: 14, lineHeight: 20, color: colors.textSecondary },
  item: { fontSize: 13.5, lineHeight: 20, color: colors.textSecondary },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  hint: { fontSize: 12.5, color: colors.textTertiary, textAlign: 'center' },
});
