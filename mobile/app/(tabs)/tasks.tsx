import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddTaskModal } from '@/components/AddTaskModal';
import { ProjectPicker } from '@/components/ProjectPicker';
import { StartModePicker } from '@/components/StartModePicker';
import { StatusPicker } from '@/components/StatusPicker';
import { TaskRow } from '@/components/TaskRow';
import { isResolvedStatus, isUpdatedToday } from '@/constants/taskStatus';
import { colors } from '@/constants/theme';
import type { HistoryRange } from '@/hooks/useTaskHistory';
import { useTaskHistory } from '@/hooks/useTaskHistory';
import { useProjectPicker } from '@/hooks/useProjectPicker';
import { useProjects } from '@/hooks/useProjects';
import { useStartPicker } from '@/hooks/useStartPicker';
import { useStatusPicker } from '@/hooks/useStatusPicker';
import { useTasks } from '@/hooks/useTasks';
import { useTimer } from '@/hooks/useTimer';
import { useTodayDate } from '@/hooks/useTodayDate';
import { formatRecurrenceLabel } from '@/utils/recurrence';
import { formatMinutes } from '@/utils/time';

type SubTab = 'backlog' | 'history';

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
];

export default function TasksScreen() {
  const { display, idleMode, setIdleMode, startSession } = useTimer();
  const { requestStart, pickerProps } = useStartPicker(startSession);
  const { tasks, addTask, setTaskStatus } = useTasks();
  const { requestStatus, pickerProps: statusPickerProps } = useStatusPicker(setTaskStatus);
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const projectById = new Map(projects.map(p => [p.id, p]));
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskProjectId, setNewTaskProjectId] = useState<string | null>(null);
  const { requestProject: requestNewTaskProject, pickerProps: projectPickerProps } = useProjectPicker(setNewTaskProjectId);
  const [subTab, setSubTab] = useState<SubTab>('backlog');
  const canStart = display.status === 'idle';

  const today = useTodayDate();
  // Same "stays visible today" rule as Home: a priority/today task resolved
  // today stays under its section; once it rolls off (next day) or if it was
  // never marked, it lives in History instead. No task appears in more than
  // one section.
  const priorities = tasks.filter(t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)));
  const todayTasks = tasks.filter(t => t.isToday && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today)));
  const backlog = tasks.filter(t => !t.isPriority && !t.isToday && !isResolvedStatus(t.status));
  // Every task with a recurrence rule — a management list, matching
  // extension's recurringTemplates (App.tsx). Can overlap with the sections
  // above (a recurring task with an active occurrence also shows under
  // Today's tasks); that's intentional, not a duplicate-section bug.
  const recurringTemplates = tasks.filter(t => t.recurrenceRule);

  const history = useTaskHistory();

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

      <View style={styles.subTabRow}>
        {(['backlog', 'history'] as const).map(t => (
          <Pressable key={t} style={[styles.subTabBtn, subTab === t && styles.subTabBtnActive]} onPress={() => setSubTab(t)}>
            <Text style={[styles.subTabText, subTab === t && styles.subTabTextActive]}>{t === 'backlog' ? 'Backlog' : 'History'}</Text>
          </Pressable>
        ))}
      </View>

      {subTab === 'backlog' ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {priorities.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Today&apos;s priorities</Text>
              {priorities.map(t => (
                <TaskRow
                  key={t.id}
                  title={t.title}
                  ticket={t.ticketRef ?? undefined}
                  meta={t.meta ?? ''}
                  status={t.status}
                  projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                  onPress={() => router.push(`/task/${t.id}`)}
                  onPlayPress={canStart && !isResolvedStatus(t.status) ? () => requestStart(t.id, t.title) : undefined}
                  onStatusPress={() => requestStatus(t.id, t.title, t.status)}
                />
              ))}
            </>
          )}

          {todayTasks.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Today&apos;s tasks</Text>
              {todayTasks.map(t => (
                <TaskRow
                  key={t.id}
                  title={t.title}
                  ticket={t.ticketRef ?? undefined}
                  meta={t.meta ?? ''}
                  status={t.status}
                  projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                  onPress={() => router.push(`/task/${t.id}`)}
                  onPlayPress={canStart && !isResolvedStatus(t.status) ? () => requestStart(t.id, t.title) : undefined}
                  onStatusPress={() => requestStatus(t.id, t.title, t.status)}
                />
              ))}
            </>
          )}

          {backlog.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Backlog</Text>
              {backlog.map(t => (
                <TaskRow
                  key={t.id}
                  title={t.title}
                  ticket={t.ticketRef ?? undefined}
                  meta={t.meta ?? ''}
                  status={t.status}
                  projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                  onPress={() => router.push(`/task/${t.id}`)}
                  onPlayPress={canStart ? () => requestStart(t.id, t.title) : undefined}
                  onStatusPress={() => requestStatus(t.id, t.title, t.status)}
                />
              ))}
            </>
          )}

          {recurringTemplates.length > 0 && (
            <>
              <Text style={styles.groupTitle}>Recurring</Text>
              {recurringTemplates.map(t => (
                <TaskRow
                  key={t.id}
                  title={t.title}
                  ticket={t.ticketRef ?? undefined}
                  meta={t.recurrenceRule ? formatRecurrenceLabel(t.recurrenceRule) : ''}
                  status={t.status}
                  projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                  onPress={() => router.push(`/task/${t.id}`)}
                />
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.rangeRow}>
            {RANGE_OPTIONS.map(opt => (
              <Pressable
                key={opt.value}
                style={[styles.filterChip, history.range === opt.value && styles.filterChipActive]}
                onPress={() => history.setRange(opt.value)}
              >
                <Text style={[styles.filterChipText, history.range === opt.value && styles.filterChipTextActive]}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>

          {!history.hasAny ? (
            <Text style={styles.emptyText}>No completed tasks yet.</Text>
          ) : !history.hasFiltered ? (
            <Text style={styles.emptyText}>No items match your filters.</Text>
          ) : (
            <>
              {history.grandTotalMinutes > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total</Text>
                  <Text style={styles.totalValue}>{formatMinutes(history.grandTotalMinutes)}</Text>
                </View>
              )}

              {history.days.map(day => (
                <View key={day.date}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayLabel}>{day.label}</Text>
                    {day.totalMinutes > 0 && <Text style={styles.dayMinutes}>{formatMinutes(day.totalMinutes)}</Text>}
                  </View>
                  {day.tasks.map(t => (
                    <TaskRow
                      key={t.id}
                      title={t.title}
                      ticket={t.ticketRef ?? undefined}
                      meta=""
                      status={t.status}
                      projectColor={t.projectId ? projectById.get(t.projectId)?.color : undefined}
                      onPress={() => router.push(`/task/${t.id}`)}
                      onStatusPress={() => requestStatus(t.id, t.title, t.status)}
                    />
                  ))}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      <Pressable style={styles.fab} onPress={() => setAddingTask(true)}>
        <Ionicons name="add" size={26} color={colors.surface} />
      </Pressable>

      <StartModePicker {...pickerProps} />
      <StatusPicker {...statusPickerProps} />
      <AddTaskModal
        visible={addingTask}
        projects={projects}
        selectedProjectId={newTaskProjectId}
        onRequestProject={() => requestNewTaskProject(newTaskProjectId)}
        onSubmit={title => {
          addTask(title, newTaskProjectId);
          setAddingTask(false);
          setNewTaskProjectId(null);
        }}
        onCancel={() => {
          setAddingTask(false);
          setNewTaskProjectId(null);
        }}
      />
      <ProjectPicker {...projectPickerProps} projects={projects} onCreate={addProject} onUpdate={updateProject} onRemove={removeProject} />
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
  subTabRow: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 2,
    gap: 2,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  subTabBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  subTabBtnActive: { backgroundColor: colors.bg },
  subTabText: { fontSize: 13, fontWeight: '500', color: colors.textTertiary },
  subTabTextActive: { fontWeight: '700', color: colors.text },
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
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
  emptyText: { fontSize: 13.5, color: colors.textTertiary, textAlign: 'center', marginTop: 40 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  totalLabel: { fontSize: 12.5, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  totalValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  dayLabel: { fontSize: 12, fontWeight: '700', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  dayMinutes: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },
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
