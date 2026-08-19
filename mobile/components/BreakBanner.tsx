import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

interface BreakBannerProps {
  variant: 'offer-break' | 'break-over';
  taskTitle: string | null;
  breakLabel?: string; // e.g. "5 min break" — only for offer-break
  onPrimary: () => void;
  onSecondary: () => void;
}

// Mirrors the extension's post-session prompts (HomeState.tsx pomo-done /
// break-done states) — minus the silent auto-start-after-snooze countdown,
// which needs a background JS timer iOS won't reliably run (see
// useTimer.ts's PendingBreak doc comment). Manual Start/Skip instead.
export function BreakBanner({ variant, taskTitle, breakLabel, onPrimary, onSecondary }: BreakBannerProps) {
  const isOffer = variant === 'offer-break';

  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>{isOffer ? '🍅' : '☕'}</Text>
      <Text style={styles.title}>{isOffer ? 'Take a break!' : "Break's over!"}</Text>
      {taskTitle && (
        <Text style={styles.subtitle} numberOfLines={1}>
          {isOffer ? `Finished: ${taskTitle}` : `Back to: ${taskTitle}`}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable style={styles.primaryBtn} onPress={onPrimary}>
          <Text style={styles.primaryBtnText}>{isOffer ? `Start ${breakLabel}` : 'Start next pomodoro'}</Text>
        </Pressable>
        <Pressable style={styles.secondaryBtn} onPress={onSecondary}>
          <Text style={styles.secondaryBtnText}>{isOffer ? 'Skip' : 'Dismiss'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.breakSoft,
    borderWidth: 1,
    borderColor: colors.break,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
  },
  emoji: { fontSize: 32, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 8, width: '100%' },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.break,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryBtnText: { fontSize: 14, fontWeight: '700', color: colors.surface },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
});
