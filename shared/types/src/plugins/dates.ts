// Day arithmetic on local `YYYY-MM-DD` strings. Done in UTC on purpose: a
// date string has no timezone, so treating it as UTC midnight makes every
// step exactly one day with no DST edges. The timezone only matters when a
// timestamp becomes a day (localDayOf).

import { RANGE_PATTERN, type GroupPeriod } from './catalog.ts';

function toUtc(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * 86_400_000);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** First day of the month `n` months away from `day`'s month. */
export function addMonths(day: string, n: number): string {
  const d = new Date(toUtc(day));
  return fromUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/** Most recent `weekStart` day on or before `day` (0 = Monday … 6 = Sunday, as in the extension). */
export function weekStartOf(day: string, weekStart: number): string {
  const dow = (new Date(toUtc(day)).getUTCDay() + 6) % 7;
  return addDays(day, -((dow - weekStart + 7) % 7));
}

export function periodStart(day: string, period: GroupPeriod, weekStart: number): string {
  if (period === 'day') return day;
  if (period === 'week') return weekStartOf(day, weekStart);
  return day.slice(0, 8) + '01';
}

export function nextPeriod(start: string, period: GroupPeriod): string {
  if (period === 'day') return addDays(start, 1);
  if (period === 'week') return addDays(start, 7);
  return addMonths(start, 1);
}

/** Whole `period` boundaries crossed going from `from` to `to`. */
export function periodsBetween(from: string, to: string, period: GroupPeriod, weekStart: number): number {
  if (period === 'day') return daysBetween(from, to);
  if (period === 'week') return Math.round(daysBetween(weekStartOf(from, weekStart), weekStartOf(to, weekStart)) / 7);
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

/** The local day a timestamp falls on in `timeZone`. */
export function localDayOf(timestamp: string, timeZone: string): string {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone });
}

export interface DayRange {
  /** Inclusive; undefined = no lower bound. */
  start?: string;
  /** Inclusive. */
  end: string;
}

/**
 * The days a range covers, ending today. `this_*` are calendar periods;
 * `14d` is the last 14 days including today; `12mo` is the current month
 * plus the 11 before it.
 */
export function resolveRange(range: string, today: string, weekStart: number): DayRange {
  switch (range) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case 'this_week':
      return { start: weekStartOf(today, weekStart), end: today };
    case 'last_week': {
      const start = addDays(weekStartOf(today, weekStart), -7);
      return { start, end: addDays(start, 6) };
    }
    case 'this_month':
      return { start: today.slice(0, 8) + '01', end: today };
    case 'last_month': {
      const start = addMonths(today, -1);
      return { start, end: addDays(today.slice(0, 8) + '01', -1) };
    }
    case 'this_year':
      return { start: today.slice(0, 4) + '-01-01', end: today };
    case 'all':
      return { end: today };
  }
  const unit = RANGE_PATTERN.exec(range)?.[1];
  if (unit === undefined) throw new Error(`invalid range "${range}"`);
  const n = Number(range.slice(0, -unit.length));
  return unit === 'd' ? { start: addDays(today, -(n - 1)), end: today } : { start: addMonths(today, -(n - 1)), end: today };
}

/** Range used for a grouped series when the file doesn't name one. */
export const DEFAULT_SERIES_RANGE: Record<GroupPeriod, string> = { day: '14d', week: '84d', month: '12mo' };
