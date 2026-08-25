import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BreakBanner } from '@/components/BreakBanner';
import { RemoteTimerBanner } from '@/components/RemoteTimerBanner';
import { HabitControl } from '@/components/HabitControl';
import { StartModePicker } from '@/components/StartModePicker';
import { StatusPicker } from '@/components/StatusPicker';
import { TaskRow } from '@/components/TaskRow';
import { TimerRing } from '@/components/TimerRing';
import { isResolvedStatus, isUpdatedToday } from '@/constants/taskStatus';
import { colors } from '@/constants/theme';
import { useHabits } from '@/hooks/useHabits';
import { isAllDayMeetingTime, parseMeetingTime, useMeetings } from '@/hooks/useMeetings';
import { useProjects } from '@/hooks/useProjects';
import { useSettings } from '@/hooks/useSettings';
import { useStartPicker } from '@/hooks/useStartPicker';
import { useStatusPicker } from '@/hooks/useStatusPicker';
import { useTasks } from '@/hooks/useTasks';
import { useTimer } from '@/hooks/useTimer';
import { useTodayDate } from '@/hooks/useTodayDate';
import { useWorkspace } from '@/hooks/useWorkspace';
import { formatMinutes } from '@/utils/time';

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function HomeScreen() {
  const { workspace, isAll } = useWorkspace();
  const { habits, toggleHabit, incrementHabit } = useHabits();
  const { meetings } = useMeetings();
  const { settings } = useSettings();
  const {
    display,
    idleMode,
    setIdleMode,
    trackedMinutesToday,
    pendingBreak,
    pendingNextFocus,
    startSession,
    startBreak,
    skipBreak,
    startNextFocus,
    dismissBreakDone,
    pauseSession,
    resumeSession,
    stopSession,
    attachTask,
    detachTask,
  } = useTimer();
  // Only while a focus session is actually running: on a break there's no
  // task to swap, and paused/idle should still open the start picker.
  const canAttach = display.status === 'active' && display.kind === 'focus';
  const { requestStart, pickerProps } = useStartPicker(startSession, canAttach ? attachTask : null);
  const { tasks, setTaskStatus } = useTasks();
  const { requestStatus, pickerProps: statusPickerProps } = useStatusPicker(setTaskStatus);
  const { projects } = useProjects();
  const projectById = new Map(projects.map(p => [p.id, p]));
  const today = useTodayDate();
  // isPriority/isToday tasks stay in Today for the rest of the day they were
  // resolved on (matches extension's HomeState.tsx completedToday rule) —
  // marking one done/cancelled shouldn't make it vanish immediately.
  const priorities = tasks.filter(t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)));
  const todayTasks = tasks.filter(t => t.isToday && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)));

  // Matches extension's TodayFooter (HomeState.tsx) — "X/Y tasks · N pomos ·
  // Zm tracked", scoped to priorities + today's tasks specifically
  // (excluding backlog), same as todayPriorities/todayTasks there.
  const todayAll = [...priorities, ...todayTasks];
  const tasksDone = todayAll.filter(t => t.status === 'done').length;
  const tasksTotal = todayAll.length;
  const footerText = `${tasksDone}/${tasksTotal} tasks · ${display.pomosToday} pomo${display.pomosToday === 1 ? '' : 's'} · ${formatMinutes(trackedMinutesToday)} tracked`;

  const isStopwatch = display.mode === 'stopwatch';
  const isBreak = display.kind === 'short_break' || display.kind === 'long_break';
  const timeLabel = display.status === 'idle' ? formatTime(0) : formatTime(isStopwatch ? display.elapsedSeconds : (display.remainingSeconds ?? 0));
  const ringColor = display.status === 'idle' ? colors.accent : isBreak ? colors.break : isStopwatch ? colors.success : colors.accent;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.workspace} onPress={() => router.push('/workspaces')}>
          <View style={[styles.workspaceDot, { backgroundColor: isAll ? colors.border : workspace.color }]}>
            {isAll ? (
              <Ionicons name="albums-outline" size={13} color={colors.textSecondary} />
            ) : (
              <Text style={styles.workspaceDotText}>{workspace.name[0]?.toUpperCase()}</Text>
            )}
          </View>
          {/* Naming the scope rather than a workspace, so a mixed list is
              never mistaken for one workspace's contents. */}
          <Text style={styles.workspaceName}>{isAll ? 'All workspaces' : workspace.name}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
        </Pressable>
        {/* navigate, not push: /settings resolves to the Settings tab, and
            pushing a tab route stacks a second (tabs) navigator on top of the
            first instead of switching to it. */}
        <Pressable onPress={() => router.navigate('/settings')} hitSlop={8}>
          <Ionicons name="settings-outline" size={20} color={colors.textTertiary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Only draws when some other device announced a running session. */}
        <RemoteTimerBanner />
        <View style={styles.timerBlock}>
          {display.status === 'idle' && pendingBreak ? (
            <BreakBanner
              variant="offer-break"
              taskTitle={pendingBreak.taskTitle}
              breakLabel={`${Math.round(pendingBreak.durationSeconds / 60)}m break`}
              onPrimary={startBreak}
              onSecondary={skipBreak}
            />
          ) : display.status === 'idle' && pendingNextFocus ? (
            <BreakBanner variant="break-over" taskTitle={pendingNextFocus.taskTitle} onPrimary={startNextFocus} onSecondary={dismissBreakDone} />
          ) : display.status === 'idle' ? (
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

              <TimerRing size={216} progress={0} timeLabel={formatTime(idleMode === 'pomodoro' ? display.focusSeconds : 0)} />

              <Text style={styles.pomoCount}>Pomo {display.pomosToday} of {display.dailyGoal} today</Text>

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
                  {display.status === 'paused'
                    ? 'Paused'
                    : isBreak
                      ? display.kind === 'long_break'
                        ? 'Long break'
                        : 'Short break'
                      : isStopwatch
                        ? 'Stopwatch'
                        : 'Focus session'}
                </Text>
              </View>

              <TimerRing size={216} progress={isStopwatch ? 1 : display.progress} timeLabel={timeLabel} color={ringColor}>
                {!isStopwatch && !isBreak && (
                  <Text style={styles.pomoRowLabel}>Pomo {display.pomosToday + 1} of {display.dailyGoal}</Text>
                )}
              </TimerRing>

              {display.taskTitle && (
                <View style={styles.currentTask}>
                  <View style={styles.currentTaskHeader}>
                    <Text style={styles.currentTaskLabel}>{isBreak ? 'Break — up next' : 'Working on'}</Text>
                    {canAttach && (
                      <Pressable onPress={detachTask} hitSlop={10} accessibilityLabel="Detach task">
                        <Text style={styles.detachText}>Detach</Text>
                      </Pressable>
                    )}
                  </View>
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

              {/* A focus session with nothing attached — the state you land in
                  after Detach, or after starting one without picking a task.
                  Says where to attach from rather than opening a second task
                  picker here: the lists below already have play buttons, and
                  while a session runs those attach instead of starting. */}
              {canAttach && !display.taskTitle && (
                <View style={styles.currentTask}>
                  <Text style={styles.currentTaskLabel}>No task attached</Text>
                  <Text style={styles.noTaskHint}>Tap ▶ on any task below to work on it.</Text>
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
            projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
            onPress={() => router.push(`/task/${t.id}`)}
            onPlayPress={(display.status === 'idle' || canAttach) && !isResolvedStatus(t.status) ? () => requestStart(t.id, t.title) : undefined}
            onStatusPress={() => requestStatus(t.id, t.title, t.status)}
          />
        ))}

        {todayTasks.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Today&apos;s tasks</Text>
            {todayTasks.map(t => (
              <TaskRow
                key={t.id}
                title={t.title}
                ticket={t.ticketRef ?? undefined}
                meta={t.meta ?? ''}
                status={t.status}
                projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                onPress={() => router.push(`/task/${t.id}`)}
                onPlayPress={(display.status === 'idle' || canAttach) && !isResolvedStatus(t.status) ? () => requestStart(t.id, t.title) : undefined}
                onStatusPress={() => requestStatus(t.id, t.title, t.status)}
              />
            ))}
          </>
        )}

        {settings.showHabitsInToday && (
          <>
            <Text style={styles.sectionTitle}>Habits today</Text>
            {habits.filter(h => h.scheduledToday).map(habit => (
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
          </>
        )}

        {settings.showMeetingsInToday && meetings.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Meetings today</Text>
            {meetings.map(m => (
              <View key={m.id} style={[styles.meetingRow, m.past && styles.meetingRowPast]}>
                <View style={[styles.meetingDot, { backgroundColor: m.calendarColor ?? colors.textTertiary }]} />
                <View style={styles.meetingBody}>
                  <Text style={[styles.meetingTitle, m.past && styles.meetingTitlePast]} numberOfLines={1}>
                    {m.title || 'Meeting'}
                  </Text>
                  <Text style={styles.meetingMeta}>
                    {isAllDayMeetingTime(m.time)
                      ? 'All day'
                      : `${parseMeetingTime(m.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${m.durationMinutes}m`}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        <Text style={styles.footer}>{footerText}</Text>
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
  currentTaskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detachText: { fontSize: 11, fontWeight: '600', color: colors.accent },
  noTaskHint: { fontSize: 13, color: colors.textTertiary, marginTop: 4 },
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
  meetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  meetingRowPast: { opacity: 0.5 },
  meetingDot: { width: 8, height: 8, borderRadius: 4 },
  meetingBody: { flex: 1, minWidth: 0 },
  meetingTitle: { fontSize: 14.5, fontWeight: '500', color: colors.text },
  meetingTitlePast: { textDecorationLine: 'line-through' },
  meetingMeta: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
  footer: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
