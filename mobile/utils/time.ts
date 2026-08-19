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
