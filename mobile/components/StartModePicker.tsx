import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import type { TimerMode } from '@/hooks/useTimer';

interface StartModePickerProps {
  visible: boolean;
  taskTitle: string | null;
  onPick: (mode: TimerMode) => void;
  onCancel: () => void;
}

// Asked explicitly per task, rather than silently using whatever the shared
// toggle happens to be set to — per @albertopaparelli's feedback: starting a
// specific task should let you choose Pomodoro vs Stopwatch right there. The
// choice still updates the shared "last used mode" (startSession does that),
// so Home's central Start button keeps defaulting to whatever was picked.
export function StartModePicker({ visible, taskTitle, onPick, onCancel }: StartModePickerProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          {taskTitle && (
            <Text style={styles.title} numberOfLines={2}>
              {taskTitle}
            </Text>
          )}
          <Text style={styles.prompt}>Start with...</Text>

          <Pressable style={styles.option} onPress={() => onPick('pomodoro')}>
            <Text style={styles.optionEmoji}>🍅</Text>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Pomodoro</Text>
              <Text style={styles.optionDesc}>25 min focus session</Text>
            </View>
          </Pressable>

          <Pressable style={styles.option} onPress={() => onPick('stopwatch')}>
            <Text style={styles.optionEmoji}>⏱</Text>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>Stopwatch</Text>
              <Text style={styles.optionDesc}>Open-ended, counts up</Text>
            </View>
          </Pressable>

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
    gap: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  optionEmoji: { fontSize: 26 },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  optionDesc: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
