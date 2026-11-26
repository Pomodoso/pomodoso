import { applyFormat, type FormatKind } from '@pomodoso/types';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FormattedText } from '@/components/FormattedText';
import { colors, fontMono } from '@/constants/theme';

// Ports the extension's description field (TaskDetailState.tsx): format
// buttons over the text, and a Write/Preview toggle. Both use
// @pomodoso/types' applyFormat, so a button does the same thing in each.

const BUTTONS: { kind: FormatKind; label: string; style?: object }[] = [
  { kind: 'bold', label: 'B', style: { fontWeight: '800' } },
  { kind: 'italic', label: 'I', style: { fontStyle: 'italic' } },
  { kind: 'bullet', label: '•' },
  { kind: 'code', label: '`', style: { fontFamily: fontMono } },
];

export function DescriptionEditor({ value, onChange, onCommit }: {
  value: string;
  onChange: (value: string) => void;
  /** Called when editing ends (blur, or a format applied), to persist. */
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [selection, setSelection] = useState({ start: value.length, end: value.length });
  // Controlled selection only right after a format, so the cursor lands where
  // applyFormat says. Left controlled, iOS fights the user's own taps.
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>(undefined);

  // Saved when the input goes away without a blur: switching to Preview
  // unmounts it, and leaving the screen may not blur it first.
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  useEffect(() => () => latest.current.onCommit(latest.current.value), []);

  function switchTab(t: 'write' | 'preview'): void {
    if (t === 'preview' && tab === 'write') onCommit(value);
    setTab(t);
  }

  function format(kind: FormatKind): void {
    const r = applyFormat(value, selection.start, selection.end, kind);
    onChange(r.value);
    onCommit(r.value);
    setSelection({ start: r.start, end: r.end });
    setForced({ start: r.start, end: r.end });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>Description</Text>
        <View style={styles.tabs}>
          {(['write', 'preview'] as const).map(t => (
            <Pressable key={t} onPress={() => switchTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'write' ? 'Write' : 'Preview'}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {tab === 'write' ? (
        <>
          <View style={styles.toolbar}>
            {BUTTONS.map(b => (
              <Pressable key={b.kind} onPress={() => format(b.kind)} style={styles.fmtBtn} hitSlop={4} accessibilityLabel={b.kind}>
                <Text style={[styles.fmtText, b.style]}>{b.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={text => {
              setForced(undefined);
              onChange(text);
            }}
            selection={forced}
            onSelectionChange={e => {
              setSelection(e.nativeEvent.selection);
              setForced(undefined);
            }}
            onBlur={() => onCommit(value)}
            placeholder="Describe this task…"
            placeholderTextColor={colors.textTertiary}
            multiline
          />
        </>
      ) : (
        <View style={styles.preview}>
          <FormattedText text={value} placeholder="No description yet." />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary },
  tabs: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' },
  tab: { paddingHorizontal: 10, paddingVertical: 4 },
  tabOn: { backgroundColor: colors.accentSoft },
  tabText: { fontSize: 12, color: colors.textSecondary },
  tabTextOn: { color: colors.accent, fontWeight: '600' },
  toolbar: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  fmtBtn: { width: 34, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  fmtText: { fontSize: 14, color: colors.text },
  input: {
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  preview: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, minHeight: 90 },
});
