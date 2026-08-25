import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';
import type { ProjectRow, WorkspaceRow } from '@/db/schema';

interface AddTaskModalProps {
  visible: boolean;
  projects: ProjectRow[];
  selectedProjectId: string | null;
  /** Offered only under "All workspaces", where there is no active workspace
   *  to infer a target from. Empty otherwise. Switching one clears the
   *  selected project in the parent, since a project belongs to exactly one
   *  workspace and the old choice can't survive the move. */
  workspaces: WorkspaceRow[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  onRequestProject: () => void;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function AddTaskModal({
  visible, projects, selectedProjectId, workspaces, workspaceId, onWorkspaceChange,
  onRequestProject, onSubmit, onCancel,
}: AddTaskModalProps) {
  const [title, setTitle] = useState('');
  // A project belongs to exactly one workspace, so the picker must only offer
  // the chosen one's — otherwise a task lands referencing a project its own
  // workspace doesn't contain.
  const scoped = projects.filter(p => p.workspaceId === workspaceId);
  const selectedProject = scoped.find(p => p.id === selectedProjectId) ?? null;

  function handleSubmit(): void {
    if (!title.trim()) return;
    onSubmit(title);
    setTitle('');
  }

  function handleCancel(): void {
    setTitle('');
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      {/* The sheet sits at the bottom, so the keyboard covered the very field
          it opens for. Padding rather than position: the sheet is already
          bottom-anchored and position would fight its own layout. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <Text style={styles.prompt}>New task</Text>
          <TextInput
            style={styles.input}
            placeholder="What do you need to do?"
            placeholderTextColor={colors.textTertiary}
            value={title}
            onChangeText={setTitle}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          {workspaces.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wsRow} contentContainerStyle={styles.wsRowContent}>
              {workspaces.map(w => (
                <Pressable
                  key={w.id}
                  style={[styles.wsChip, w.id === workspaceId && styles.wsChipActive]}
                  onPress={() => onWorkspaceChange(w.id)}
                >
                  <View style={[styles.projectDot, { backgroundColor: w.color }]} />
                  <Text style={[styles.wsChipText, w.id === workspaceId && styles.wsChipTextActive]}>{w.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Pressable style={styles.projectBtn} onPress={onRequestProject}>
            {selectedProject ? (
              <>
                <View style={[styles.projectDot, { backgroundColor: selectedProject.color }]} />
                <Text style={styles.projectBtnText}>{selectedProject.name}</Text>
              </>
            ) : (
              <Text style={styles.projectBtnTextMuted}>+ Add project</Text>
            )}
          </Pressable>
          <Pressable style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]} onPress={handleSubmit} disabled={!title.trim()}>
            <Text style={styles.addBtnText}>Add task</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26,26,23,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  prompt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  projectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  projectDot: { width: 10, height: 10, borderRadius: 5 },
  wsRow: { marginBottom: 10 },
  wsRowContent: { gap: 8, paddingRight: 4 },
  wsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  wsChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  wsChipText: { fontSize: 12.5, color: colors.textSecondary },
  wsChipTextActive: { color: colors.accent, fontWeight: '700' },
  projectBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  projectBtnTextMuted: { fontSize: 13.5, fontWeight: '600', color: colors.accent },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
