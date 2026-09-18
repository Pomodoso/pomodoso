import { achievementTier, nextAchievementTier } from '@pomodoso/types';
import type { AchievementTier } from '@pomodoso/types';

export interface AchievementInfo {
  kind: string;
  count: number;
  latest: string | null;
}

const TIER_STYLE: Record<AchievementTier, { ring: string; label: string }> = {
  bronze: { ring: '#B08D57', label: 'Bronze' },
  silver: { ring: '#A8B0B8', label: 'Silver' },
  gold: { ring: '#D4AF37', label: 'Gold' },
  platinum: { ring: '#7FD3E0', label: 'Platinum' },
};

/**
 * How each badge kind presents itself.
 *
 * `kind` is free text on the wire precisely so a new badge ships without a
 * migration, which means this page will meet kinds it has never heard of —
 * from a newer client, or a newer version of itself. Those render with the
 * kind as their name rather than vanishing.
 */
const BADGE_KINDS: Record<string, { noun: string; icon: string; describe: (n: number) => string }> = {
  challenge_21: {
    noun: 'challenger',
    icon: 'ti-trophy',
    describe: n => `${n} × 21-day challenge${n === 1 ? '' : 's'} completed`,
  },
};

function badgeKind(kind: string) {
  return BADGE_KINDS[kind] ?? {
    noun: kind,
    icon: 'ti-award',
    describe: (n: number) => `${n} earned`,
  };
}

function Badge({ achievement }: { achievement: AchievementInfo }) {
  const { count, kind } = achievement;
  const tier = achievementTier(count);
  if (!tier) return null;
  const style = TIER_STYLE[tier];
  const meta = badgeKind(kind);
  const next = nextAchievementTier(count);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div
          title={`${style.label} · ${count} earned`}
          style={{
            width: 56, height: 56, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${style.ring}`, fontSize: 24,
          }}
        >
          <i className={`ti ${meta.icon}`} style={{ color: style.ring }} />
        </div>
        {count > 1 && (
          <span style={{
            position: 'absolute', bottom: -2, right: -6,
            padding: '1px 6px', borderRadius: 9,
            fontSize: 11, fontWeight: 700,
            background: style.ring, color: '#fff',
          }}>
            x{count}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{style.label} {meta.noun}</div>
        <div style={{ fontSize: 12, color: 'var(--text-sec)' }}>{meta.describe(count)}</div>
        {next && (
          <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
            {next.remaining} more for {TIER_STYLE[next.tier].label}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Only earned badges are shown — a wall of locked placeholders turns the page
 * into a list of things you haven't done. Read-only here: awards are earned by
 * completing a run, which happens in the extension or the app.
 */
export function AchievementsCard({ achievements }: { achievements: AchievementInfo[] }) {
  const earned = achievements.filter(a => a.count > 0);
  if (earned.length === 0) return null;

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-trophy" /> Achievements</div>
      </div>
      {earned.map(a => <Badge key={a.kind} achievement={a} />)}
    </div>
  );
}
