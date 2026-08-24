export function secondsBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

// Matches extension's fmtMins/TodayFooter's fmtTime — takes whole minutes,
// not seconds (see useTasks.ts's formatDuration for the seconds-input
// per-task variant, a distinct concern with its own rounding rule).
export function formatMinutes(totalMinutes: number): string {
  if (totalMinutes === 0) return '0m';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** The instant from which a session's elapsed time counts toward its task.
 *
 *  Normally the session's own start, but once a task can be swapped
 *  mid-pomodoro (useTimer's attachTask/detachTask) the stretch before the
 *  swap was already banked as its own session row and belongs to the task
 *  that was attached then. Counting from `startedAt` there would credit it
 *  twice.
 *
 *  Shared by the local per-task totals and the sync push so the two can't
 *  disagree about how much time a session is worth.
 */
export function creditedStart(session: { startedAt: string; taskSegmentStartedAt?: string | null }): string {
  return session.taskSegmentStartedAt ?? session.startedAt;
}
