import { Ionicons } from '@expo/vector-icons';
import type { BaseTaskStatus, TaskStatusConfig } from '@pomodoso/types';
import {
  addCustomTaskStatus,
  BASE_TASK_STATUS_LABELS,
  BASE_TASK_STATUSES,
  canRemoveFromBase,
  removeCustomTaskStatus,
  setBaseStatusHidden,
  updateCustomTaskStatus,
} from '@pomodoso/types';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { STATUS_DOT_COLOR } from '@/constants/taskStatus';
import { colors } from '@/constants/theme';
import { readTaskStatuses, useSettings } from '@/hooks/useSettings';
import { uid } from '@/utils/id';

// Ports extension's SettingsState.tsx TaskStatusesPage. The rules — which
// defaults can be hidden, what a custom status behaves as — live in
// @pomodoso/types task-status.ts; this screen only offers the edits.
export default function TaskStatusesScreen(): React.JSX.Element {
  const { settings, update } = useSettings();
  const config = settings.taskStatuses;
  const [newLabel, setNewLabel] = useState('');
  const [newBase, setNewBase] = useState<BaseTaskStatus>('in_progress');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  // Each edit is applied to the stored value, never to `config` as rendered:
  // a rename commits on blur, and the Hide/Remove tap that causes the blur
  // would otherwise overwrite it. The edit helpers return null when an edit
  // would leave a required status with nothing to land on; the controls that
  // could do that are disabled, so null is only ever a no-op here.
  function apply(edit: (current: TaskStatusConfig) => TaskStatusConfig | null): void {
    const next = edit(readTaskStatuses());
    if (next) update('taskStatuses', next);
  }

  function add(): void {
    const status = { id: uid(), label: newLabel, base: newBase };
    apply(c => addCustomTaskStatus(c, status));
    setNewLabel('');
  }

  function commitEdit(): void {
    const id = editingId;
    const label = editLabel;
    if (id) apply(c => updateCustomTaskStatus(c, id, { label }));
    setEditingId(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Task statuses</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>
          Your own statuses behave like the default they map to — &quot;In review&quot; mapped to In progress counts
          as work in progress everywhere.
        </Text>

        <View style={styles.group}>
          {BASE_TASK_STATUSES.map((base, i) => {
            const hidden = config.hidden.includes(base);
            const removable = canRemoveFromBase(config, base);
            const customs = config.custom.filter(c => c.base === base);
            return (
              <View key={base} style={[styles.baseBlock, i > 0 && styles.divider]}>
                <View style={styles.row}>
                  <View style={[styles.dot, { backgroundColor: STATUS_DOT_COLOR[base] }, hidden && { opacity: 0.35 }]} />
                  <Text style={[styles.label, hidden && styles.labelHidden]}>{BASE_TASK_STATUS_LABELS[base]}</Text>
                  <Pressable
                    disabled={!hidden && !removable}
                    onPress={() => apply(c => setBaseStatusHidden(c, base, !hidden))}
                    style={[styles.smallBtn, !hidden && !removable && styles.disabled]}
                  >
                    <Text style={styles.smallBtnText}>{hidden ? 'Show' : 'Hide'}</Text>
                  </Pressable>
                </View>
                {customs.map(c => (
                  <View key={c.id} style={[styles.row, styles.customRow]}>
                    <Text style={styles.arrow}>↳</Text>
                    {editingId === c.id ? (
                      <TextInput
                        autoFocus
                        value={editLabel}
                        onChangeText={setEditLabel}
                        onBlur={commitEdit}
                        onSubmitEditing={commitEdit}
                        style={[styles.input, { flex: 1 }]}
                      />
                    ) : (
                      <Pressable style={{ flex: 1 }} onPress={() => { setEditingId(c.id); setEditLabel(c.label); }}>
                        <Text style={styles.label}>{c.label}</Text>
                      </Pressable>
                    )}
                    <Pressable
                      disabled={!removable}
                      onPress={() => apply(cur => removeCustomTaskStatus(cur, c.id))}
                      style={[styles.smallBtn, !removable && styles.disabled]}
                    >
                      <Text style={styles.smallBtnText}>Remove</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Todo, In progress and Done always keep at least one status — add another one before hiding the last.
          Tap a custom status to rename it.
        </Text>

        <Text style={styles.fieldLabel}>Add a status</Text>
        <View style={styles.row}>
          <TextInput
            value={newLabel}
            onChangeText={setNewLabel}
            onSubmitEditing={add}
            placeholder="e.g. In review"
            placeholderTextColor={colors.textTertiary}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            disabled={!newLabel.trim()}
            onPress={add}
            style={[styles.addBtn, !newLabel.trim() && styles.disabled]}
          >
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>
        <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Behaves like</Text>
        <View style={styles.pillRow}>
          {BASE_TASK_STATUSES.map(b => (
            <Pressable key={b} style={[styles.pill, newBase === b && styles.pillActive]} onPress={() => setNewBase(b)}>
              <Text style={[styles.pillText, newBase === b && styles.pillTextActive]}>{BASE_TASK_STATUS_LABELS[b]}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
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
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  hint: { fontSize: 11, color: colors.textTertiary, marginVertical: 8, lineHeight: 16 },
  group: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  baseBlock: { paddingHorizontal: 14, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  customRow: { marginTop: 8, paddingLeft: 18 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  arrow: { fontSize: 12, color: colors.textTertiary },
  label: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  labelHidden: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallBtnText: { fontSize: 12, color: colors.textSecondary },
  disabled: { opacity: 0.4 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 14, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  addBtn: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9 },
  addBtnText: { fontSize: 13, fontWeight: '700', color: colors.surface },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillActive: { borderColor: colors.accent, backgroundColor: colors.accent },
  pillText: { fontSize: 12.5, fontWeight: '500', color: colors.textTertiary },
  pillTextActive: { fontWeight: '700', color: colors.surface },
});
