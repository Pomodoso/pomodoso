import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { achievementTier, badgeKind, nextAchievementTier } from '@pomodoso/types';
import type { AchievementTier } from '@pomodoso/types';

import { colors } from '@/constants/theme';

const TIER_STYLE: Record<AchievementTier, { ring: string; label: string }> = {
  bronze: { ring: '#B08D57', label: 'Bronze' },
  silver: { ring: '#A8B0B8', label: 'Silver' },
  gold: { ring: '#D4AF37', label: 'Gold' },
  platinum: { ring: '#7FD3E0', label: 'Platinum' },
};

function Badge({ kind, count }: { kind: string; count: number }) {
  const tier = achievementTier(count);
  if (!tier) return null;
  const style = TIER_STYLE[tier];
  const meta = badgeKind(kind);
  const next = nextAchievementTier(count);

  return (
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
        <Text style={styles.title}>{style.label} {meta.noun}</Text>
        <Text style={styles.subtitle}>{meta.describe(count)}</Text>
        {next && (
          <Text style={styles.next}>
            {next.remaining} more for {TIER_STYLE[next.tier].label}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Every kind present is rendered, not a hard-coded one: `kind` is free text on
 * the wire so a new badge ships without a migration, and a medal awarded by a
 * newer client must not be invisible here.
 *
 * Only earned badges are shown. A grid of locked placeholders turns the tab
 * into a checklist of things you haven't done, which is the opposite of what
 * finishing a three-week run should feel like.
 */
export function AchievementsSection({ counts }: { counts: Map<string, number> }) {
  if (counts.size === 0) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>Achievements</Text>
      {[...counts].map(([kind, count]) => <Badge key={kind} kind={kind} count={count} />)}
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
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
