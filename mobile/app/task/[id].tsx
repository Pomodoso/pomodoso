import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LinksEditor } from '@/components/LinksEditor';
import { NotesEditor } from '@/components/NotesEditor';
import { ProjectPicker } from '@/components/ProjectPicker';
import { RecurrenceFormModal } from '@/components/RecurrenceFormModal';
import { StatusPicker } from '@/components/StatusPicker';
import { isResolvedStatus, isUpdatedToday, STATUS_DOT_COLOR, STATUS_LABEL } from '@/constants/taskStatus';
import { colors, fontMono } from '@/constants/theme';
import { useProjectPicker } from '@/hooks/useProjectPicker';
import { useProjects } from '@/hooks/useProjects';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useSettings } from '@/hooks/useSettings';
import { useStatusPicker } from '@/hooks/useStatusPicker';
import { useTasks } from '@/hooks/useTasks';
import { useTodayDate } from '@/hooks/useTodayDate';
import { formatRecurrenceLabel } from '@/utils/recurrence';
import { formatMinutes, secondsBetween } from '@/utils/time';

// The extension's entry point for editing project/priority is its task
// detail screen — mobile didn't have one (see #31's known gap), which also
// meant isPriority had no UI at all, write-only from seed data. This closes
// both: reassigning a project after creation, and toggling priority.
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tasks, sessions, setTaskStatus, updateTask, togglePriority, toggleToday, setRecurrence, setLinks, setNoteEntries, addManualTime, removeTask } =
    useTasks();
  const [recurrenceModalVisible, setRecurrenceModalVisible] = useState(false);
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const { workspaces } = useWorkspace();
  const { settings } = useSettings();
  const today = useTodayDate();
  const task = tasks.find(t => t.id === id);

  const { requestStatus, pickerProps: statusPickerProps } = useStatusPicker(setTaskStatus);
  const { requestProject, pickerProps: projectPickerProps } = useProjectPicker(projectId => {
    if (task) updateTask(task.id, { projectId });
  });

  const [title, setTitle] = useState(task?.title ?? '');
  useEffect(() => {
    if (task) setTitle(task.title);
  }, [task?.id, task?.title]);

  const [ticketRef, setTicketRef] = useState(task?.ticketRef ?? '');
  const [showTicketId, setShowTicketId] = useState(!!task?.ticketRef);
  useEffect(() => {
    if (task) {
      setTicketRef(task.ticketRef ?? '');
      setShowTicketId(!!task.ticketRef);
    }
  }, [task?.id, task?.ticketRef]);

  const [description, setDescription] = useState(task?.description ?? '');
  const [showDescription, setShowDescription] = useState(!!task?.description);
  useEffect(() => {
    if (task) {
      setDescription(task.description ?? '');
      setShowDescription(!!task.description);
    }
  }, [task?.id, task?.description]);

  const [addTimeVisible, setAddTimeVisible] = useState(false);
  const [addHours, setAddHours] = useState('');
  const [addMinutes, setAddMinutes] = useState('');

  if (!task) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.notFound}>Task not found.</Text>
      </SafeAreaView>
    );
  }

  const project = task.projectId ? projects.find(p => p.id === task.projectId) : undefined;
  // Same "stays visible today" rule as Home/Tasks (constants/taskStatus.ts) —
  // a priority task resolved on an earlier day is no longer shown as a
  // priority anywhere, so it shouldn't still occupy one of its slots here.
  const priorityCount = tasks.filter(t => t.isPriority && (!isResolvedStatus(t.status) || isUpdatedToday(t.updatedAt, today))).length;
  const priorityLimitReached = !task.isPriority && priorityCount >= settings.maxPriorities;
  // A resolved task can't be ADDED to Priority/Today (matches extension —
  // that action only exists on backlog rows, never on done/cancelled tasks;
  // see useTasks.ts's togglePriority/toggleToday for why). Removal (already
  // a member) stays allowed regardless of status.
  const taskResolved = isResolvedStatus(task.status);
  const priorityRowDisabled = !task.isPriority && taskResolved;
  const todayRowDisabled = !task.isToday && taskResolved;
  // Same inclusion rule as useTasks.ts's stats/useTaskHistory's loggedFor —
  // only completed/interrupted focus sessions represent real logged time.
  const taskSessions = sessions
    .filter(s => s.taskId === task.id && s.kind === 'focus' && (s.status === 'completed' || s.status === 'interrupted') && s.endedAt)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // togglePriority enforces the maxPriorities cap itself (mirrors extension's
  // addToPriorities, App.tsx) and returns false when it refused; this just
  // decides how to surface that.
  function handleTogglePriority(): void {
    if (!task) return;
    const ok = togglePriority(task.id, settings.maxPriorities);
    if (!ok) {
      Alert.alert(
        'Priority limit reached',
        `You can only have ${settings.maxPriorities} priority task${settings.maxPriorities === 1 ? '' : 's'} at once. Remove one first, or raise the limit in Settings.`,
      );
    }
  }

  function handleToggleToday(): void {
    if (!task) return;
    toggleToday(task.id);
  }

  function handleTitleBlur(): void {
    if (!task) return;
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  }

  function handleTicketRefBlur(): void {
    if (!task) return;
    const trimmed = ticketRef.trim();
    if (trimmed !== (task.ticketRef ?? '')) {
      updateTask(task.id, { ticketRef: trimmed || null });
    }
  }

  function handleDescriptionBlur(): void {
    if (!task) return;
    const trimmed = description.trim();
    if (trimmed !== (task.description ?? '')) {
      updateTask(task.id, { description: trimmed || null });
    }
  }

  function handleAddTime(): void {
    if (!task) return;
    const h = parseInt(addHours, 10) || 0;
    const m = parseInt(addMinutes, 10) || 0;
    const seconds = h * 3600 + m * 60;
    // parseInt can return Infinity for a sufficiently long pasted digit
    // string, which passes seconds > 0 — addManualTime's Date math would
    // then throw on toISOString() instead of recording or rejecting it.
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    addManualTime(task.id, seconds);
    setAddHours('');
    setAddMinutes('');
    setAddTimeVisible(false);
  }

  function handleDelete(): void {
    if (!task) return;
    Alert.alert('Delete task?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // Awaited before navigating away: this screen has no play button
          // of its own, so staying here until deletion (including any
          // notification cancellation) fully completes means there's no
          // window where the user could reach a play button for this task
          // elsewhere while it's still being deleted.
          void (async () => {
            await removeTask(task.id);
            router.back();
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
        <Text style={styles.headerTitle}>Task</Text>
        <Pressable onPress={handleDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={20} color={colors.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <TextInput style={styles.titleInput} value={title} onChangeText={setTitle} onBlur={handleTitleBlur} multiline />

        {showTicketId ? (
          <TextInput
            style={styles.ticketInput}
            value={ticketRef}
            onChangeText={setTicketRef}
            onBlur={handleTicketRefBlur}
            placeholder="e.g. INT-455"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        ) : (
          <Pressable style={styles.addFieldBtn} onPress={() => setShowTicketId(true)}>
            <Ionicons name="add" size={14} color={colors.textTertiary} />
            <Text style={styles.addFieldBtnText}>Add ticket ID</Text>
          </Pressable>
        )}

        {showDescription ? (
          <TextInput
            style={styles.descriptionInput}
            value={description}
            onChangeText={setDescription}
            onBlur={handleDescriptionBlur}
            placeholder="Add a description…"
            placeholderTextColor={colors.textTertiary}
            multiline
          />
        ) : (
          <Pressable style={styles.addFieldBtn} onPress={() => setShowDescription(true)}>
            <Ionicons name="add" size={14} color={colors.textTertiary} />
            <Text style={styles.addFieldBtnText}>Add description</Text>
          </Pressable>
        )}

        <Text style={styles.sectionLabel}>Status</Text>
        <Pressable style={styles.row} onPress={() => requestStatus(task.id, task.title, task.status)}>
          <View style={[styles.dot, { backgroundColor: STATUS_DOT_COLOR[task.status] }]} />
          <Text style={styles.rowText}>{STATUS_LABEL[task.status]}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

        {workspaces.length > 1 && (
          <>
            <Text style={styles.sectionLabel}>Workspace</Text>
            {/* Moving a task clears its project and its Today/Priority
                membership — both belong to the workspace it is leaving. That
                happens in updateTask, which also marks both workspaces'
                orders dirty so the old one learns the task left its list. */}
            <View style={styles.wsRow}>
              {workspaces.map(w => (
                <Pressable
                  key={w.id}
                  style={[styles.wsChip, w.id === task.workspaceId && styles.wsChipActive]}
                  onPress={() => { if (w.id !== task.workspaceId) updateTask(task.id, { workspaceId: w.id }); }}
                >
                  <View style={[styles.dot, { backgroundColor: w.color }]} />
                  <Text style={[styles.wsChipText, w.id === task.workspaceId && styles.wsChipTextActive]}>{w.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>Project</Text>
        <Pressable style={styles.row} onPress={() => requestProject(task.projectId)}>
          {project ? (
            <>
              <View style={[styles.dot, { backgroundColor: project.color }]} />
              <Text style={styles.rowText}>{project.name}</Text>
            </>
          ) : (
            <Text style={styles.rowTextMuted}>No project</Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

        <Text style={styles.sectionLabel}>Priority</Text>
        <Pressable
          style={[styles.row, (priorityLimitReached || priorityRowDisabled) && styles.rowDisabled]}
          onPress={handleTogglePriority}
          disabled={priorityRowDisabled}
        >
          <Ionicons
            name={task.isPriority ? 'star' : 'star-outline'}
            size={18}
            color={task.isPriority ? colors.warning : colors.textTertiary}
          />
          <Text style={styles.rowText}>
            {task.isPriority
              ? "Today's priority"
              : priorityRowDisabled
                ? 'Completed tasks can’t be added'
                : priorityLimitReached
                  ? `Limit reached (${settings.maxPriorities})`
                  : 'Not a priority'}
          </Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Today</Text>
        <Pressable
          style={[styles.row, todayRowDisabled && styles.rowDisabled]}
          onPress={handleToggleToday}
          disabled={todayRowDisabled}
        >
          <Ionicons
            name={task.isToday ? 'today' : 'today-outline'}
            size={18}
            color={task.isToday ? colors.info : colors.textTertiary}
          />
          <Text style={styles.rowText}>
            {task.isToday ? "In today's tasks" : todayRowDisabled ? 'Completed tasks can’t be added' : 'Not scheduled for today'}
          </Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Recurrence</Text>
        <Pressable style={styles.row} onPress={() => setRecurrenceModalVisible(true)}>
          <Ionicons name="repeat" size={18} color={task.recurrenceRule ? colors.info : colors.textTertiary} />
          {task.recurrenceRule ? (
            <Text style={styles.rowText}>{formatRecurrenceLabel(task.recurrenceRule)}</Text>
          ) : (
            <Text style={styles.rowTextMuted}>Not recurring</Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

        <Text style={styles.sectionLabel}>Links</Text>
        <LinksEditor links={task.links} onChange={next => setLinks(task.id, next)} />

        <Text style={styles.sectionLabel}>Notes</Text>
        <NotesEditor notes={task.noteEntries} onChange={next => setNoteEntries(task.id, next)} />

        <View style={styles.sessionHeaderRow}>
          <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Time tracked</Text>
          {task.meta && <Text style={styles.metaText}>{task.meta}</Text>}
        </View>

        {addTimeVisible ? (
          <View style={styles.addTimeForm}>
            <TextInput
              style={styles.addTimeInput}
              value={addHours}
              onChangeText={setAddHours}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.addTimeUnit}>h</Text>
            <TextInput
              style={styles.addTimeInput}
              value={addMinutes}
              onChangeText={setAddMinutes}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.addTimeUnit}>m</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={handleAddTime}>
              <Text style={styles.addFormBtnAccent}>Add</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setAddTimeVisible(false);
                setAddHours('');
                setAddMinutes('');
              }}
            >
              <Text style={styles.addFormBtnMuted}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.addFieldBtn} onPress={() => setAddTimeVisible(true)}>
            <Ionicons name="add" size={14} color={colors.textTertiary} />
            <Text style={styles.addFieldBtnText}>Add time</Text>
          </Pressable>
        )}

        {taskSessions.map(s => (
          <View key={s.id} style={styles.sessionRow}>
            <Text style={styles.sessionDate} numberOfLines={1}>
              {new Date(s.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
            <Text style={styles.sessionMode}>{s.mode === 'pomodoro' ? '🍅' : s.mode === 'manual' ? 'manual' : '⏱'}</Text>
            <Text style={styles.sessionDuration}>{formatMinutes(Math.round(secondsBetween(s.startedAt, s.endedAt!) / 60))}</Text>
          </View>
        ))}
      </ScrollView>

      <StatusPicker {...statusPickerProps} />
      <ProjectPicker {...projectPickerProps} projects={projects} onCreate={addProject} onUpdate={updateProject} onRemove={removeProject} />
      <RecurrenceFormModal
        visible={recurrenceModalVisible}
        initialRule={task.recurrenceRule}
        onSave={rule => {
          setRecurrence(task.id, rule);
          setRecurrenceModalVisible(false);
        }}
        onCancel={() => setRecurrenceModalVisible(false)}
      />
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
  notFound: { textAlign: 'center', marginTop: 40, fontSize: 14, color: colors.textTertiary },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  titleInput: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.text,
    marginTop: 8,
    marginBottom: 10,
    padding: 0,
  },
  ticketInput: {
    alignSelf: 'flex-start',
    backgroundColor: colors.infoSoft,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 18,
    fontFamily: fontMono,
    fontSize: 12,
    fontWeight: '700',
    color: colors.info,
    minWidth: 90,
  },
  wsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  wsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 7, paddingHorizontal: 11,
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
  },
  wsChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  wsChipText: { fontSize: 12.5, color: colors.textSecondary },
  wsChipTextActive: { color: colors.accent, fontWeight: '700' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 18,
  },
  rowDisabled: { opacity: 0.6 },
  dot: { width: 11, height: 11, borderRadius: 6 },
  rowText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  rowTextMuted: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.textTertiary },
  metaText: { fontSize: 14, color: colors.textSecondary },
  descriptionInput: {
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 18,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  addFieldBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, marginBottom: 18 },
  addFieldBtnText: { fontSize: 13, color: colors.textTertiary },
  sessionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  addTimeForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
    marginBottom: 8,
  },
  addTimeInput: {
    width: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    textAlign: 'center',
    color: colors.text,
  },
  addTimeUnit: { fontSize: 12, color: colors.textTertiary },
  addFormBtnAccent: { fontSize: 13, fontWeight: '600', color: colors.accent },
  addFormBtnMuted: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sessionDate: { flex: 1, fontSize: 12, color: colors.textTertiary },
  sessionMode: { fontSize: 11, color: colors.textTertiary },
  sessionDuration: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
});
