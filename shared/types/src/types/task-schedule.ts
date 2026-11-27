// Scheduling a task for a day: it waits outside Today and moves in when the day
// arrives. Shared so the extension and mobile agree on when a task is due and
// on how the date reads.
//
// `scheduledFor` is a local YYYY-MM-DD carried in the task's sync `extra`. It's
// one-shot: when the day comes the task moves into Today and the date is
// cleared, so taking it back out of Today afterwards sticks.

/** A local YYYY-MM-DD shifted by n days. Midday avoids DST edges. */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-CA');
}

/** A real calendar date in YYYY-MM-DD: 2026-02-31 is not. */
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00`);
  return !isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === s;
}

/**
 * Whether a scheduled task should move into Today now.
 *
 * On or after the day, not only on it: a device that wasn't opened that day
 * still brings it in the next time it is, instead of losing it. A finished or
 * cancelled task stays where it is.
 */
export function taskScheduleDue(
  scheduledFor: string | null | undefined,
  status: string,
  today: string,
): boolean {
  if (!scheduledFor || !isValidYmd(scheduledFor)) return false;
  if (status === 'done' || status === 'cancelled') return false;
  return scheduledFor <= today;
}

/** The quick picks: tomorrow, and next Monday (a week out when today is Monday). */
export function taskSchedulePresets(today: string): { tomorrow: string; nextMonday: string } {
  const dow = new Date(`${today}T12:00:00`).getDay(); // 0 = Sunday
  const untilMonday = ((8 - dow) % 7) || 7;
  return { tomorrow: addDays(today, 1), nextMonday: addDays(today, untilMonday) };
}

/** "Today", "Tomorrow", "Wed" within the week, else "Dec 3" (with the year when it differs). */
export function taskScheduleLabel(scheduledFor: string, today: string): string {
  if (scheduledFor <= today) return 'Today';
  if (scheduledFor === addDays(today, 1)) return 'Tomorrow';
  const d = new Date(`${scheduledFor}T12:00:00`);
  if (scheduledFor < addDays(today, 7)) return d.toLocaleDateString('en-US', { weekday: 'short' });
  const sameYear = scheduledFor.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
