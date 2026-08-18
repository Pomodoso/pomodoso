import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TaskRow } from '@/components/TaskRow';
import { colors } from '@/constants/theme';

const FILTERS = ['Today', 'In progress', 'All open', 'Done'];

export default function TasksScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Tasks</Text>
        <Ionicons name="search-outline" size={20} color={colors.textTertiary} />
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
        <TaskRow title="Review MPL 2.0 question rename PR" ticket="INT-455" meta="2 pomos · 50m" onPlayPress={() => {}} />

        <Text style={styles.groupTitle}>Today&apos;s priorities</Text>
        <TaskRow title="Fix flaky retry test in sync engine" ticket="POM-89" meta="1h 20m" onPlayPress={() => {}} />
        <TaskRow title="Write launch checklist doc" meta="25m" onPlayPress={() => {}} />

        <Text style={styles.groupTitle}>Backlog</Text>
        <TaskRow title="Reply to App Store review notes" meta="Not started" onPlayPress={() => {}} />
        <TaskRow title="Investigate SQLite adapter perf" ticket="POM-94" meta="Not started" onPlayPress={() => {}} />
        <TaskRow title="Set up EAS Build project" meta="40m · yesterday" done />
      </ScrollView>

      <View style={styles.fab}>
        <Ionicons name="add" size={26} color={colors.surface} />
      </View>
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
