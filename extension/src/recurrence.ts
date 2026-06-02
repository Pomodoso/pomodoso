import type { RecurrenceRule } from '@pomodoso/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function formatRecurrenceLabel(rule: RecurrenceRule): string {
  const time = rule.time ? ` at ${rule.time}` : ' · All day';
  switch (rule.freq) {
    case 'daily':
      return `Every day${time}`;
    case 'weekly': {
      const days = (rule.weekdays ?? []).map(d => DAY_NAMES[d] ?? '').filter(Boolean).join(', ');
      return `Every ${days || 'week'}${time}`;
    }
    case 'monthly':
      return `Every ${ordinal(rule.monthDay ?? 1)} of the month${time}`;
    case 'yearly': {
      const month = MONTH_NAMES[(rule.yearMonth ?? 1) - 1] ?? '';
      return `Every ${month} ${rule.yearDay ?? 1}${time}`;
    }
  }
}

// True if the rule has an occurrence on `date` (YYYY-MM-DD) AND the scheduled
// time has already passed (or there is no time — all-day tasks appear immediately).
export function shouldBeInTodayNow(rule: RecurrenceRule, date: string): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;

  const d = new Date(date + 'T00:00:00');
  let occursToday: boolean;
  switch (rule.freq) {
    case 'daily':    occursToday = true; break;
    case 'weekly':   occursToday = (rule.weekdays ?? []).includes(d.getDay()); break;
    case 'monthly':  occursToday = d.getDate() === (rule.monthDay ?? 1); break;
    case 'yearly':
      occursToday = d.getMonth() + 1 === (rule.yearMonth ?? 1) && d.getDate() === (rule.yearDay ?? 1);
      break;
  }
  if (!occursToday) return false;

  // If a time is set, only add to Today once the clock has passed that hour.
  if (rule.time) {
    const [hStr, mStr] = rule.time.split(':');
    const scheduledMinutes = parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < scheduledMinutes) return false;
  }
  return true;
}

// Kept for callers that only care about the date (not the time).
export function shouldOccurOn(rule: RecurrenceRule, date: string): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  const d = new Date(date + 'T00:00:00');
  switch (rule.freq) {
    case 'daily':   return true;
    case 'weekly':  return (rule.weekdays ?? []).includes(d.getDay());
    case 'monthly': return d.getDate() === (rule.monthDay ?? 1);
    case 'yearly':
      return d.getMonth() + 1 === (rule.yearMonth ?? 1) && d.getDate() === (rule.yearDay ?? 1);
  }
}
