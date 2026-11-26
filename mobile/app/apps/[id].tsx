import { Ionicons } from '@expo/vector-icons';
import { recordTitle, SHOW_ON_TODAY_KEY } from '@pomodoso/types/plugins';
import { toEngineRecord, type PluginRow } from '@pomodoso/types/plugins/rows';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, PluginIcon, ui } from '@/components/apps/primitives';
import { PluginView, type PluginActions } from '@/components/apps/PluginView';
import { SettingsFields } from '@/components/apps/SettingsFields';
import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { isSupported, usePlugin, usePluginClock, usePluginData, usePluginTasks } from '@/hooks/usePlugins';
import {
  addRecord,
  deleteRecord,
  localToday,
  setDaily,
  uninstallPlugin,
  updatePluginSetting,
  updateRecord,
  type PluginClock,
} from '@/utils/plugins';

// Ports the extension's AppScreen and AppSettings (popup/apps/AppsTab.tsx):
// an app's views as tabs, a record's own screen opened from a list or board,
// and its settings with Uninstall.

export default function AppScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const plugin = usePlugin(id);

  if (plugin === undefined) return <SafeAreaView style={styles.safe} />;
  if (plugin === null || !isSupported(plugin)) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header title="App" onBack={() => router.back()} />
        <Text style={ui.empty}>{plugin === null ? 'This app is no longer installed.' : 'This app needs a newer version of Pomodoso.'}</Text>
      </SafeAreaView>
    );
  }
  return <Loaded plugin={plugin} />;
}

/**
 * The writes an app's blocks perform. A failure (a value too large) shows as
 * an alert and rejects, so a form that awaits it keeps its draft instead of
 * closing or resetting as if it had saved.
 */
function actionsFor(plugin: PluginRow, clock: PluginClock): PluginActions {
  const guard = (f: () => void): Promise<void> => {
    try {
      f();
      return Promise.resolve();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Unknown error');
      return Promise.reject(e);
    }
  };
  return {
    add: (c, data, opts) => guard(() => addRecord(plugin, c, data, clock, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {})),
    setDay: (c, day, data) => guard(() => setDaily(plugin, c, day, data, clock)),
    update: (r, data, opts) => guard(() => updateRecord(plugin, r.id, data, clock, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {})),
    remove: r => guard(() => deleteRecord(plugin, r.id)),
    openUrl: url => {
      if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
    },
  };
}

function Loaded({ plugin }: { plugin: PluginRow }): React.JSX.Element {
  const m = plugin.manifest;
  const { session } = useAuth();
  const readOnly = session === null;
  const clock = usePluginClock();
  const { records, evaluator } = usePluginData(plugin, clock);
  const tasks = usePluginTasks();
  const tabs = m.views.filter(v => v.of === undefined);
  const [viewId, setViewId] = useState(tabs[0]?.id);
  const [opened, setOpened] = useState<{ view: string; record: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const actions = useMemo(() => actionsFor(plugin, clock), [plugin, clock]);

  const recordView = opened ? m.views.find(v => v.id === opened.view) : undefined;
  const record = opened ? records?.find(r => r.id === opened.record) : undefined;
  const onRecord = Boolean(recordView && record);
  const view = onRecord ? recordView! : tabs.find(v => v.id === viewId) ?? tabs[0]!;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        title={onRecord ? recordTitle(m, toEngineRecord(record!)) : m.name}
        icon={onRecord ? undefined : <PluginIcon icon={m.icon} name={m.name} size={26} />}
        onBack={onRecord ? () => setOpened(null) : () => router.back()}
        right={
          <Pressable onPress={() => setSettingsOpen(true)} hitSlop={8} accessibilityLabel="App settings">
            <Ionicons name="settings-outline" size={21} color={colors.textSecondary} />
          </Pressable>
        }
      />
      {!onRecord && tabs.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.viewTabs} style={{ flexGrow: 0 }}>
          {tabs.map((v, i) => {
            const on = v.id === view.id;
            return (
              <Pressable key={v.id} onPress={() => setViewId(v.id)} style={[styles.viewTab, on && styles.viewTabOn]}>
                <Text style={[styles.viewTabText, on && styles.viewTabTextOn]}>{v.label ?? (i === 0 ? m.name : v.id)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {readOnly ? (
        <Pressable style={styles.banner} onPress={() => router.push('/login')}>
          <Text style={styles.bannerText}>Read-only. Sign in to add entries.</Text>
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {evaluator ? (
          <PluginView
            key={`${view.id}:${record?.id ?? ''}`}
            view={view}
            record={onRecord ? record!.id : undefined}
            env={{
              manifest: m,
              settings: plugin.settings,
              evaluator,
              today: localToday(clock.timeZone),
              now: new Date().toISOString(),
              timeZone: clock.timeZone,
              weekStart: clock.weekStart,
              readOnly,
              actions,
              openRecord: (v, r) => setOpened({ view: v, record: r }),
              tasks,
            }}
          />
        ) : null}
      </ScrollView>
      <Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsOpen(false)}>
        <AppSettings plugin={plugin} readOnly={readOnly} onClose={() => setSettingsOpen(false)} />
      </Modal>
    </SafeAreaView>
  );
}

function AppSettings({ plugin, readOnly, onClose }: { plugin: PluginRow; readOnly: boolean; onClose: () => void }): React.JSX.Element {
  const m = plugin.manifest;
  const save = (key: string, value: unknown) => {
    try {
      updatePluginSetting(plugin.id, key, value);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Unknown error');
    }
  };
  function uninstall(): void {
    Alert.alert(`Uninstall ${m.name}?`, 'Its data is deleted too.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Uninstall',
        style: 'destructive',
        onPress: () => {
          uninstallPlugin(plugin.id);
          onClose();
          router.back();
        },
      },
    ]);
  }
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.sheetHeader}>
        <Text style={styles.sheetTitle}>{m.name} settings</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={{ fontSize: 15, color: colors.accent, fontWeight: '600' }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <SettingsFields manifest={m} values={plugin.settings} disabled={readOnly} onChange={save} />
        {m.today ? (
          <View style={styles.switchRow}>
            <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>Show on Today</Text>
            <Switch
              value={plugin.settings[SHOW_ON_TODAY_KEY] === true}
              disabled={readOnly}
              onValueChange={v => save(SHOW_ON_TODAY_KEY, v)}
              trackColor={{ true: colors.accent, false: colors.border }}
            />
          </View>
        ) : null}
        <Button kind="ghost" label="Uninstall" onPress={uninstall} disabled={readOnly} textStyle={{ color: colors.accent }} style={styles.uninstall} />
        <Text style={styles.footer}>
          {m.id} · v{m.version}
          {m.author ? ` · ${m.author}` : ''}
          {m.license ? ` · ${m.license}` : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, icon, onBack, right }: { title: string; icon?: React.ReactNode; onBack: () => void; right?: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      {icon}
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {right ?? <View style={{ width: 21 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.text },
  viewTabs: { paddingHorizontal: 20, gap: 6, paddingBottom: 8 },
  viewTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  viewTabOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  viewTabText: { fontSize: 13, color: colors.textSecondary },
  viewTabTextOn: { color: colors.accent, fontWeight: '600' },
  banner: { marginHorizontal: 20, backgroundColor: colors.infoSoft, borderRadius: 10, padding: 10 },
  bannerText: { fontSize: 13, color: colors.info },
  scroll: { padding: 20, paddingBottom: 60, gap: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  uninstall: { borderColor: colors.accent, marginTop: 10 },
  footer: { fontSize: 12, color: colors.textTertiary, textAlign: 'center' },
});
