import { PublicApiClient, searchDirectory, type DirectoryListing } from '@pomodoso/api';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PluginIcon } from '@/components/apps/primitives';
import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { isSupported, usePlugins } from '@/hooks/usePlugins';
import { API_URL } from '@/lib/supabase';

// Ports the extension's Apps tab list (popup/apps/AppsTab.tsx): installed
// apps, and the public directory to browse and install from. Like the
// extension, apps open read-only when signed out.

export default function AppsScreen(): React.JSX.Element {
  const plugins = usePlugins();
  const { session } = useAuth();
  const [tab, setTab] = useState<'installed' | 'browse' | null>(null);
  const shown = !API_URL ? 'installed' : tab ?? ((plugins?.length ?? 0) === 0 ? 'browse' : 'installed');
  const installed = new Set((plugins ?? []).map(p => p.slug));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Apps</Text>
        {!session && (
          <Pressable style={styles.banner} onPress={() => router.push('/login')}>
            <Text style={styles.bannerText}>Sign in to add entries to your apps. Without an account they open read-only.</Text>
          </Pressable>
        )}
        {API_URL ? (
          <View style={styles.tabs}>
            {(['installed', 'browse'] as const).map(t => (
              <Pressable key={t} style={[styles.tab, shown === t && styles.tabOn]} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, shown === t && styles.tabTextOn]}>
                  {t === 'installed' ? `Installed · ${plugins?.length ?? 0}` : 'Browse'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {shown === 'installed' ? (
          (plugins ?? []).length === 0 ? (
            <Text style={styles.empty}>No apps yet. Browse the directory to add one.</Text>
          ) : (
            <View style={styles.list}>
              {(plugins ?? []).map((p, i) => {
                const ok = isSupported(p);
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.row, i > 0 && styles.divider, !ok && { opacity: 0.5 }]}
                    disabled={!ok}
                    onPress={() => router.push(`/apps/${p.id}`)}
                  >
                    <PluginIcon icon={p.manifest.icon} name={p.manifest.name} size={36} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{p.manifest.name}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {ok ? p.manifest.description ?? `v${p.manifest.version}` : 'Needs a newer version of Pomodoso'}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                );
              })}
            </View>
          )
        ) : (
          <Browse installed={installed} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Browse({ installed }: { installed: ReadonlySet<string> }): React.JSX.Element {
  const [q, setQ] = useState('');
  const [listings, setListings] = useState<DirectoryListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!API_URL) return;
    let live = true;
    const t = setTimeout(() => {
      searchDirectory(new PublicApiClient(API_URL!), q.trim() ? { q: q.trim() } : {})
        .then(rows => {
          if (live) {
            setListings(rows);
            setError(null);
          }
        })
        .catch(() => {
          if (live) setError("Couldn't load the directory. Check your connection.");
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <View style={{ gap: 12 }}>
      <TextInput
        style={styles.search}
        value={q}
        onChangeText={setQ}
        placeholder="Search apps"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />
      {error ? <Text style={styles.empty}>{error}</Text> : null}
      {!listings && !error ? <ActivityIndicator color={colors.accent} /> : null}
      {listings && listings.length === 0 ? <Text style={styles.empty}>No apps match.</Text> : null}
      {listings && listings.length > 0 ? (
        <View style={styles.list}>
          {listings.map((l, i) => (
            <Pressable key={l.slug} style={[styles.row, i > 0 && styles.divider]} onPress={() => router.push(`/apps/install?slug=${encodeURIComponent(l.slug)}`)}>
              <PluginIcon icon={l.icon ?? undefined} name={l.name} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {l.name}
                  {installed.has(l.slug) ? <Text style={styles.installed}>  Installed</Text> : null}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>{l.description ?? ''}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 40, gap: 14 },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  banner: { backgroundColor: colors.infoSoft, borderRadius: 10, padding: 12 },
  bannerText: { fontSize: 13, color: colors.info, lineHeight: 18 },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  tab: { paddingHorizontal: 14, paddingVertical: 7 },
  tabOn: { backgroundColor: colors.accentSoft },
  tabText: { fontSize: 13, color: colors.textSecondary },
  tabTextOn: { color: colors.accent, fontWeight: '600' },
  empty: { fontSize: 14, color: colors.textTertiary, textAlign: 'center', marginTop: 20 },
  list: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  installed: { fontSize: 11, fontWeight: '700', color: colors.success },
  meta: { fontSize: 12.5, color: colors.textTertiary, marginTop: 2 },
  chevron: { fontSize: 20, color: colors.textTertiary },
  search: {
    fontSize: 15, color: colors.text, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
  },
});
