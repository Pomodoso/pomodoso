import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProjectPicker } from '@/components/ProjectPicker';
import { StatusPicker } from '@/components/StatusPicker';
import { STATUS_DOT_COLOR, STATUS_LABEL } from '@/constants/taskStatus';
import { colors, fontMono } from '@/constants/theme';
import { useProjectPicker } from '@/hooks/useProjectPicker';
import { useProjects } from '@/hooks/useProjects';
import { useSettings } from '@/hooks/useSettings';
import { useStatusPicker } from '@/hooks/useStatusPicker';
import { useTasks } from '@/hooks/useTasks';

// The extension's entry point for editing project/priority is its task
// detail screen — mobile didn't have one (see #31's known gap), which also
// meant isPriority had no UI at all, write-only from seed data. This closes
// both: reassigning a project after creation, and toggling priority.
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { tasks, setTaskStatus, updateTask, removeTask } = useTasks();
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const { settings } = useSettings();
  const task = tasks.find(t => t.id === id);

  const { requestStatus, pickerProps: statusPickerProps } = useStatusPicker(setTaskStatus);
  const { requestProject, pickerProps: projectPickerProps } = useProjectPicker(projectId => {
    if (task) updateTask(task.id, { projectId });
  });

  const [title, setTitle] = useState(task?.title ?? '');
  useEffect(() => {
    if (task) setTitle(task.title);
  }, [task?.id, task?.title]);

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
  const priorityCount = tasks.filter(t => t.isPriority).length;
  const priorityLimitReached = !task.isPriority && priorityCount >= settings.maxPriorities;

  // Mirrors extension's addToPriorities (App.tsx): prevents growing past
  // maxPriorities, but never retroactively strips priority from tasks
  // already marked — only blocks adding new ones once at the cap.
  function handleTogglePriority(): void {
    if (!task) return;
    if (priorityLimitReached) {
      Alert.alert(
        'Priority limit reached',
        `You can only have ${settings.maxPriorities} priority task${settings.maxPriorities === 1 ? '' : 's'} at once. Remove one first, or raise the limit in Settings.`,
      );
      return;
    }
    updateTask(task.id, { isPriority: !task.isPriority });
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

        {task.ticketRef && (
          <View style={styles.ticketPill}>
            <Text style={styles.ticketPillText}>{task.ticketRef}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Status</Text>
        <Pressable style={styles.row} onPress={() => requestStatus(task.id, task.title, task.status)}>
          <View style={[styles.dot, { backgroundColor: STATUS_DOT_COLOR[task.status] }]} />
          <Text style={styles.rowText}>{STATUS_LABEL[task.status]}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

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
        <Pressable style={[styles.row, priorityLimitReached && styles.rowDisabled]} onPress={handleTogglePriority}>
          <Ionicons
            name={task.isPriority ? 'star' : 'star-outline'}
            size={18}
            color={task.isPriority ? colors.warning : colors.textTertiary}
          />
          <Text style={styles.rowText}>
            {task.isPriority ? "Today's priority" : priorityLimitReached ? `Limit reached (${settings.maxPriorities})` : 'Not a priority'}
          </Text>
        </Pressable>

        {task.meta && (
          <>
            <Text style={styles.sectionLabel}>Time tracked</Text>
            <Text style={styles.metaText}>{task.meta}</Text>
          </>
        )}
      </ScrollView>

      <StatusPicker {...statusPickerProps} />
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
  ticketPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.infoSoft,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 20,
  },
  ticketPillText: { fontFamily: fontMono, fontSize: 12, fontWeight: '700', color: colors.info },
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
});
