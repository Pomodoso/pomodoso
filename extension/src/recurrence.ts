import type { RecurrenceRule } from '@pomodoso/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

export function formatRecurrenceLabel(rule: RecurrenceRule): string {
  const n = Math.max(1, Math.floor(rule.interval ?? 1));
  const time = rule.time ? ` at ${rule.time}` : ' · All day';
  switch (rule.freq) {
    case 'daily':
      return (n > 1 ? `Every ${n} days` : 'Every day') + time;
    case 'weekly': {
      const days = (rule.weekdays ?? []).map(d => DAY_NAMES[d] ?? '').filter(Boolean).join(', ');
      if (n > 1) return `Every ${n} weeks${days ? ' on ' + days : ''}${time}`;
      return `Every ${days || 'week'}${time}`;
    }
    case 'monthly':
      return (n > 1
        ? `Every ${n} months on the ${ordinal(rule.monthDay ?? 1)}`
        : `Every ${ordinal(rule.monthDay ?? 1)} of the month`) + time;
    case 'yearly': {
      const month = MONTH_NAMES[(rule.yearMonth ?? 1) - 1] ?? '';
      return (n > 1
        ? `Every ${n} years on ${month} ${rule.yearDay ?? 1}`
        : `Every ${month} ${rule.yearDay ?? 1}`) + time;
    }
  }
}

function parseYmd(s: string): Date {
  return new Date(s + 'T00:00:00');
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

// True if the rule has an occurrence on `date` (YYYY-MM-DD). Respects `interval`
// (every N units), counting periods from `startDate`.
export function shouldOccurOn(rule: RecurrenceRule, date: string): boolean {
  if (date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;

  const n = Math.max(1, Math.floor(rule.interval ?? 1));
  const d = parseYmd(date);
  const start = parseYmd(rule.startDate);

  switch (rule.freq) {
    case 'daily':
      return daysBetween(start, d) % n === 0;
    case 'weekly': {
      if (!(rule.weekdays ?? []).includes(d.getDay())) return false;
      if (n === 1) return true;
      // Week index relative to the start date's week (weeks anchored to Sunday).
      const startWeek = new Date(start);
      startWeek.setDate(start.getDate() - start.getDay());
      const dWeek = new Date(d);
      dWeek.setDate(d.getDate() - d.getDay());
      return Math.round(daysBetween(startWeek, dWeek) / 7) % n === 0;
    }
    case 'monthly': {
      if (d.getDate() !== (rule.monthDay ?? 1)) return false;
      if (n === 1) return true;
      const months =
        (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
      return months % n === 0;
    }
    case 'yearly': {
      if (!(d.getMonth() + 1 === (rule.yearMonth ?? 1) && d.getDate() === (rule.yearDay ?? 1)))
        return false;
      if (n === 1) return true;
      return (d.getFullYear() - start.getFullYear()) % n === 0;
    }
  }
}

// Occurs on `date` AND the scheduled time has already passed (all-day appears
// immediately). Shares the date logic with shouldOccurOn.
export function shouldBeInTodayNow(rule: RecurrenceRule, date: string): boolean {
  if (!shouldOccurOn(rule, date)) return false;
  if (rule.time) {
    const [hStr, mStr] = rule.time.split(':');
    const scheduledMinutes = parseInt(hStr ?? '0', 10) * 60 + parseInt(mStr ?? '0', 10);
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < scheduledMinutes) return false;
  }
  return true;
}
