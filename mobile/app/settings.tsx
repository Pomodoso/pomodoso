import type { SoundEvent, SoundSettings } from '@pomodoso/types';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DAY_LABELS } from '@/constants/habitDays';
import { colors } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import type { AppSettings } from '@/hooks/useSettings';
import { useSettings } from '@/hooks/useSettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { importBackup, shareBackup } from '@/utils/backup';
import { playSound } from '@/utils/sounds';

const SOUND_EVENTS: { event: SoundEvent; key: keyof SoundSettings['events']; label: string; description: string }[] = [
  { event: 'pomo-done', key: 'pomoDone', label: 'Pomodoro done', description: 'When a focus session ends' },
  { event: 'break-start', key: 'breakStart', label: 'Break starts', description: 'When break begins' },
  { event: 'break-done', key: 'breakDone', label: 'Break ends', description: 'When break time is up' },
  { event: 'focus-start', key: 'focusStart', label: 'Focus starts', description: 'When a new pomodoro starts' },
  { event: 'task-done', key: 'taskDone', label: 'Task done', description: 'When marking a task complete' },
];

const VOLUME_PRESETS = [0.25, 0.5, 0.75, 1];

// Ports extension's TimerDefaultsPage + GeneralPage (SettingsState.tsx) —
// same preset values, same "pill + custom minutes" pattern, minus Timezone
// (mobile has no per-workspace-timezone concept, local time only).

interface DurationPickerProps {
  label: string;
  presets: { label: string; seconds: number }[];
  value: number;
  onChange: (seconds: number) => void;
}

