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
 * Earned badges, GitHub-profile style: one medal per kind with an xN chip.
 *
 * Only earned badges are shown — a wall of locked placeholders turns the page
 * into a list of things you haven't done. Read-only here: awards are earned by
 * completing a run, which happens in the extension or the app.
 */
export function AchievementsCard({ achievements }: { achievements: AchievementInfo[] }) {
  const challenge = achievements.find(a => a.kind === 'challenge_21');
  const count = challenge?.count ?? 0;
  const tier = achievementTier(count);
  if (!tier) return null;
  const style = TIER_STYLE[tier];
  const next = nextAchievementTier(count);

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-trophy" /> Achievements</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '4px 0' }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div
            title={`${style.label} · ${count} completed`}
            style={{
              width: 56, height: 56, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${style.ring}`, fontSize: 24,
            }}
          >
            <i className="ti ti-trophy" style={{ color: style.ring }} />
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
          <div style={{ fontSize: 14, fontWeight: 700 }}>{style.label} challenger</div>
          <div style={{ fontSize: 12, color: 'var(--text-sec)' }}>
            {count} × 21-day challenge{count === 1 ? '' : 's'} completed
          </div>
          {next && (
            <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
              {next.remaining} more for {TIER_STYLE[next.tier].label}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
