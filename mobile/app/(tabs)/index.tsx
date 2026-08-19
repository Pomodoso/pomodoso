import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HabitControl } from '@/components/HabitControl';
import { StartModePicker } from '@/components/StartModePicker';
import { StatusPicker } from '@/components/StatusPicker';
import { TaskRow } from '@/components/TaskRow';
import { TimerRing } from '@/components/TimerRing';
import { isResolvedStatus, isUpdatedToday } from '@/constants/taskStatus';
import { colors } from '@/constants/theme';
import { useHabits } from '@/hooks/useHabits';
import { useStartPicker } from '@/hooks/useStartPicker';
import { useStatusPicker } from '@/hooks/useStatusPicker';
import { useTasks } from '@/hooks/useTasks';
import { useTimer } from '@/hooks/useTimer';

const POMO_TOTAL_TARGET = 8;

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function HomeScreen() {
  const { habits, toggleHabit, incrementHabit } = useHabits();
  const { display, idleMode, setIdleMode, startSession, pauseSession, resumeSession, stopSession } = useTimer();
  const { requestStart, pickerProps } = useStartPicker(startSession);
  const { tasks, setTaskStatus } = useTasks();
  const { requestStatus, pickerProps: statusPickerProps } = useStatusPicker(setTaskStatus);
  // isPriority tasks stay in Today for the rest of the day they were
  // resolved on (matches extension's HomeState.tsx completedToday rule) —
  // marking one done/cancelled shouldn't make it vanish immediately.
  const priorities = tasks.filter(t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt)));

  const isStopwatch = display.mode === 'stopwatch';
  const timeLabel = display.status === 'idle' ? formatTime(0) : formatTime(isStopwatch ? display.elapsedSeconds : (display.remainingSeconds ?? 0));
  const ringColor = isStopwatch && display.status !== 'idle' ? colors.success : colors.accent;

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
          {display.status === 'idle' ? (
            <>
              <View style={styles.modeToggle}>
                {(['pomodoro', 'stopwatch'] as const).map(mode => (
                  <Pressable
                    key={mode}
                    style={[styles.modeOption, idleMode === mode && styles.modeOptionActive]}
                    onPress={() => setIdleMode(mode)}
                  >
                    <Text style={[styles.modeOptionText, idleMode === mode && styles.modeOptionTextActive]}>
                      {mode === 'pomodoro' ? '🍅 Pomodoro' : '⏱ Stopwatch'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TimerRing size={216} progress={0} timeLabel={formatTime(idleMode === 'pomodoro' ? 25 * 60 : 0)} />

              <Text style={styles.pomoCount}>Pomo {display.pomosToday} of {POMO_TOTAL_TARGET} today</Text>

              <Pressable style={styles.startBtn} onPress={() => startSession(idleMode, null)}>
                <Ionicons name="play" size={16} color={colors.surface} />
                <Text style={styles.startBtnText}>Start {idleMode === 'pomodoro' ? 'focus session' : 'stopwatch'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: ringColor }]} />
                <Text style={[styles.statusLabel, { color: ringColor }]}>
                  {display.status === 'paused' ? 'Paused' : isStopwatch ? 'Stopwatch' : 'Focus session'}
                </Text>
              </View>

              <TimerRing size={216} progress={isStopwatch ? 1 : display.progress} timeLabel={timeLabel} color={ringColor}>
                {!isStopwatch && (
                  <Text style={styles.pomoRowLabel}>Pomo {display.pomosToday + 1} of {POMO_TOTAL_TARGET}</Text>
                )}
              </TimerRing>

              {display.taskTitle && (
                <View style={styles.currentTask}>
                  <Text style={styles.currentTaskLabel}>Working on</Text>
                  <Text style={styles.currentTaskTitle}>{display.taskTitle}</Text>
                  {display.ticketRef && (
                    <View style={styles.currentTaskMeta}>
                      <View style={styles.ticketPill}>
                        <Text style={styles.ticketPillText}>{display.ticketRef}</Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.controls}>
                {display.status === 'paused' ? (
                  <Pressable style={styles.btn} onPress={resumeSession}>
                    <Ionicons name="play" size={15} color={colors.text} />
                    <Text style={styles.btnText}>Resume</Text>
                  </Pressable>
                ) : (
                  <Pressable style={styles.btn} onPress={pauseSession}>
                    <Ionicons name="pause" size={15} color={colors.text} />
                    <Text style={styles.btnText}>Pause</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.btn, styles.btnStop]} onPress={stopSession}>
                  <Ionicons name="stop" size={15} color={colors.accent} />
                  <Text style={[styles.btnText, styles.btnStopText]}>Stop</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>Today&apos;s priorities</Text>
        {priorities.map(t => (
          <TaskRow
            key={t.id}
            title={t.title}
            ticket={t.ticketRef ?? undefined}
            meta={t.meta ?? ''}
            status={t.status}
            onPlayPress={display.status === 'idle' && !isResolvedStatus(t.status) ? () => requestStart(t.id, t.title) : undefined}
            onStatusPress={() => requestStatus(t.id, t.title, t.status)}
          />
        ))}

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

      <StartModePicker {...pickerProps} />
      <StatusPicker {...statusPickerProps} />
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
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 2,
    gap: 2,
    marginBottom: 20,
  },
  modeOption: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  modeOptionActive: { backgroundColor: colors.surface },
  modeOptionText: { fontSize: 12.5, fontWeight: '500', color: colors.textTertiary },
  modeOptionTextActive: { fontWeight: '700', color: colors.text },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 22,
  },
  startBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  statusLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pomoRowLabel: { fontSize: 12, color: colors.textTertiary, fontWeight: '500', marginTop: 8 },
  pomoCount: { fontSize: 12, color: colors.textTertiary, fontWeight: '500', marginTop: 14 },
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
  controls: { flexDirection: 'row', gap: 8, width: '100%', marginTop: 6 },
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
