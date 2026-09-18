// Copy for habit streaks and challenge cards, shared by all three clients.
//
// The extension, mobile and the web dashboard each render their own card — the
// styling is per-platform and there's nothing to share there — but the wording
// and the "is it finished" rule are not per-platform. They lived in three
// places and had already drifted once: the strings were still Spanish in the
// extension and mobile long after the rest of the app was English, and the web
// had no challenge UI at all to drift from.

/** A challenge is finished once its day count reaches its length. */
export function challengeComplete(daysDone: number, lengthDays: number): boolean {
  return daysDone >= lengthDays;
}

/**
 * Day count for display, capped at the challenge length.
 *
 * `daysDone` keeps growing with the underlying streak after a challenge is
 * complete, so without the cap a finished 21-day run reads "Day 34 of 21".
 */
export function challengeDaysShown(daysDone: number, lengthDays: number): number {
  return Math.min(daysDone, lengthDays);
}

export function challengeProgressLabel(daysDone: number, lengthDays: number): string {
  return challengeComplete(daysDone, lengthDays)
    ? `Completed! ${lengthDays} of ${lengthDays} days`
    : `Day ${daysDone} of ${lengthDays}. One day at a time.`;
}

export function challengeStreakLabel(daysDone: number, lengthDays: number): string {
  const shown = challengeDaysShown(daysDone, lengthDays);
  return `${shown}/${lengthDays} days · ${shown > 0 ? 'streak alive' : 'no streak yet'}`;
}

/**
 * The streak line under a habit's name.
 *
 * Counts days *before* today, so a habit not yet done today doesn't read as a
 * broken streak — see computeHabitStreak (clients) and habit_streak.rs
 * (backend), which both draw the same distinction.
 */
export function habitStreakLabel(pastStreak: number): string {
  return pastStreak > 0 ? `🔥 ${pastStreak} day streak` : 'No streak yet';
}

// ─── Challenge lifecycle ──────────────────────────────────────────────────────
//
// A challenge used to be a pure view of the habit's current streak, capped at
// its length. That made two things impossible to express, and both bit:
//
//   - A missed day silently reset the count to zero. Day 20 became "Day 0 of
//     21", indistinguishable from never having started, with no acknowledgement
//     that twenty days of work had just been discarded.
//   - Completion was never recorded, only recomputed. Finish 21 days, take one
//     rest day, and the streak collapsed — so the app revoked the trophy and
//     the card went back to "Day 0 of 21".
//
// Storing when the run began, which misses were forgiven, and when it finished
// is what makes "started the 1st, missed the 8th, carried on, finished the
// 22nd" a thing the model can hold at all.

export interface ChallengeState {
  lengthDays: number;
  /** YYYY-MM-DD the current run began. */
  startedAt: string;
  /** YYYY-MM-DD it was completed, or null while still running. Never recomputed. */
  completedAt: string | null;
  /** Missed days the user chose to carry on through. They don't count toward
   *  progress, so forgiving one pushes the finish line out by a day. */
  skippedDays: string[];
}

/** One scheduled day of a run and whether the habit was done on it. */
export interface ChallengeDay {
  date: string;
  done: boolean;
}

export interface ChallengeProgress {
  /** Completed scheduled days since the run began. Uncapped — cap at display
   *  time with challengeDaysShown so a finished run doesn't read "Day 34 of 21". */
  daysDone: number;
  complete: boolean;
  completedAt: string | null;
  /** Past scheduled days that were missed and not forgiven, oldest first.
   *  Non-empty means the run is waiting on the user to choose. */
  missedDays: string[];
}

/** A local YYYY-MM-DD shifted by n days. Midday avoids DST edges. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/**
 * The scheduled days a run covers, from its start through today inclusive.
 *
 * Clients supply the two predicates because each reads its schedule and
 * history differently; the walk itself lives here so the three of them cannot
 * disagree about which days a run is even made of.
 *
 * A start date in the future (clock skew, a device in another timezone)
 * yields nothing rather than walking backwards.
 */
export function challengeDaysOf(
  startedAt: string,
  today: string,
  isScheduled: (date: string) => boolean,
  isDone: (date: string) => boolean,
): ChallengeDay[] {
  const days: ChallengeDay[] = [];
  for (let date = startedAt; date <= today; date = addDays(date, 1)) {
    if (isScheduled(date)) days.push({ date, done: isDone(date) });
    // Guard against a pathological range rather than spinning forever.
    if (days.length > 3650) break;
  }
  return days;
}

/**
 * Progress for a run, from the scheduled days it covers.
 *
 * Callers pass the days because each client reads history differently — a Map
 * in the extension, SQL rows on mobile, a joined query on the backend — while
 * the rules about what counts must not differ. `days` should be every
 * scheduled day from `startedAt` through `today` inclusive, in order.
 *
 * Today is never counted as missed: the day isn't over.
 */
export function challengeProgress(
  state: ChallengeState,
  days: ChallengeDay[],
  today: string,
): ChallengeProgress {
  const skipped = new Set(state.skippedDays);
  let daysDone = 0;
  const missedDays: string[] = [];
  for (const day of days) {
    if (day.done) {
      daysDone++;
    } else if (day.date < today && !skipped.has(day.date)) {
      missedDays.push(day.date);
    }
  }
  return {
    daysDone,
    // Once recorded, completion stands. A later rest day cannot take it back.
    complete: state.completedAt !== null || daysDone >= state.lengthDays,
    completedAt: state.completedAt,
    missedDays,
  };
}

