import { and, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { meeting } from '@/db/schema';
import type { MeetingRow } from '@/db/schema';

import { useWorkspace } from './useWorkspace';

export interface TodayMeeting extends MeetingRow {
  past: boolean;
}

// A synced all-day Google event carries a bare YYYY-MM-DD `time` (Google's
// own `event.start.date` shape for all-day events, no `dateTime`) — parsing
// that with `new Date()` reads it as UTC midnight, which lands on the wrong
// local calendar day for any timezone behind UTC. Anything else (a real
// ISO datetime) parses normally.
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

// Read-only for now (Fase B6a) — meetings arrive purely via sync (from the
// extension or another mobile device that's connected Google Calendar);
// mobile's own connect flow lands in a later B6 PR. `past` is computed here
// rather than stored (unlike the extension's local row, which persists it)
// — it's a pure function of `time`/`durationMinutes`, no reason to let it
// go stale between renders.
export function useMeetings(): { meetings: TodayMeeting[] } {
  const { workspaceId } = useWorkspace();
  const { data: rows } = useLiveQuery(
    db.select().from(meeting).where(and(isNull(meeting.deletedAt), eq(meeting.workspaceId, workspaceId))),
    [workspaceId],
  );

  const todayStr = new Date().toLocaleDateString('en-CA');
  const meetings = (rows ?? [])
    .filter(m => m.trackMode !== 'off' && parseMeetingTime(m.time).toLocaleDateString('en-CA') === todayStr)
    .map(m => ({ ...m, past: parseMeetingTime(m.time).getTime() + m.durationMinutes * 60_000 < Date.now() }))
    .sort((a, b) => parseMeetingTime(a.time).getTime() - parseMeetingTime(b.time).getTime());

  return { meetings };
}
