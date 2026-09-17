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