/**
 * How many missed days a run may forgive before it has to restart.
 *
 * Unlimited forgiveness was the obvious first answer and the wrong one: if
 * every miss can be waved through, "21 days" degrades to "21 days eventually",
 * and a run could take six months with forty skips and still claim the trophy.
 * The premise of a fixed-length challenge is consistency, so the allowance has
 * to be small enough that finishing still means something.
 *
 * Roughly one per week of the run — 3 on a 21-day challenge, 1 on a 7-day one.
 * Always at least 1: a challenge you can fail on a single bad day is a
 * punishment, not a challenge.
 */
export function challengeSkipAllowance(lengthDays: number): number {
  return Math.max(1, Math.floor(lengthDays / 7));
}

export function challengeSkipsLeft(state: ChallengeState): number {
  return Math.max(0, challengeSkipAllowance(state.lengthDays) - state.skippedDays.length);
}

/**
 * Whether the pending misses can still be forgiven.
 *
 * A single break spanning several days costs one skip per day, which is what
 * makes "two days in a row" harder to wave through than two isolated days —
 * the same mechanism, no special rule for consecutive misses.
 */
export function challengeCanKeepGoing(state: ChallengeState, missedDays: string[]): boolean {
  return missedDays.length > 0 && missedDays.length <= challengeSkipsLeft(state);
}

/** True when the run is stalled waiting for the user to keep going or start over. */
export function challengeNeedsDecision(progress: ChallengeProgress): boolean {
  return !progress.complete && progress.missedDays.length > 0;
}

/**
 * Forgive the misses so far: they stop counting, and the finish line moves out
 * by one day for each, because the run still needs `lengthDays` done days.
 *
 * Refuses (returns the state unchanged) when the allowance can't cover them, so
 * a caller that skips challengeCanKeepGoing can't quietly overspend it.
 */
export function challengeKeepGoing(state: ChallengeState, missedDays: string[]): ChallengeState {
  if (!challengeCanKeepGoing(state, missedDays)) return state;
  return { ...state, skippedDays: [...new Set([...state.skippedDays, ...missedDays])] };
}

/** Begin again from today, discarding the run's progress and forgiven days. */
export function challengeStartOver(state: ChallengeState, today: string): ChallengeState {
  return { ...state, startedAt: today, completedAt: null, skippedDays: [] };
}

/**
 * Only a run of exactly this length earns an achievement.
 *
 * A challenge can be any length — the card works the same for 7 or 30 days —
 * but the badge is for the 21-day one specifically. Without a fixed length
 * there is nothing to stop three-day challenges being farmed for badges, and
 * "21 days" is the thing the achievement is supposed to mean.
 */
export const BADGE_CHALLENGE_LENGTH = 21;

/**
 * Whether finishing this run would earn an achievement.
 *
 * Spending a skip saves the run but forfeits the badge. That is what makes the
 * choice at a missed day a real one: keep going and finish, or start over and
 * keep the badge in play. Surfacing it at the decision matters — finding out
 * at day 21 that the badge was lost on day 8 would be the worst version of
 * this.
 */
export function challengeEarnsBadge(state: ChallengeState): boolean {
  return state.lengthDays === BADGE_CHALLENGE_LENGTH && state.skippedDays.length === 0;
}

/** Record the finish. Idempotent: an already-completed run keeps its date. */
export function challengeRecordCompletion(state: ChallengeState, today: string): ChallengeState {
  return state.completedAt !== null ? state : { ...state, completedAt: today };
}

// ─── Achievements ─────────────────────────────────────────────────────────────
//
// Earned achievements are stored and synced rather than derived, so the same
// badges show on every device. One row per earning, append-only: the count is
// the number of rows, which is what the `xN` chip shows.

export type AchievementKind = 'challenge_21';

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/**
 * Tier thresholds, GitHub-style but far gentler.
 *
 * Each 21-day challenge is three weeks of real work, so GitHub's x16/x128 would
 * be unreachable. Platinum at 10 is about seven months of completed
 * challenges — ambitious without being theoretical.
 */
export const ACHIEVEMENT_TIERS: readonly { tier: AchievementTier; atLeast: number }[] = [
  { tier: 'platinum', atLeast: 10 },
  { tier: 'gold', atLeast: 5 },
  { tier: 'silver', atLeast: 3 },
  { tier: 'bronze', atLeast: 1 },
];

/** The tier for a count, or null when nothing has been earned yet. */
export function achievementTier(count: number): AchievementTier | null {
  return ACHIEVEMENT_TIERS.find(t => count >= t.atLeast)?.tier ?? null;
}

/** How many more are needed for the next tier, or null at the top. */
export function nextAchievementTier(count: number): { tier: AchievementTier; remaining: number } | null {
  // Ascending, so the first threshold above the current count is the next one.
  const ascending = [...ACHIEVEMENT_TIERS].reverse();
  const next = ascending.find(t => count < t.atLeast);
  return next ? { tier: next.tier, remaining: next.atLeast - count } : null;
}
