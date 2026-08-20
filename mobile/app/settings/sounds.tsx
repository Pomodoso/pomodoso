import type { SoundEvent, SoundSettings } from '@pomodoso/types';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { useSettings } from '@/hooks/useSettings';
import { playSound } from '@/utils/sounds';

// Ports extension's SettingsState.tsx SoundsPage.

const SOUND_EVENTS: { event: SoundEvent; key: keyof SoundSettings['events']; label: string; description: string }[] = [
  { event: 'pomo-done', key: 'pomoDone', label: 'Pomodoro done', description: 'When a focus session ends' },
  { event: 'break-start', key: 'breakStart', label: 'Break starts', description: 'When break begins' },
  { event: 'break-done', key: 'breakDone', label: 'Break ends', description: 'When break time is up' },
  { event: 'focus-start', key: 'focusStart', label: 'Focus starts', description: 'When a new pomodoro starts' },
  { event: 'task-done', key: 'taskDone', label: 'Task done', description: 'When marking a task complete' },
];

const VOLUME_PRESETS = [0.25, 0.5, 0.75, 1];

export default function SoundsSettingsScreen(): React.JSX.Element {
  const { settings, update } = useSettings();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sounds</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
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
    marginBottom: 18,
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
});