function DurationPicker({ label, presets, value, onChange }: DurationPickerProps): React.JSX.Element {
  const isPreset = presets.some(p => p.seconds === value);
  const [customMin, setCustomMin] = useState(String(Math.round(value / 60)));

  // useState's initializer only runs on mount — without this, a `value` that
  // changes for a reason other than this component's own onChange (e.g. the
  // settings live-query catching up after mount) wouldn't be reflected here.
  useEffect(() => {
    setCustomMin(String(Math.round(value / 60)));
  }, [value]);

  function handleCustomChange(raw: string): void {
    setCustomMin(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) onChange(n * 60);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.pillRow}>
        {presets.map(p => (
          <Pressable
            key={p.label}
            style={[styles.pill, value === p.seconds && styles.pillActive]}
            onPress={() => {
              onChange(p.seconds);
              setCustomMin(String(Math.round(p.seconds / 60)));
            }}
          >
            <Text style={[styles.pillText, value === p.seconds && styles.pillTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
        <TextInput
          style={[styles.customInput, !isPreset && styles.pillActive]}
          value={customMin}
          onChangeText={handleCustomChange}
          keyboardType="number-pad"
          placeholder="custom"
          placeholderTextColor={colors.textTertiary}
        />
        <Text style={styles.unitLabel}>min</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen(): React.JSX.Element {
  const { settings, update } = useSettings();
  const auth = useAuth();
  const { workspace } = useWorkspace();
  const isPro = auth.entitlements.features.sync;
  const [longEveryStr, setLongEveryStr] = useState(String(settings.longBreakEvery));
  const [goalStr, setGoalStr] = useState(String(settings.dailyGoal));
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  function handleSignOut(): void {
    Alert.alert('Sign out?', 'Sync stays off either way — this device keeps all its local data.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void auth.signOut() },
    ]);
  }

  useEffect(() => {
    setLongEveryStr(String(settings.longBreakEvery));
  }, [settings.longBreakEvery]);

  useEffect(() => {
    setGoalStr(String(settings.dailyGoal));
  }, [settings.dailyGoal]);

  function handleLongEveryChange(raw: string): void {
    setLongEveryStr(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) update('longBreakEvery', n);
  }

  function handleGoalChange(raw: string): void {
    setGoalStr(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) update('dailyGoal', n);
  }

  function toggleWorkDay(day: number): void {
    const active = settings.workDays.includes(day);
    const next = active ? settings.workDays.filter(d => d !== day) : [...settings.workDays, day].sort((a, b) => a - b);
    update('workDays', next);
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      await shareBackup();
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    let content: string;
    try {
      content = await new File(uri).text();
    } catch {
      Alert.alert('Import failed', 'Could not read the selected file.');
      return;
    }
    Alert.alert('Replace all data?', 'This will replace ALL your current tasks, habits, sessions, and settings. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Replace all data',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setImporting(true);
            try {
              await importBackup(content);
              Alert.alert('Import complete', 'Your data has been restored.');
            } catch (err) {
              Alert.alert('Import failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setImporting(false);
            }
          })();
        },
      },
    ]);
  }

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
        {auth.isConfigured && !auth.loading && (
          <>
            <Text style={styles.sectionTitle}>Account</Text>
            {auth.session ? (
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

                {!isPro && (
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
          </>
        )}

        <Text style={styles.sectionTitle}>Workspace</Text>
        <Pressable style={styles.accountRow} onPress={() => router.push('/workspaces')}>
          <View style={[styles.workspaceDot, { backgroundColor: workspace.color }]}>
            <Text style={styles.workspaceDotText}>{workspace.name[0]?.toUpperCase()}</Text>
          </View>
          <Text style={[styles.wsName, { flex: 1 }]}>{workspace.name}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

        <Text style={styles.sectionTitle}>Timer defaults</Text>

        <DurationPicker
          label="Focus"
          presets={[
            { label: '15m', seconds: 15 * 60 },
            { label: '25m', seconds: 25 * 60 },
            { label: '30m', seconds: 30 * 60 },
          ]}
          value={settings.focusSeconds}
          onChange={s => update('focusSeconds', s)}
        />

        <DurationPicker
          label="Short break"
          presets={[
            { label: '5m', seconds: 5 * 60 },
            { label: '10m', seconds: 10 * 60 },
          ]}
          value={settings.shortBreakSeconds}
          onChange={s => update('shortBreakSeconds', s)}
        />

        <DurationPicker
          label="Long break"
          presets={[
            { label: '10m', seconds: 10 * 60 },
            { label: '15m', seconds: 15 * 60 },
            { label: '20m', seconds: 20 * 60 },
          ]}
          value={settings.longBreakSeconds}
          onChange={s => update('longBreakSeconds', s)}
        />
        <View style={styles.inlineRow}>
          <Text style={styles.inlineLabel}>After every</Text>
          <TextInput
            style={styles.smallInput}
            value={longEveryStr}
            onChangeText={handleLongEveryChange}
            keyboardType="number-pad"
          />
          <Text style={styles.inlineLabel}>pomodoros</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Daily goal</Text>
          <View style={styles.inlineRow}>
            <TextInput style={styles.smallInput} value={goalStr} onChangeText={handleGoalChange} keyboardType="number-pad" />
            <Text style={styles.inlineLabel}>pomodoros per day</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>General</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Max priority tasks</Text>
          <View style={styles.pillRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <Pressable
                key={n}
                style={[styles.numBox, settings.maxPriorities === n && styles.pillActive]}
                onPress={() => update('maxPriorities', n)}
              >
                <Text style={[styles.pillText, settings.maxPriorities === n && styles.pillTextActive]}>{n}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Max tasks shown in Today&apos;s priorities. Default is 3.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Week starts on</Text>
          <View style={styles.pillRow}>
            {([0, 6] as const).map(day => (
              <Pressable
                key={day}
                style={[styles.pill, settings.weekStart === day && styles.pillActive]}
                onPress={() => update('weekStart', day as AppSettings['weekStart'])}
              >
                <Text style={[styles.pillText, settings.weekStart === day && styles.pillTextActive]}>
                  {day === 0 ? 'Monday' : 'Sunday'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>Used for &quot;this week&quot; in history.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Work days</Text>
          <View style={styles.pillRow}>
            {DAY_LABELS.map((label, i) => (
              <Pressable
                key={i}
                style={[styles.dayBox, settings.workDays.includes(i) && styles.pillActive]}
                onPress={() => toggleWorkDay(i)}
              >
                <Text style={[styles.pillText, settings.workDays.includes(i) && styles.pillTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Sounds</Text>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Sounds enabled</Text>
            <Text style={styles.hint}>Play audio cues for timer events.</Text>
          </View>
          <Switch
            value={settings.soundSettings.enabled}
            onValueChange={v => update('soundSettings', { ...settings.soundSettings, enabled: v })}
            trackColor={{ true: colors.accent }}
          />
        </View>

        <View style={[styles.field, !settings.soundSettings.enabled && styles.disabledSection]}>
          <Text style={styles.fieldLabel}>Volume · {Math.round(settings.soundSettings.volume * 100)}%</Text>
          <View style={styles.pillRow}>
            {VOLUME_PRESETS.map(v => (
              <Pressable
                key={v}
                style={[styles.pill, settings.soundSettings.volume === v && styles.pillActive]}
                disabled={!settings.soundSettings.enabled}
                onPress={() => update('soundSettings', { ...settings.soundSettings, volume: v })}
              >
                <Text style={[styles.pillText, settings.soundSettings.volume === v && styles.pillTextActive]}>{Math.round(v * 100)}%</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.field, !settings.soundSettings.enabled && styles.disabledSection]}>
          <Text style={styles.fieldLabel}>Events</Text>
          {SOUND_EVENTS.map(({ event, key, label, description }) => (
            <View key={key} style={styles.eventRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventLabel}>{label}</Text>
                <Text style={styles.hint}>{description}</Text>
              </View>
              <Pressable
                style={styles.previewBtn}
                disabled={!settings.soundSettings.enabled}
                onPress={() => playSound(event, { ...settings.soundSettings, enabled: true, events: { ...settings.soundSettings.events, [key]: true } })}
              >
                <Ionicons name="play" size={12} color={colors.textSecondary} />
              </Pressable>
              <Switch
                value={settings.soundSettings.events[key]}
                disabled={!settings.soundSettings.enabled}
                onValueChange={v =>
                  update('soundSettings', { ...settings.soundSettings, events: { ...settings.soundSettings.events, [key]: v } })
                }
                trackColor={{ true: colors.accent }}
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Data</Text>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Export</Text>
          <Text style={styles.hint}>Download all your tasks, habits, sessions, and settings as a JSON file.</Text>
          <Pressable
            style={[styles.actionBtn, exporting && styles.actionBtnDisabled]}
            onPress={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={15} color={colors.surface} />
                <Text style={styles.actionBtnText}>Export data</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Import</Text>
          <Text style={styles.hint}>Restore data from a previously exported file. This replaces all current data.</Text>
          <Pressable
            style={[styles.actionBtnOutline, importing && styles.actionBtnDisabled]}
            onPress={() => void handleImport()}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={15} color={colors.text} />
                <Text style={styles.actionBtnOutlineText}>Choose file…</Text>
              </>
            )}
          </Pressable>
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
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 22,
    marginBottom: 12,
  },
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
    marginBottom: 18,
  },
  accountEmail: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  workspaceDot: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  workspaceDotText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  wsName: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  proHint: { color: colors.accent, fontWeight: '700' },
  upgradeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 18,
    gap: 4,
  },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  pillText: { fontSize: 12.5, fontWeight: '500', color: colors.textTertiary },
  pillTextActive: { fontWeight: '700', color: colors.surface },
  customInput: {
    width: 62,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 12.5,
    color: colors.text,
  },
  unitLabel: { fontSize: 11, color: colors.textTertiary },
  numBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  inlineLabel: { fontSize: 12.5, color: colors.textTertiary },
  smallInput: {
    width: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: 13,
    textAlign: 'center',
    color: colors.text,
  },
  hint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  switchLabel: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  disabledSection: { opacity: 0.5 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  eventLabel: { fontSize: 13, fontWeight: '500', color: colors.text },
  previewBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    paddingVertical: 12,
    marginTop: 10,
  },
  actionBtnOutlineText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  actionBtnDisabled: { opacity: 0.6 },
});
