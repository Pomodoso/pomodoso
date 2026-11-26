import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DescriptionEditor } from '@/components/DescriptionEditor';
import { ProjectPicker } from '@/components/ProjectPicker';
import { colors, fontMono } from '@/constants/theme';
import {
  durationLabel,
  isAllDayMeetingTime,
  parseMeetingTime,
  updateMeeting,
  useMeeting,
  useMeetingHistory,
} from '@/hooks/useMeetings';
import { useProjectPicker } from '@/hooks/useProjectPicker';
import { useProjects } from '@/hooks/useProjects';
import { useTimer } from '@/hooks/useTimer';

// Ports the extension's MeetingDetailState (HomeState.tsx): title,
// description and notes with the same format buttons as a task, a project,
// time logged by hand, and the last logged occurrences of a recurring series.

export default function MeetingDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const meeting = useMeeting(id);
  const history = useMeetingHistory(meeting);
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const { display, startSession } = useTimer();

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [description, setDescription] = useState(meeting?.description ?? '');
  const [notes, setNotes] = useState(meeting?.notes ?? '');
  const [logH, setLogH] = useState('');
  const [logM, setLogM] = useState('');

  // Loaded once the row arrives, and re-synced when it changes elsewhere
  // (sync, or the timer logging it) so stale inputs never overwrite it.
  useEffect(() => {
    if (!meeting) return;
    setTitle(meeting.title);
    setDescription(meeting.description ?? '');
    setNotes(meeting.notes);
  }, [meeting?.id, meeting?.title, meeting?.description, meeting?.notes]);
  useEffect(() => {
    const lm = meeting?.loggedMinutes ?? 0;
    setLogH(lm ? String(Math.floor(lm / 60)) : '');
    setLogM(lm ? String(lm % 60) : '');
  }, [meeting?.loggedMinutes]);

  const { requestProject, pickerProps } = useProjectPicker(projectId => {
    if (meeting) updateMeeting(meeting.id, { projectId });
  });

  if (!meeting) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header onBack={() => router.back()} meta="" />
        <Text style={styles.notFound}>Meeting not found.</Text>
      </SafeAreaView>
    );
  }
  const m = meeting;

  const time = isAllDayMeetingTime(m.time)
    ? 'All day'
    : parseMeetingTime(m.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const project = m.projectId ? projects.find(p => p.id === m.projectId) : undefined;

  function commitTitle(): void {
    const t = title.trim();
    if (t && t !== m.title) updateMeeting(m.id, { title: t });
  }

  function commitText(field: 'description' | 'notes', value: string): void {
    const current = field === 'description' ? (m.description ?? '') : m.notes;
    if (value === current) return;
    updateMeeting(m.id, field === 'description' ? { description: value || null } : { notes: value });
  }

  function logTime(): void {
    const total = (parseInt(logH || '0', 10) || 0) * 60 + (parseInt(logM || '0', 10) || 0);
    updateMeeting(m.id, total > 0 ? { logged: true, loggedMinutes: total } : { logged: false, loggedMinutes: 0 });
  }

  function start(): void {
    if (display.status !== 'idle') {
      Alert.alert('A session is running', 'Stop the current session before starting this meeting.');
      return;
    }
    void startSession('stopwatch', m.id).then(() => {
      updateMeeting(m.id, { logged: true, loggedMinutes: m.durationMinutes });
      router.navigate('/');
    });
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={() => router.back()} meta={`${time} · ${durationLabel(m.durationMinutes)}`} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title</Text>
        <TextInput
          style={styles.titleInput}
          value={title}
          onChangeText={setTitle}
          onBlur={commitTitle}
          placeholder="Meeting"
          placeholderTextColor={colors.textTertiary}
        />

        {!m.past && (
          <Pressable style={styles.startBtn} onPress={start}>
            <Text style={styles.startText}>▶ Start meeting</Text>
          </Pressable>
        )}

        <DescriptionEditor
          value={description}
          onChange={setDescription}
          onCommit={v => commitText('description', v.trim())}
          placeholder="What's this meeting about…"
        />

        <Text style={styles.label}>Project</Text>
        <Pressable style={styles.row} onPress={() => requestProject(m.projectId)}>
          {project ? (
            <>
              <View style={[styles.projectDot, { backgroundColor: project.color }]} />
              <Text style={styles.rowText}>{project.name}</Text>
            </>
          ) : (
            <Text style={styles.rowTextMuted}>No project</Text>
          )}
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </Pressable>

        <DescriptionEditor
          label="Notes"
          value={notes}
          onChange={setNotes}
          onCommit={v => commitText('notes', v)}
          placeholder="Notes from the meeting…"
        />

        <Text style={styles.label}>Time logged</Text>
        <View style={styles.logRow}>
          <TextInput style={styles.numInput} value={logH} onChangeText={setLogH} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
          <Text style={styles.unit}>h</Text>
          <TextInput style={styles.numInput} value={logM} onChangeText={setLogM} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textTertiary} />
          <Text style={styles.unit}>m</Text>
          <Pressable style={styles.logBtn} onPress={logTime}>
            <Text style={styles.logBtnText}>{m.logged ? 'Update' : 'Log'}</Text>
          </Pressable>
        </View>
        {m.logged && m.loggedMinutes != null && <Text style={styles.hint}>✓ Logged {m.loggedMinutes}m</Text>}

        {history.length > 0 && (
          <>
            <Text style={[styles.label, styles.historyLabel]}>Previous occurrences</Text>
            {history.map(h => (
              <View key={h.id} style={styles.historyRow}>
                <Text style={styles.historyDate}>{parseMeetingTime(h.time).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                <Text style={styles.historyText} numberOfLines={1}>{h.notes ? h.notes.split('\n')[0] : 'No notes'}</Text>
                <Text style={styles.historyMins}>{h.loggedMinutes ?? 0}m</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <ProjectPicker
        {...pickerProps}
        projects={projects.filter(p => p.workspaceId === m.workspaceId)}
        onCreate={(name, color) => addProject(name, color, m.workspaceId)}
        onUpdate={updateProject}
        onRemove={removeProject}
      />
    </SafeAreaView>
  );
}

function Header({ onBack, meta }: { onBack: () => void; meta: string }): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Meeting</Text>
      <Text style={styles.headerMeta}>{meta}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: colors.text },
  headerMeta: { fontSize: 12, color: colors.textTertiary, fontFamily: fontMono },
  notFound: { textAlign: 'center', marginTop: 40, fontSize: 14, color: colors.textTertiary },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary, marginBottom: 6 },
  titleInput: { fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: 4, marginBottom: 14 },
  startBtn: { backgroundColor: colors.successSoft, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginBottom: 18 },
  startText: { color: colors.success, fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18,
  },
  rowText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  rowTextMuted: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.textTertiary },
  projectDot: { width: 10, height: 10, borderRadius: 5 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  numInput: {
    width: 54, fontSize: 15, color: colors.text, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.border, borderRadius: 8, paddingVertical: 8, textAlign: 'center',
  },
  unit: { fontSize: 13, color: colors.textSecondary, marginRight: 6 },
  logBtn: { marginLeft: 'auto', backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  logBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  hint: { fontSize: 12, color: colors.success, marginTop: 6 },
  historyLabel: { marginTop: 22 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  historyDate: { width: 52, fontSize: 12, color: colors.textTertiary },
  historyText: { flex: 1, fontSize: 13, color: colors.text },
  historyMins: { fontSize: 12, color: colors.textSecondary },
});
