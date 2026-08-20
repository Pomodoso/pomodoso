import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@/constants/theme';
import type { NoteEntry } from '@/db/schema';
import { uid } from '@/utils/id';

interface NotesEditorProps {
  notes: NoteEntry[];
  onChange: (notes: NoteEntry[]) => void;
}

// Ports extension's noteEntries (TaskDetailState.tsx's handleAddNote et al)
// — a list of freeform notes, not a single string. Mobile never had a
// legacy singular `notes` field, so there's no notes-vs-noteEntries
// migration concern here.
export function NotesEditor({ notes, onChange }: NotesEditorProps) {
  function handleAdd(): void {
    onChange([...notes, { id: uid(), createdAt: new Date().toISOString(), content: '' }]);
  }

  function handleContentChange(id: string, content: string): void {
    onChange(notes.map(n => (n.id === id ? { ...n, content } : n)));
  }

  function handleRemove(id: string): void {
    onChange(notes.filter(n => n.id !== id));
  }

  return (
    <View>
      {notes.map(note => (
        <View key={note.id} style={styles.noteRow}>
          <TextInput
            style={styles.noteInput}
            value={note.content}
            onChangeText={text => handleContentChange(note.id, text)}
            placeholder="Note…"
            placeholderTextColor={colors.textTertiary}
            multiline
          />
          <Pressable onPress={() => handleRemove(note.id)} hitSlop={8} style={styles.noteRemove}>
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        </View>
      ))}

      <Pressable style={styles.addBtn} onPress={handleAdd}>
        <Ionicons name="add" size={14} color={colors.textTertiary} />
        <Text style={styles.addBtnText}>Add note</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  noteInput: { flex: 1, fontSize: 13.5, color: colors.text, minHeight: 20, padding: 0 },
  noteRemove: { paddingTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, color: colors.textTertiary },
});
