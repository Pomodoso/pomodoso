import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';
import type { TaskLink } from '@/db/schema';

interface LinksEditorProps {
  links: TaskLink[];
  onChange: (links: TaskLink[]) => void;
}

// Ports extension's links section (TaskDetailState.tsx) — url + optional
// label, add/remove. No inline edit-in-place (extension has one); removing
// and re-adding covers the same need with far less UI for a spike.
export function LinksEditor({ links, onChange }: LinksEditorProps) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');

  function handleAdd(): void {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    onChange([...links, { url: trimmedUrl, label: label.trim() || trimmedUrl }]);
    setUrl('');
    setLabel('');
    setAdding(false);
  }

  function handleRemove(index: number): void {
    onChange(links.filter((_, i) => i !== index));
  }

  function handleOpen(url: string): void {
    Linking.openURL(url).catch(() => {});
  }

  return (
    <View>
      {links.map((link, i) => (
        <View key={`${link.url}-${i}`} style={styles.linkRow}>
          <Pressable style={styles.linkBody} onPress={() => handleOpen(link.url)}>
            <Ionicons name="link" size={14} color={colors.info} />
            <Text style={styles.linkLabel} numberOfLines={1}>
              {link.label}
            </Text>
          </Pressable>
          <Pressable onPress={() => handleRemove(i)} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}

      {adding ? (
        <View style={styles.addForm}>
          <TextInput
            style={styles.input}
            placeholder="https://…"
            placeholderTextColor={colors.textTertiary}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
          <TextInput
            style={styles.input}
            placeholder="Label (optional)"
            placeholderTextColor={colors.textTertiary}
            value={label}
            onChangeText={setLabel}
          />
          <View style={styles.addFormActions}>
            <Pressable style={styles.addFormBtn} onPress={handleAdd} disabled={!url.trim()}>
              <Text style={[styles.addFormBtnText, !url.trim() && styles.addFormBtnTextDisabled]}>Add</Text>
            </Pressable>
            <Pressable
              style={styles.addFormBtn}
              onPress={() => {
                setAdding(false);
                setUrl('');
                setLabel('');
              }}
            >
              <Text style={styles.addFormBtnTextMuted}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable style={styles.addBtn} onPress={() => setAdding(true)}>
          <Ionicons name="add" size={14} color={colors.textTertiary} />
          <Text style={styles.addBtnText}>Add link</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  linkBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  linkLabel: { flex: 1, fontSize: 13.5, color: colors.info, fontWeight: '500' },
  addForm: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
  },
  addFormActions: { flexDirection: 'row', gap: 12, marginTop: 2 },
  addFormBtn: { paddingVertical: 4 },
  addFormBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  addFormBtnTextDisabled: { color: colors.textTertiary },
  addFormBtnTextMuted: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, color: colors.textTertiary },
});
