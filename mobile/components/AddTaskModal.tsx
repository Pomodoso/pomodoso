import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';

interface AddTaskModalProps {
  visible: boolean;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}

export function AddTaskModal({ visible, onSubmit, onCancel }: AddTaskModalProps) {
  const [title, setTitle] = useState('');

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
          <Pressable style={[styles.addBtn, !title.trim() && styles.addBtnDisabled]} onPress={handleSubmit} disabled={!title.trim()}>
            <Text style={styles.addBtnText}>Add task</Text>
          </Pressable>
          <Pressable style={styles.cancel} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
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
