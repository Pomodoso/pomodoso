import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { STATUS_DOT_COLOR, STATUS_OPTIONS } from '@/constants/taskStatus';
import { colors } from '@/constants/theme';
import type { TaskStatus } from '@/db/schema';

interface StatusPickerProps {
  visible: boolean;
  taskTitle: string | null;
  currentStatus: TaskStatus | null;
  onPick: (status: TaskStatus) => void;
  onCancel: () => void;
}

export function StatusPicker({ visible, taskTitle, currentStatus, onPick, onCancel }: StatusPickerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          {taskTitle && (
            <Text style={styles.title} numberOfLines={2}>
              {taskTitle}
            </Text>
          )}
          <Text style={styles.prompt}>Set status</Text>

          {STATUS_OPTIONS.map(opt => (
            <Pressable key={opt.value} style={styles.option} onPress={() => onPick(opt.value)}>
              <View style={[styles.dot, { backgroundColor: STATUS_DOT_COLOR[opt.value] }]} />
              <Text style={styles.optionLabel}>{opt.label}</Text>
              {currentStatus === opt.value && <Ionicons name="checkmark" size={17} color={colors.accent} />}
            </Pressable>
          ))}

          <Pressable style={styles.cancel} onPress={onCancel}>
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
  title: { fontSize: 15, fontWeight: '600', color: colors.text, marginBottom: 4 },
  prompt: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  dot: { width: 11, height: 11, borderRadius: 6 },
  optionLabel: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
