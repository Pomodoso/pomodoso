import { challengeComplete, challengeDaysShown, challengeProgressLabel, challengeStreakLabel } from '@pomodoso/types';
import { habitIconClass, habitIconColor } from '../lib/habitIcons.ts';

export interface TodayChallenge {
  id: string;
  name: string;
  icon: string;
  length_days: number;
  days_done: number;
}

/**
 * Habit challenges — fixed-length runs with an end — as their own card.
 *
 * Not a section of the habit list, for two reasons the extension and mobile
 * cards share: the list is filtered to what's scheduled today and a challenge
 * shows every day of its run, and a challenge that has *finished* keeps
 * showing. The day after a 21-day run completes is exactly when you least want
 * it to disappear.
 *
 * Progress arrives precomputed (`/today`'s `challenges`, `/habits`'
 * `challenge_days_done`) — the browser has no local copy of the logs to derive
 * it from, which is why backend/src/habit_streak.rs exists.
 */
export function ChallengesCard({ challenges }: { challenges: TodayChallenge[] }) {
  if (challenges.length === 0) return null;
  const completed = challenges.filter(c => challengeComplete(c.days_done, c.length_days)).length;

  return (
    <div className="pomo-card">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-flame" /> Challenges</div>
        {completed > 0 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>{completed} done</span>
        )}
      </div>
      {challenges.map((c) => {
        const shown = challengeDaysShown(c.days_done, c.length_days);
        const complete = challengeComplete(c.days_done, c.length_days);
        return (
          <div
            key={c.id}
            style={{
              border: `1px solid ${complete ? 'var(--success)' : 'var(--accent)'}`,
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <i
                className={`ti ${habitIconClass(c.icon)}`}
                style={{ color: complete ? 'var(--success)' : habitIconColor(c.icon) }}
              />
              <span style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</span>
              {complete && <i className="ti ti-trophy" style={{ color: 'var(--success)' }} />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 8 }}>
              {challengeProgressLabel(shown, c.length_days)}
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${(shown / c.length_days) * 100}%`,
                  height: '100%',
                  background: complete ? 'var(--success)' : 'var(--accent)',
                }}
              />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-sec)', marginTop: 6 }}>
              {challengeStreakLabel(shown, c.length_days)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
