import { Ionicons } from '@expo/vector-icons';
import { isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { db } from '@/db/client';
import { habits, pomodoroSession, task } from '@/db/schema';
import { importBackup, shareBackup } from '@/utils/backup';

// Ports extension's SettingsState.tsx DataPage.
export default function DataSettingsScreen(): React.JSX.Element {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Every non-deleted row, matching what an export actually writes. The old
  // More tab counted only status='completed' sessions, so it read "0
  // sessions" for anyone whose sessions were all stopped early.
  const { data: allTasks } = useLiveQuery(db.select().from(task).where(isNull(task.deletedAt)));
  const { data: allHabits } = useLiveQuery(db.select().from(habits).where(isNull(habits.deletedAt)));
  const { data: allSessions } = useLiveQuery(
    db.select().from(pomodoroSession).where(isNull(pomodoroSession.deletedAt)),
  );

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      await shareBackup();
    } catch (err) {
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setExporting(false);
    }
  }

  async function handleImport(): Promise<void> {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    let content: string;
    try {
      content = await new File(uri).text();
    } catch {
      Alert.alert('Import failed', 'Could not read the selected file.');
      return;
    }
    Alert.alert('Replace all data?', 'This will replace ALL your current tasks, habits, sessions, and settings. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Replace all data',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setImporting(true);
            try {
              await importBackup(content);
              Alert.alert('Import complete', 'Your data has been restored.');
            } catch (err) {
              Alert.alert('Import failed', err instanceof Error ? err.message : 'Unknown error');
            } finally {
              setImporting(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Data</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Export</Text>
          <Text style={styles.hint}>Download all your tasks, habits, sessions, and settings as a JSON file.</Text>
          <Pressable
            style={[styles.actionBtn, exporting && styles.actionBtnDisabled]}
            onPress={() => void handleExport()}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={15} color={colors.surface} />
                <Text style={styles.actionBtnText}>Export data</Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Import</Text>
          <Text style={styles.hint}>Restore data from a previously exported file. This replaces all current data.</Text>
          <Pressable
            style={[styles.actionBtnOutline, importing && styles.actionBtnDisabled]}
            onPress={() => void handleImport()}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={15} color={colors.text} />
                <Text style={styles.actionBtnOutlineText}>Choose file…</Text>
              </>
            )}
          </Pressable>
        </View>

        {/* Moved here from the old More tab: what an export would contain
            belongs next to the export button, not on a separate screen. */}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Stored on this device</Text>
          <Text style={styles.hint}>
            {(allTasks ?? []).length} tasks · {(allHabits ?? []).length} habits · {(allSessions ?? []).length} sessions
          </Text>
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
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 8 },
  hint: { fontSize: 11, color: colors.textTertiary, marginTop: 6 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 10,
  },
  actionBtnText: { fontSize: 13.5, fontWeight: '700', color: colors.surface },
  actionBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 10,
  },
  actionBtnOutlineText: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  actionBtnDisabled: { opacity: 0.6 },
});
