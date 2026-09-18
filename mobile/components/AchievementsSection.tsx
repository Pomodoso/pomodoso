import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { achievementTier, nextAchievementTier } from '@pomodoso/types';
import type { AchievementTier } from '@pomodoso/types';

import { colors } from '@/constants/theme';

const TIER_STYLE: Record<AchievementTier, { ring: string; label: string }> = {
  bronze: { ring: '#B08D57', label: 'Bronze' },
  silver: { ring: '#A8B0B8', label: 'Silver' },
  gold: { ring: '#D4AF37', label: 'Gold' },
  platinum: { ring: '#7FD3E0', label: 'Platinum' },
};

/**
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Only earned badges are shown. A grid of locked placeholders turns the tab
 * into a checklist of things you haven't done, which is the opposite of what
 * finishing a three-week run should feel like.
 */
export function AchievementsSection({ count }: { count: number }) {
  const tier = achievementTier(count);
  if (!tier) return null;
  const style = TIER_STYLE[tier];
  const next = nextAchievementTier(count);

  return (
    <>
      <Text style={styles.sectionTitle}>Achievements</Text>
      <View style={styles.row}>
        <View style={[styles.medal, { borderColor: style.ring }]}>
          <Ionicons name="trophy" size={24} color={style.ring} />
          {count > 1 && (
            <View style={[styles.chip, { backgroundColor: style.ring }]}>
              <Text style={styles.chipText}>x{count}</Text>
            </View>
          )}
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{style.label} challenger</Text>
          <Text style={styles.subtitle}>
            {count} × 21-day challenge{count === 1 ? '' : 's'} completed
          </Text>
          {next && (
            <Text style={styles.next}>
              {next.remaining} more for {TIER_STYLE[next.tier].label}
            </Text>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  medal: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface,
  },
  chip: {
    position: 'absolute', bottom: -2, right: -6,
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 8,
    borderWidth: 1, borderColor: colors.bg,
  },
  chipText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  next: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
});
