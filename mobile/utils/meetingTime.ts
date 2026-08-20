// A synced all-day Google event carries a bare YYYY-MM-DD `time` (Google's
// own `event.start.date` shape for all-day events, no `dateTime`) — parsing
// that with `new Date()` reads it as UTC midnight, which lands on the wrong
// local calendar day for any timezone behind UTC. Anything else (a real
// ISO datetime) parses normally. Shared between useMeetings.ts (display)
// and googleCalendar.ts (the soft-delete-stale-meetings pass, which needs
// the same today's-local-date-range logic as the fetch itself) so the fix
// only exists in one place.
export function isAllDayMeetingTime(time: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(time);
}

export function parseMeetingTime(time: string): Date {
  if (isAllDayMeetingTime(time)) {
    const [y, m, d] = time.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(time);
}
