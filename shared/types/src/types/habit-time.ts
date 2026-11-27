// Time habits and habit end dates, shared by the extension and mobile.
//
// A time habit is a counter whose count and goal are seconds, shown as m:ss
// (h:mm:ss from an hour). Both clients render and parse it, so the format
// lives once here; the extension had it inline and mobile had none, which is
// why a time habit read as "900/1800" on the phone.

/** Seconds as m:ss, or h:mm:ss from an hour. */
export function fmtHabitTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "mm:ss", "h:mm:ss", or a plain number of minutes, to seconds. */
export function parseHabitTime(str: string): number {
  const parts = str.split(':').map(p => parseInt(p, 10) || 0);
  const [first = 0, second = 0, third = 0] = parts;
  if (parts.length === 3) return first * 3600 + second * 60 + third;
  if (parts.length === 2) return first * 60 + second;
  return first * 60;
}

/** The +/− step of a time habit, in seconds: its own, or a minute. */
export function habitTimeStep(unitAmount: number | null | undefined): number {
  return unitAmount && unitAmount > 0 ? unitAmount : 60;
}

/**
 * A habit past its end date is closed: it leaves Today and the active list,
 * and its history stays. The end date itself is still an active day.
 */
export function habitClosed(endDate: string | null | undefined, today: string): boolean {
  return Boolean(endDate) && today > endDate!;
}
