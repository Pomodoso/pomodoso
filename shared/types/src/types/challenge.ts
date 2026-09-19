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
    // Once recorded, completion stands — a later rest day cannot take it back.
    //
    // An unresolved miss blocks completion even at full count: otherwise a run
    // that broke on day 8 and kept being logged would sail past 21, skip the
    // decision entirely, and earn a badge with skippedDays still empty. The
    // miss has to be answered first — keep going (which spends a skip and
    // forfeits the badge) or start over.
    complete:
      state.completedAt !== null || (daysDone >= state.lengthDays && missedDays.length === 0),
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

/**
 * Do two stored schedules mean the same week?
 *
 * Shared because both clients have to agree on when a run survives an edit.
 * Progress is replayed from the start date against the habit's *current*
 * schedule, so widening Mon–Fri to every day retroactively turns every past
 * weekend into a missed day and breaks a healthy run on the spot; narrowing it
 * does the reverse and quietly heals a broken one. Either way the run would be
 * judged by a rule it never ran under, so a schedule change has to start a new
 * run — and that decision is worthless if the two clients disagree on what
 * counts as a change.
 *
 * An empty array means "every day", so it compares equal to a full seven:
 * toggling the last day off and on again is not a change.
 */
export function sameSchedule(a: readonly number[], b: readonly number[]): boolean {
  const norm = (d: readonly number[]) =>
    (d.length === 0 || d.length === 7 ? '0,1,2,3,4,5,6' : [...d].sort((x, y) => x - y).join(','));
  return norm(a) === norm(b);
}

/**
 * The calendar date a run of `lengthDays` scheduled days lands on.
 *
 * A challenge counts the days you were supposed to show up, not the days on
 * the calendar. For a habit scheduled every day those are the same thing; for
 * one scheduled Monday to Friday, "21 days" is 21 weekdays — twenty-nine days
 * of calendar, four weeks and a day. Nothing in the product said so, so this
 * exists to let the UI say it.
 *
 * `alreadyLost` pushes the finish out by that many scheduled days: a forgiven
 * day never counts toward the total, so spending a skip genuinely moves the
 * end date, and a projection that ignored it would quietly go stale the first
 * time a user chose "keep going".
 *
 * Returns null when no such date exists inside the lookahead — a habit whose
 * schedule is empty of scheduled days would otherwise spin forever.
 */
export function challengeProjectedEnd(
  startedAt: string,
  lengthDays: number,
  isScheduled: (date: string) => boolean,
  alreadyLost = 0,
): string | null {
  const needed = lengthDays + alreadyLost;
  if (needed <= 0) return null;
  let counted = 0;
  let date = startedAt;
  for (let i = 0; i < MAX_PROJECTION_DAYS; i++) {
    if (isScheduled(date)) {
      counted++;
      if (counted >= needed) return date;
    }
    date = addDays(date, 1);
  }
  return null;
}

// Ten years. Long enough for any real schedule to reach any real length — a
// once-a-week habit on a 21-day challenge finishes inside five months — and
// short enough that a habit with no scheduled days at all terminates instead
// of hanging the popup.
const MAX_PROJECTION_DAYS = 3650;

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

/**
 * The kind string for the challenge badge, derived rather than written out.
 *
 * The rule that decides whether a badge is earned is
 * `lengthDays === BADGE_CHALLENGE_LENGTH`, so spelling the kind as a literal
 * lets the two drift: change the constant to 30 and every client would award a
 * badge called `challenge_21` for a thirty-day run, described as "30-day"
 * under a name that says 21.
 *
 * Deriving it also does the right thing to badges already earned. They stay
 * `challenge_21` rows, and a build whose constant has moved on renders them
 * through `badgeKind`'s fallback instead of folding them into the new badge —
 * which is correct, because a 21-day run and a 30-day run are not the same
 * achievement and their counts should not be added together.
 */
export const CHALLENGE_BADGE_KIND = `challenge_${BADGE_CHALLENGE_LENGTH}` as const;

export type AchievementKind = typeof CHALLENGE_BADGE_KIND;

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

/**
 * The id of the award a given run would produce.
 *
 * Derived from the habit and the run's start date rather than random, so one
 * run can only ever produce one award. Completion is checked and written
 * asynchronously, and two quick taps can both observe "not completed yet"
 * before either write lands — with random ids that races into two medals for
 * one challenge, silently inflating the count and the tier. A deterministic id
 * makes the second insert an idempotent upsert instead, on the client and on
 * the server.
 *
 * Not settingId: that maps characters straight to hex and truncates at 16, so
 * a 36-character habit id plus a date would collide with every other run of
 * the same habit.
 */
export function challengeAwardId(habitId: string, startedAt: string): string {
  const key = `${habitId}|${startedAt}`;
  // Four FNV-1a passes with different offset bases — 128 bits of digest from a
  // hash small enough to state inline, which is all a collision-resistant id
  // for this needs.
  const hex = [0x811c9dc5, 0x01000193, 0x7fffffff, 0x9e3779b9]
    .map(seed => {
      let h = seed >>> 0;
      for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    })
    .join('');
  // Shaped like a v5 UUID: version nibble 5, variant nibble 8.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * How each badge kind names and describes itself.
 *
 * `kind` is free text on the wire so a new badge ships without a migration,
 * which means every surface will eventually meet kinds it has never heard of —
 * from a newer client, or a newer build of itself. Shared so the three don't
 * each invent their own wording for the same medal, and so adding a badge is
 * one edit rather than three.
 *
 * Icons stay per-client: the extension draws an emoji, mobile an Ionicon, the
 * web a Tabler class. Nothing useful to share there.
 */
export interface BadgeKindMeta {
  /** Follows the tier: "Bronze challenger". */
  noun: string;
  describe: (count: number) => string;
}

/**
 * A Map, not an object literal, and that matters here.
 *
 * `kind` is unrestricted text off the wire, so a plain-object lookup answers
 * `BADGE_KINDS['constructor']` with `Object.prototype.constructor` — truthy,
 * so a `??` fallback never fires, and the caller then invokes `.describe` on a
 * function that has none. One synced row named `constructor` or `toString`
 * would crash the achievements view on every device. A Map has no prototype
 * chain to inherit from, which removes the case rather than guarding it.
 */
export const BADGE_KINDS: ReadonlyMap<string, BadgeKindMeta> = new Map([
  [CHALLENGE_BADGE_KIND, {
    noun: 'challenger',
    describe: (count: number) => `${count} × ${BADGE_CHALLENGE_LENGTH}-day challenge${count === 1 ? '' : 's'} completed`,
  }],
]);

/**
 * The descriptor for a kind, or a usable stand-in for one this build predates.
 *
 * An unknown badge renders under its own kind rather than disappearing — the
 * failure mode worth avoiding is a medal the user has earned being invisible
 * because their dashboard is older than the client that awarded it.
 */
export function badgeKind(kind: string): BadgeKindMeta {
  return BADGE_KINDS.get(kind) ?? { noun: kind, describe: count => `${count} earned` };
}
