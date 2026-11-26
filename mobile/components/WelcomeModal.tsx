import { eq } from 'drizzle-orm';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/constants/theme';
import { db } from '@/db/client';
import { settings, WELCOME_SEEN_KEY } from '@/db/schema';
import { getMobileSupabase, isAuthConfigured } from '@/lib/supabase';
import { dropUntouchedSeed, hasUserData } from '@/utils/seed';

// Ports the extension's WelcomeScreen (popup/App.tsx). Mobile seeds its demo
// content on first launch (db/client.ts's initDb), so the choice here is
// whether to keep it, not whether to write it.

function welcomeSeen(): boolean {
  return db.select().from(settings).where(eq(settings.key, WELCOME_SEEN_KEY)).all().length > 0;
}

function markWelcomeSeen(): void {
  db.insert(settings)
    .values({ key: WELCOME_SEEN_KEY, value: 'true' })
    .onConflictDoUpdate({ target: settings.key, set: { value: 'true' } })
    .run();
}

/**
 * Shown on a fresh install: nothing of the user's on the device, not signed
 * in, and never answered before. Installs from before this screen that only
 * hold untouched demo content see it once too, which is the same question.
 */
async function shouldShowWelcome(): Promise<boolean> {
  if (welcomeSeen()) return false;
  if (hasUserData()) {
    markWelcomeSeen();
    return false;
  }
  if (!isAuthConfigured()) return true;
  const { data } = await getMobileSupabase().auth.getSession();
  return data.session === null;
}

const HABITS = [['💧', 'Water'], ['🏃', 'Exercise'], ['📖', 'Read 20 min'], ['🌙', 'Sleep 8h']] as const;
const TASKS = [['★', 'Fix flaky retry test'], ['★', 'Write launch checklist'], ['·', 'Reply to review notes'], ['·', 'Daily standup notes']] as const;

export function WelcomeModal(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let live = true;
    shouldShowWelcome().then(
      show => { if (live) setVisible(show); },
      () => {},
    );
    return () => { live = false; };
  }, []);

  function close(then?: () => void): void {
    markWelcomeSeen();
    setVisible(false);
    then?.();
  }

  if (!visible) return null;

  return (
    // Not dismissable by back: every way out is one of the choices below.
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Image source={require('../assets/images/icon.png')} style={styles.logo} />
          <Text style={styles.title}>Welcome to Pomodoso!</Text>
          <Text style={styles.body}>Start with a few sample tasks and habits, or a clean slate.</Text>

          <View style={styles.preview}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Habits</Text>
              {HABITS.map(([icon, name]) => (
                <Text key={name} style={styles.item}>{icon}  {name}</Text>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Today</Text>
              {TASKS.map(([bullet, name]) => (
                <Text key={name} style={styles.item} numberOfLines={1}>
                  <Text style={bullet === '★' ? styles.star : styles.dot}>{bullet}</Text>  {name}
                </Text>
              ))}
            </View>
          </View>

          <Text style={styles.hint}>With the template you can edit, add, or delete anything. These are just examples.</Text>

          <Pressable style={styles.primary} onPress={() => close()}>
            <Text style={styles.primaryText}>Use template →</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={() => close(dropUntouchedSeed)}
          >
            <Text style={styles.secondaryText}>Start empty</Text>
          </Pressable>

          <View style={styles.divider}>
            <View style={styles.rule} />
            <Text style={styles.dividerText}>Already using Pomodoso?</Text>
            <View style={styles.rule} />
          </View>

          <View style={styles.row}>
            {/* The demo stays until sign-in: if the account has data, sync
                drops the untouched demo (dropSeedIfSupersededBy). */}
            <Pressable style={[styles.secondary, styles.half]} onPress={() => close(() => router.push('/login'))}>
              <Text style={styles.linkText}>Sign in to sync</Text>
            </Pressable>
            <Pressable style={[styles.secondary, styles.half]} onPress={() => close(() => router.push('/settings/data'))}>
              <Text style={styles.linkText}>Restore a backup</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 24, gap: 16, alignItems: 'stretch' },
  logo: { width: 56, height: 56, borderRadius: 12, alignSelf: 'center', marginTop: 24 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  body: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  preview: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 6 },
  cardLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.textTertiary, marginBottom: 2 },
  item: { fontSize: 14, color: colors.text },
  star: { color: colors.accent },
  dot: { color: colors.textTertiary },
  hint: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', lineHeight: 18 },
  primary: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  secondaryText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  rule: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 11, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  linkText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
