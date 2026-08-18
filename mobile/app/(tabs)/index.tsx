import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitControl } from '@/components/HabitControl';
import { TaskRow } from '@/components/TaskRow';
import { TimerRing } from '@/components/TimerRing';
import { colors } from '@/constants/theme';
import { useHabits } from '@/hooks/useHabits';

const POMO_TOTAL = 8;
const POMO_DONE = 6;

export default function HomeScreen() {
  const { habits, toggleHabit, incrementHabit } = useHabits();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.workspace}>
          <View style={styles.workspaceDot}>
            <Text style={styles.workspaceDotText}>W</Text>
          </View>
          <Text style={styles.workspaceName}>Work</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
        </View>
        <Ionicons name="settings-outline" size={20} color={colors.textTertiary} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.timerBlock}>
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <Text style={styles.statusLabel}>Focus session</Text>
          </View>

          <TimerRing size={216} progress={1 - 14.5 / 25} timeLabel="14:32">
            <View style={styles.pomoRow}>
              <Text style={styles.pomoCount}>Pomo {POMO_DONE} of {POMO_TOTAL}</Text>
              <View style={styles.dots}>
                {Array.from({ length: POMO_TOTAL }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      i < POMO_DONE - 1 && styles.dotFilled,
                      i === POMO_DONE - 1 && styles.dotActive,
                    ]}
                  />
                ))}
              </View>
            </View>
          </TimerRing>

          <View style={styles.currentTask}>
            <Text style={styles.currentTaskLabel}>Working on</Text>
            <Text style={styles.currentTaskTitle}>Review MPL 2.0 question rename PR</Text>
            <View style={styles.currentTaskMeta}>
              <View style={styles.ticketPill}>
                <Text style={styles.ticketPillText}>INT-455</Text>
              </View>
              <Text style={styles.currentTaskMetaText}>· 2 pomos so far</Text>
            </View>
          </View>

          <View style={styles.controls}>
            <View style={styles.btn}>
              <Ionicons name="pause" size={15} color={colors.text} />
              <Text style={styles.btnText}>Pause</Text>
            </View>
            <View style={styles.btn}>
              <Ionicons name="swap-horizontal" size={15} color={colors.text} />
              <Text style={styles.btnText}>Switch</Text>
            </View>
            <View style={[styles.btn, styles.btnStop]}>
              <Ionicons name="stop" size={15} color={colors.accent} />
              <Text style={[styles.btnText, styles.btnStopText]}>Stop</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Today&apos;s priorities</Text>
        <TaskRow title="Fix flaky retry test in sync engine" ticket="POM-89" meta="1h 20m" onPlayPress={() => {}} />
        <TaskRow title="Write launch checklist doc" meta="25m" onPlayPress={() => {}} />

        <Text style={styles.sectionTitle}>Habits today</Text>
        {habits.map(habit => (
          <View key={habit.id} style={styles.habitRow}>
            <View style={[styles.habitIcon, !habit.done && styles.habitIconPending]}>
              <Ionicons
                name={habit.icon as ComponentProps<typeof Ionicons>['name']}
                size={18}
                color={habit.done ? colors.success : colors.textTertiary}
              />
            </View>
            <View style={styles.habitNameBlock}>
              <Text style={styles.habitName}>{habit.name}</Text>
              {habit.kind === 'counter' && habit.unit && habit.unitAmount && (
                <Text style={styles.habitSubtext}>
                  {habit.count * habit.unitAmount}/{(habit.goal ?? 0) * habit.unitAmount}
                  {habit.unit}
                </Text>
              )}
            </View>
            <HabitControl
              kind={habit.kind}
              done={habit.done}
              count={habit.count}
              goal={habit.goal}
              onToggle={() => toggleHabit(habit.id)}
              onIncrement={delta => incrementHabit(habit.id, delta)}
            />
          </View>
        ))}
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
  workspace: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  workspaceDot: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceDotText: { color: colors.surface, fontSize: 11, fontWeight: '700' },
  workspaceName: { fontSize: 15, fontWeight: '600', color: colors.text },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  timerBlock: { alignItems: 'center', paddingVertical: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pomoRow: { alignItems: 'center', marginTop: 8 },
  pomoCount: { fontSize: 12, color: colors.textTertiary, fontWeight: '500' },
  dots: { flexDirection: 'row', gap: 4, marginTop: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotFilled: { backgroundColor: colors.accent },
  dotActive: { backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.accentSoft },
  currentTask: {
    width: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginTop: 18,
    marginBottom: 14,
  },
  currentTaskLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  currentTaskTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 6 },
  currentTaskMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticketPill: { backgroundColor: colors.infoSoft, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  ticketPillText: { fontSize: 11, fontWeight: '700', color: colors.info },
  currentTaskMetaText: { fontSize: 13, color: colors.textSecondary },
  controls: { flexDirection: 'row', gap: 8, width: '100%' },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 13,
  },
  btnStop: { borderColor: colors.accentSoft },
  btnText: { fontSize: 14, fontWeight: '600', color: colors.text },
  btnStopText: { color: colors.accent },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 22,
    marginBottom: 10,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  habitIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.success,
  },
  habitIconPending: { backgroundColor: colors.surface, borderColor: colors.border },
  habitNameBlock: { flex: 1, minWidth: 0 },
  habitName: { fontSize: 14.5, fontWeight: '500', color: colors.text },
  habitSubtext: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
});
