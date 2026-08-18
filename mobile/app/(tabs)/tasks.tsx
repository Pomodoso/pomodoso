import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StartModePicker } from '@/components/StartModePicker';
import { TaskRow } from '@/components/TaskRow';
import { colors } from '@/constants/theme';
import { useStartPicker } from '@/hooks/useStartPicker';
import { useTimer } from '@/hooks/useTimer';

const FILTERS = ['Today', 'In progress', 'All open', 'Done'];

export default function TasksScreen() {
  const { display, idleMode, setIdleMode, startSession } = useTimer();
  const { requestStart, pickerProps } = useStartPicker(startSession);
  const canStart = display.status === 'idle';
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Tasks</Text>
        <View style={styles.headerActions}>
          {canStart && (
            <Pressable
              style={styles.modeBadge}
              onPress={() => setIdleMode(idleMode === 'pomodoro' ? 'stopwatch' : 'pomodoro')}
            >
              <Text style={styles.modeBadgeText}>{idleMode === 'pomodoro' ? '🍅 Pomodoro' : '⏱ Stopwatch'}</Text>
            </Pressable>
          )}
          <Ionicons name="search-outline" size={20} color={colors.textTertiary} />
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8 }}>
        {FILTERS.map((f, i) => (
          <View key={f} style={[styles.filterChip, i === 0 && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, i === 0 && styles.filterChipTextActive]}>{f}</Text>
          </View>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.groupTitle}>In progress</Text>
        <TaskRow
          title="Review MPL 2.0 question rename PR"
          ticket="INT-455"
          meta="2 pomos · 50m"
          onPlayPress={canStart ? () => requestStart('Review MPL 2.0 question rename PR', 'INT-455') : undefined}
        />

        <Text style={styles.groupTitle}>Today&apos;s priorities</Text>
        <TaskRow
          title="Fix flaky retry test in sync engine"
          ticket="POM-89"
          meta="1h 20m"
          onPlayPress={canStart ? () => requestStart('Fix flaky retry test in sync engine', 'POM-89') : undefined}
        />
        <TaskRow
          title="Write launch checklist doc"
          meta="25m"
          onPlayPress={canStart ? () => requestStart('Write launch checklist doc', null) : undefined}
        />

        <Text style={styles.groupTitle}>Backlog</Text>
        <TaskRow
          title="Reply to App Store review notes"
          meta="Not started"
          onPlayPress={canStart ? () => requestStart('Reply to App Store review notes', null) : undefined}
        />
        <TaskRow
          title="Investigate SQLite adapter perf"
          ticket="POM-94"
          meta="Not started"
          onPlayPress={canStart ? () => requestStart('Investigate SQLite adapter perf', 'POM-94') : undefined}
        />
        <TaskRow title="Set up EAS Build project" meta="40m · yesterday" done />
      </ScrollView>

      <View style={styles.fab}>
        <Ionicons name="add" size={26} color={colors.surface} />
      </View>

      <StartModePicker {...pickerProps} />
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
  pageTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBadgeText: { fontSize: 11.5, fontWeight: '600', color: colors.textSecondary },
  filterRow: { flexGrow: 0, paddingHorizontal: 20, marginBottom: 8 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterChipText: { fontSize: 12.5, fontWeight: '600', color: colors.textSecondary },
  filterChipTextActive: { color: colors.surface },
  scroll: { paddingHorizontal: 20, paddingBottom: 100 },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 8,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
});
