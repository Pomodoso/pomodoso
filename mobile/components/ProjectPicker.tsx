import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PROJECT_PALETTE } from '@/constants/projectPalette';
import { colors } from '@/constants/theme';
import type { ProjectRow } from '@/db/schema';

interface ProjectPickerProps {
  visible: boolean;
  projects: ProjectRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (name: string, color: string) => string;
  onUpdate: (id: string, updates: { name?: string; color?: string }) => void;
  onRemove: (id: string) => void;
  onCancel: () => void;
}

type Mode = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; project: ProjectRow };

// Mirrors extension's ProjectPicker dropdown (TaskDetailState.tsx) — one
// popover with list/create/edit sub-modes, fixed 8-swatch palette, no
// freeform hex input.
export function ProjectPicker({ visible, projects, selectedId, onSelect, onCreate, onUpdate, onRemove, onCancel }: ProjectPickerProps) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(PROJECT_PALETTE[0]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function reset(): void {
    setMode({ kind: 'list' });
    setName('');
    setColor(PROJECT_PALETTE[0]);
    setConfirmingDelete(false);
  }

  function handleCancel(): void {
    reset();
    onCancel();
  }

  function openCreate(): void {
    setName('');
    setColor(PROJECT_PALETTE[0]);
    setMode({ kind: 'create' });
  }

  function openEdit(p: ProjectRow): void {
    setName(p.name);
    setColor(p.color);
    setConfirmingDelete(false);
    setMode({ kind: 'edit', project: p });
  }

  function handleSave(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (mode.kind === 'create') {
      const id = onCreate(trimmed, color);
      onSelect(id);
      reset();
      onCancel();
    } else if (mode.kind === 'edit') {
      onUpdate(mode.project.id, { name: trimmed, color });
      reset();
      setMode({ kind: 'list' });
    }
  }

  function handleDelete(): void {
    if (mode.kind !== 'edit') return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onRemove(mode.project.id);
    if (selectedId === mode.project.id) onSelect(null);
    reset();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <Pressable style={styles.backdrop} onPress={handleCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          {mode.kind === 'list' && (
            <>
              <Text style={styles.prompt}>Project</Text>

              <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                <Pressable style={styles.option} onPress={() => onSelect(null)}>
                  <View style={[styles.dot, styles.dotNone]} />
                  <Text style={styles.optionLabel}>No project</Text>
                  {selectedId === null && <Ionicons name="checkmark" size={17} color={colors.accent} />}
                </Pressable>

                {projects.map(p => (
                  <View key={p.id} style={styles.projectRow}>
                    <Pressable style={styles.option} onPress={() => onSelect(p.id)}>
                      <View style={[styles.dot, { backgroundColor: p.color }]} />
                      <Text style={styles.optionLabel}>{p.name}</Text>
                      {selectedId === p.id && <Ionicons name="checkmark" size={17} color={colors.accent} />}
                    </Pressable>
                    <Pressable style={styles.editBtn} onPress={() => openEdit(p)} hitSlop={8}>
                      <Ionicons name="pencil" size={14} color={colors.textTertiary} />
                    </Pressable>
                  </View>
                ))}

                <Pressable style={styles.newBtn} onPress={openCreate}>
                  <Ionicons name="add" size={16} color={colors.accent} />
                  <Text style={styles.newBtnText}>New project</Text>
                </Pressable>
              </ScrollView>

              <Pressable style={styles.cancel} onPress={handleCancel}>
                <Text style={styles.cancelText}>Close</Text>
              </Pressable>
            </>
          )}

          {(mode.kind === 'create' || mode.kind === 'edit') && (
            <>
              <Text style={styles.prompt}>{mode.kind === 'create' ? 'New project' : 'Edit project'}</Text>
              <TextInput
                style={styles.input}
                placeholder="Project name"
                placeholderTextColor={colors.textTertiary}
                value={name}
                onChangeText={setName}
                autoFocus
              />
              <View style={styles.swatchRow}>
                {PROJECT_PALETTE.map(c => (
                  <Pressable key={c} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]} onPress={() => setColor(c)} />
                ))}
              </View>
              <Pressable style={[styles.addBtn, !name.trim() && styles.addBtnDisabled]} onPress={handleSave} disabled={!name.trim()}>
                <Text style={styles.addBtnText}>Save</Text>
              </Pressable>
              {mode.kind === 'edit' && (
                <Pressable style={styles.deleteBtn} onPress={handleDelete}>
                  <Text style={styles.deleteBtnText}>{confirmingDelete ? 'Tap again to delete' : 'Delete project'}</Text>
                </Pressable>
              )}
              <Pressable style={styles.cancel} onPress={() => { setConfirmingDelete(false); setMode({ kind: 'list' }); }}>
                <Text style={styles.cancelText}>Back</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
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
    maxHeight: '80%',
  },
  prompt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  // flexShrink (not a fixed maxHeight) so the list gives way to the sheet's
  // own 80%-of-screen cap on short devices, instead of a magic pixel value
  // that fits on a typical screen but can still push the fixed Close footer
  // below it off-screen on smaller ones.
  list: { flexShrink: 1 },
  projectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  editBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  dotNone: { borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: 'transparent' },
  optionLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 4,
  },
  newBtnText: { fontSize: 14, fontWeight: '600', color: colors.accent },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: 14,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },
  addBtn: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addBtnDisabled: { opacity: 0.5 },
  addBtnText: { fontSize: 15, fontWeight: '700', color: colors.surface },
  deleteBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 8 },
  deleteBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.accent },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
