// Matches extension's HomeState.tsx exactly: Monday-first labels, 0=Mon..6=Sun
// day-of-week convention, [] meaning "every day" (the extension's own habit
// form always saves a length-7 selection back down to []).
export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

// JS Date#getDay() is 0=Sun..6=Sat — shift to the 0=Mon..6=Sun convention
// habit.days uses everywhere else.
export function toMondayFirstDow(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function isScheduledToday(days: number[]): boolean {
  return days.length === 0 || days.includes(toMondayFirstDow(new Date()));
}

export function parseDays(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function daysSummary(days: number[]): string | null {
  if (days.length === 0 || days.length === 7) return null; // every day — nothing extra to show
  return days.map(d => DAY_LABELS[d]).join(' ');
}
