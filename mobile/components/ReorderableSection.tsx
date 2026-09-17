import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

interface ReorderableSectionProps<T> {
  title: string;
  items: T[];
  keyOf: (item: T) => string;
  /** The new order of THIS section's ids, top to bottom. */
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T) => ReactNode;
  /** Optional per-item action offered only while reordering — the Today
   *  screen uses it to promote a task into Priorities. Returning false means
   *  the move was refused (e.g. the priorities cap is full). */
  promote?: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: (item: T) => void;
    enabled?: (item: T) => boolean;
  };
  /** Extra controls for the header row, shown when not reordering. */
  headerRight?: ReactNode;
}

/**
 * A titled list whose rows can be reordered.
 *
 * Deliberately not drag-and-drop: that needs react-native-gesture-handler +
 * a draggable-list package, and CLAUDE.md asks for new top-level deps to be
 * justified rather than assumed. Arrow controls behind an explicit Reorder
 * toggle need no dependency, are reachable with a screen reader, and don't
 * fight the ScrollView the way an in-list pan gesture does.
 *
 * Rows are rendered through `renderItem` untouched; while reordering, taps on
 * them are swallowed so a nudge can't open the task detail by accident.
 */
export function ReorderableSection<T>({
  title,
  items,
  keyOf,
  onReorder,
  renderItem,
  promote,
  headerRight,
}: ReorderableSectionProps<T>) {
  const [editing, setEditing] = useState(false);
  const canReorder = items.length > 1;

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const ids = items.map(keyOf);
    const moved = ids[index];
    const displaced = ids[target];
    if (moved === undefined || displaced === undefined) return;
    ids[index] = displaced;
    ids[target] = moved;
    onReorder(ids);
  }

  return (
    <>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerActions}>
          {!editing && headerRight}
          {canReorder && (
            <Pressable style={[styles.toggle, editing && styles.toggleActive]} onPress={() => setEditing(v => !v)} hitSlop={6}>
              <Ionicons
                name={editing ? 'checkmark' : 'swap-vertical'}
                size={12}
                color={editing ? colors.accent : colors.textTertiary}
              />
              <Text style={[styles.toggleText, editing && styles.toggleTextActive]}>{editing ? 'Done' : 'Reorder'}</Text>
            </Pressable>
          )}
        </View>
      </View>

      {items.map((item, index) => (
        <View key={keyOf(item)} style={editing ? styles.editingRow : undefined}>
          <View style={styles.itemBody} pointerEvents={editing ? 'none' : 'auto'}>
            {renderItem(item)}
          </View>
          {editing && (
            <View style={styles.controls}>
              {promote && (
                <Pressable
                  style={[styles.ctrlBtn, promote.enabled?.(item) === false && styles.ctrlBtnDisabled]}
                  onPress={() => promote.onPress(item)}
                  disabled={promote.enabled?.(item) === false}
                  accessibilityLabel={promote.label}
                  hitSlop={4}
                >
                  <Ionicons name={promote.icon} size={15} color={colors.accent} />
                </Pressable>
              )}
              <Pressable
                style={[styles.ctrlBtn, index === 0 && styles.ctrlBtnDisabled]}
                onPress={() => move(index, -1)}
                disabled={index === 0}
                accessibilityLabel={`Move ${title} item up`}
                hitSlop={4}
              >
                <Ionicons name="chevron-up" size={15} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={[styles.ctrlBtn, index === items.length - 1 && styles.ctrlBtnDisabled]}
                onPress={() => move(index, 1)}
                disabled={index === items.length - 1}
                accessibilityLabel={`Move ${title} item down`}
                hitSlop={4}
              >
                <Ionicons name="chevron-down" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          )}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 8,
  },
  // Matches the sectionTitle/groupTitle the screens already use — kept local
  // rather than shared so this component can drop into either one unchanged.
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
  },
  toggleActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  toggleText: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
  toggleTextActive: { color: colors.accent },
  editingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemBody: { flex: 1, minWidth: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctrlBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnDisabled: { opacity: 0.3 },
});
