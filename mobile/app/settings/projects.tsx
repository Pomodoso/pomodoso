import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { projectArchived, projectArchiveEndDate } from '@pomodoso/types';

import { PROJECT_PALETTE } from '@/constants/projectPalette';
import { colors } from '@/constants/theme';
import type { ProjectRow } from '@/db/schema';
import { useProjects } from '@/hooks/useProjects';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useTodayDate } from '@/hooks/useTodayDate';

// Mirrors the extension's Settings > Projects (SettingsState.tsx ProjectsPage).
// Projects could only be edited from the project picker, and an archived one
// dropped out of it, so it couldn't be brought back. This lists every project
// in the current workspace, active and archived, with edit, archive,
// unarchive and delete. Archiving ends the project yesterday; see
// projectArchived in @pomodoso/types.
export default function ProjectsSettingsScreen(): React.JSX.Element {
  const today = useTodayDate();
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const { workspaceId, isAll, workspaces } = useWorkspace();
  // Under "All workspaces" the list spans several, so each row says which one
  // it belongs to and a new project asks where to go, like the extension.
  const spansWorkspaces = isAll && workspaces.length > 1;
  const wsById = new Map(workspaces.map(w => [w.id, w]));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const active = projects.filter(p => !projectArchived(p.endDate, today));
  const archived = projects.filter(p => projectArchived(p.endDate, today));

  function row(p: ProjectRow, isArchived: boolean): React.JSX.Element {
    if (editingId === p.id) {
      return (
        <ProjectEditor
          key={p.id}
          initial={p}
          onSave={values => { updateProject(p.id, values); setEditingId(null); }}
          onCancel={() => setEditingId(null)}
        />
      );
    }
    return (
      <View key={p.id} style={[styles.card, isArchived && styles.cardArchived]}>
        <View style={[styles.dot, { backgroundColor: p.color }]} />
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          {(spansWorkspaces || p.endDate) && (
            <Text style={styles.sub}>
              {[
                spansWorkspaces ? wsById.get(p.workspaceId)?.name : null,
                p.endDate ? (isArchived ? `Ended ${fmtDay(p.endDate)}` : `Until ${fmtDay(p.endDate)}`) : null,
              ].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        {confirmDeleteId === p.id ? (
          <View style={styles.rowGap}>
            <Text style={styles.confirmLabel}>Delete?</Text>
            <Pressable style={styles.confirmYes} onPress={() => { removeProject(p.id); setConfirmDeleteId(null); }}>
              <Text style={styles.confirmYesText}>Yes</Text>
            </Pressable>
            <Pressable style={styles.confirmNo} onPress={() => setConfirmDeleteId(null)}>
              <Text style={styles.confirmNoText}>No</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.rowGap}>
            <Pressable style={styles.iconBtn} onPress={() => { setEditingId(p.id); setConfirmDeleteId(null); }} hitSlop={6}>
              <Ionicons name="pencil" size={14} color={colors.textTertiary} />
            </Pressable>
            <Pressable
              style={styles.pill}
              onPress={() => updateProject(p.id, { endDate: isArchived ? null : projectArchiveEndDate(today) })}
            >
              <Text style={styles.pillText}>{isArchived ? 'Unarchive' : 'Archive'}</Text>
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => setConfirmDeleteId(p.id)} hitSlop={6}>
              <Ionicons name="trash-outline" size={14} color={colors.textTertiary} />
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Projects</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>Archived projects are hidden when picking a project for a task. Tasks already in them keep it.</Text>

        {active.length === 0 && !adding && <Text style={styles.empty}>No active projects.</Text>}
        {active.map(p => row(p, false))}

        {adding ? (
          <ProjectEditor
            workspaces={spansWorkspaces ? workspaces : undefined}
            defaultWorkspaceId={workspaceId}
            onSave={values => {
              const id = addProject(values.name ?? '', values.color ?? PROJECT_PALETTE[0], values.workspaceId);
              if (values.endDate) updateProject(id, { endDate: values.endDate });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Pressable style={styles.newBtn} onPress={() => { setAdding(true); setEditingId(null); }}>
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.newBtnText}>New project</Text>
          </Pressable>
        )}

        {archived.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Pressable style={styles.sectionBtn} onPress={() => setShowArchived(v => !v)}>
              <Ionicons name={showArchived ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textTertiary} />
              <Text style={styles.sectionLabel}>Archived ({archived.length})</Text>
            </Pressable>
            {showArchived && archived.map(p => row(p, true))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A real calendar date in YYYY-MM-DD, not just the shape: 2026-02-31 fails. */
function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === s;
}

/** Name, color and an optional end date, typed as YYYY-MM-DD. */
function ProjectEditor({ initial, workspaces, defaultWorkspaceId, onSave, onCancel }: {
  initial?: ProjectRow;
  /** Offered when creating under "All workspaces"; omitted otherwise. */
  workspaces?: { id: string; name: string; color: string }[] | undefined;
  defaultWorkspaceId?: string;
  onSave: (values: { name: string; color: string; endDate: string | null; workspaceId?: string }) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [wsId, setWsId] = useState(defaultWorkspaceId);
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<string>(initial?.color ?? PROJECT_PALETTE[0]);
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const trimmedDate = endDate.trim();
  const dateValid = trimmedDate === '' || isValidYmd(trimmedDate);
  const canSave = name.trim().length > 0 && dateValid;

  return (
    <View style={[styles.card, styles.cardEditing]}>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoFocus
        placeholder="Project name"
        placeholderTextColor={colors.textTertiary}
      />
      <View style={styles.swatchRow}>
        {PROJECT_PALETTE.map(c => (
          <Pressable key={c} style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]} onPress={() => setColor(c)} />
        ))}
      </View>
      {workspaces && (
        <View style={styles.wsRow}>
          {workspaces.map(w => (
            <Pressable key={w.id} style={[styles.wsChip, wsId === w.id && styles.wsChipActive]} onPress={() => setWsId(w.id)}>
              <View style={[styles.wsDot, { backgroundColor: w.color }]} />
              <Text style={[styles.wsChipText, wsId === w.id && styles.wsChipTextActive]}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Text style={styles.fieldLabel}>End date (optional): archived after this day</Text>
      <TextInput
        style={[styles.input, !dateValid && styles.inputError]}
        value={endDate}
        onChangeText={setEndDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <View style={styles.rowGap}>
        <Pressable
          style={[styles.actionBtn, { flex: 1 }, !canSave && { opacity: 0.5 }]}
          disabled={!canSave}
          onPress={() => onSave({ name: name.trim(), color, endDate: trimmedDate || null, ...(wsId ? { workspaceId: wsId } : {}) })}
        >
          <Text style={styles.actionBtnText}>Save</Text>
        </Pressable>
        <Pressable style={styles.actionBtnOutline} onPress={onCancel}>
          <Text style={styles.actionBtnOutlineText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
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
  empty: { fontSize: 13, color: colors.textTertiary, marginBottom: 12 },
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
  cardArchived: { opacity: 0.75 },
  cardEditing: { flexDirection: 'column', alignItems: 'stretch', borderColor: colors.borderStrong },
  dot: { width: 12, height: 12, borderRadius: 6 },
  main: { flex: 1, minWidth: 0 },
  name: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  sub: { fontSize: 11.5, color: colors.textTertiary, marginTop: 2 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  confirmLabel: { fontSize: 11, color: colors.textTertiary },
  confirmYes: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.accent },
  confirmYesText: { fontSize: 11, fontWeight: '700', color: colors.surface },
  confirmNo: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmNoText: { fontSize: 11, color: colors.textTertiary },
  fieldLabel: { fontSize: 11.5, color: colors.textTertiary, marginBottom: 6 },
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
  inputError: { borderColor: colors.accent },
  wsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  wsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 999, borderWidth: 1, borderColor: colors.border,
  },
  wsChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  wsDot: { width: 8, height: 8, borderRadius: 4 },
  wsChipText: { fontSize: 12.5, color: colors.textSecondary },
  wsChipTextActive: { color: colors.accent, fontWeight: '700' },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
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
  newBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
  sectionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: colors.textTertiary },
});
