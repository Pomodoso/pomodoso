import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProUpsell } from '@/components/ProUpsell';
import { colors } from '@/constants/theme';
import { WORKSPACE_PALETTE } from '@/constants/workspacePalette';
import type { WorkspaceRow } from '@/db/schema';
import { useAuth } from '@/hooks/useAuth';
import { ALL_SENTINEL, useWorkspace } from '@/hooks/useWorkspace';

// Mirrors extension's WorkspacesPage (SettingsState.tsx): inline rename +
// fixed-swatch color edit per row, "can't delete the last workspace",
// gated "+ New workspace" on entitlements.features.multi_workspace (plus
// the same workspaces.length < 1 always-allowed clause the extension has,
// even though it can't actually matter here — db/client.ts's initDb always
// seeds one before this screen could ever be reached).
export default function WorkspacesScreen() {
  const { workspaceId, isAll, workspaces, addWorkspace, updateWorkspace, removeWorkspace, setActiveWorkspace } = useWorkspace();
  const auth = useAuth();
  const canAddWorkspace = auth.entitlements.features.multi_workspace || workspaces.length < 1;

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(WORKSPACE_PALETTE[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function handleAdd(): void {
    if (!name.trim()) return;
    addWorkspace({ name, color });
    setName('');
    setColor(WORKSPACE_PALETTE[0]);
    setAdding(false);
  }

  function startEdit(ws: WorkspaceRow): void {
    setEditingId(ws.id);
    setEditName(ws.name);
    setEditColor(ws.color);
    setConfirmDeleteId(null);
  }

  function saveEdit(): void {
    if (editingId && editName.trim()) updateWorkspace(editingId, { name: editName, color: editColor });
    setEditingId(null);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Workspaces</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.hint}>Workspaces let you group tasks, habits, and sessions. Switch between them from Home.</Text>

        {/* Only worth offering once there's more than one to combine. Listed
            above the workspaces, not among them, because it isn't one — it's
            the absence of a filter. */}
        {workspaces.length > 1 && (
          <Pressable style={styles.card} onPress={() => setActiveWorkspace(ALL_SENTINEL)}>
            <View style={styles.wsMain}>
              <View style={[styles.dot, styles.allDot]}>
                <Ionicons name="albums-outline" size={15} color={colors.textSecondary} />
              </View>
              <Text style={styles.wsName}>All workspaces</Text>
              {isAll && <Ionicons name="checkmark" size={16} color={colors.accent} />}
            </View>
          </Pressable>
        )}

        {workspaces.map(ws =>
          editingId === ws.id ? (
            <View key={ws.id} style={[styles.card, styles.cardEditing]}>
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                autoFocus
                placeholder="Workspace name"
                placeholderTextColor={colors.textTertiary}
              />
              <View style={styles.swatchRow}>
                {WORKSPACE_PALETTE.map(c => (
                  <Pressable key={c} style={[styles.swatch, { backgroundColor: c }, editColor === c && styles.swatchSelected]} onPress={() => setEditColor(c)} />
                ))}
              </View>
              <View style={styles.rowGap}>
                <Pressable style={[styles.actionBtn, { flex: 1 }]} onPress={saveEdit}>
                  <Text style={styles.actionBtnText}>Save</Text>
                </Pressable>
                <Pressable style={styles.actionBtnOutline} onPress={() => setEditingId(null)}>
                  <Text style={styles.actionBtnOutlineText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View key={ws.id} style={styles.card}>
              <Pressable style={styles.wsMain} onPress={() => setActiveWorkspace(ws.id)} disabled={!isAll && ws.id === workspaceId}>
                <View style={[styles.dot, { backgroundColor: ws.color }]}>
                  <Text style={styles.dotText}>{ws.name[0]?.toUpperCase()}</Text>
                </View>
                <Text style={styles.wsName}>{ws.name}</Text>
                {!isAll && ws.id === workspaceId && <Ionicons name="checkmark" size={16} color={ws.color} />}
              </Pressable>
              {confirmDeleteId === ws.id ? (
                <View style={styles.rowGap}>
                  <Text style={styles.confirmLabel}>Delete?</Text>
                  <Pressable style={styles.confirmYes} onPress={() => { removeWorkspace(ws.id); setConfirmDeleteId(null); }}>
                    <Text style={styles.confirmYesText}>Yes</Text>
                  </Pressable>
                  <Pressable style={styles.confirmNo} onPress={() => setConfirmDeleteId(null)}>
                    <Text style={styles.confirmNoText}>No</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.rowGap}>
                  <Pressable style={styles.iconBtn} onPress={() => startEdit(ws)} hitSlop={6}>
                    <Ionicons name="pencil" size={14} color={colors.textTertiary} />
                  </Pressable>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => setConfirmDeleteId(ws.id)}
                    disabled={workspaces.length <= 1}
                    hitSlop={6}
                  >
                    <Ionicons name="trash-outline" size={14} color={workspaces.length <= 1 ? colors.border : colors.textTertiary} />
                  </Pressable>
                </View>
              )}
            </View>
          ),
        )}

        {adding ? (
          <View style={[styles.card, styles.cardEditing]}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              autoFocus
              placeholder="Workspace name"
              placeholderTextColor={colors.textTertiary}
            />
            <View style={styles.swatchRow}>
              {WORKSPACE_PALETTE.map(c => (
                <Pressable key={c} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]} onPress={() => setColor(c)} />
              ))}
            </View>
            <View style={styles.rowGap}>
              <Pressable style={[styles.actionBtn, { flex: 1 }]} onPress={handleAdd}>
                <Text style={styles.actionBtnText}>Create</Text>
              </Pressable>
              <Pressable style={styles.actionBtnOutline} onPress={() => { setAdding(false); setName(''); }}>
                <Text style={styles.actionBtnOutlineText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : canAddWorkspace ? (
          <Pressable style={styles.newBtn} onPress={() => setAdding(true)}>
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.newBtnText}>New workspace</Text>
          </Pressable>
        ) : (
          <ProUpsell
            title="Keep work and life apart"
            benefit="Separate workspaces give each context its own tasks, projects and pomodoro history, so a report for one never counts the other."
          />
        )}
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
  hint: { fontSize: 12.5, color: colors.textTertiary, lineHeight: 18, marginBottom: 16 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  cardEditing: { flexDirection: 'column', alignItems: 'stretch', borderColor: colors.borderStrong },
  dot: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 13, fontWeight: '700', color: colors.surface },
  wsMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  wsName: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: { fontSize: 11, color: colors.textTertiary },
  confirmYes: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.accent },
  confirmYesText: { fontSize: 11, fontWeight: '700', color: colors.surface },
  confirmNo: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmNoText: { fontSize: 11, color: colors.textTertiary },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    marginBottom: 10,
  },
  swatchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
  swatchSelected: { borderWidth: 2, borderColor: colors.text },
  actionBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  actionBtnText: { fontSize: 13, fontWeight: '700', color: colors.surface },
  actionBtnOutline: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnOutlineText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
    borderRadius: 12,
    marginTop: 4,
  },
  allDot: { backgroundColor: colors.border },
  newBtnText: { fontSize: 13.5, fontWeight: '600', color: colors.accent },
});
