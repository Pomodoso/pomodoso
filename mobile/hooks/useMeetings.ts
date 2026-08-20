import { isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { meeting } from '@/db/schema';
import type { MeetingRow } from '@/db/schema';

export interface TodayMeeting extends MeetingRow {
  past: boolean;
}

// Read-only for now (Fase B6a) — meetings arrive purely via sync (from the
// extension or another mobile device that's connected Google Calendar);
// mobile's own connect flow lands in a later B6 PR. `past` is computed here
// rather than stored (unlike the extension's local row, which persists it)
// — it's a pure function of `time`/`durationMinutes`, no reason to let it
// go stale between renders.
export function useMeetings(): { meetings: TodayMeeting[] } {
  const { data: rows } = useLiveQuery(db.select().from(meeting).where(isNull(meeting.deletedAt)));

  const todayStr = new Date().toLocaleDateString('en-CA');
  const meetings = (rows ?? [])
    .filter(m => m.trackMode !== 'off' && new Date(m.time).toLocaleDateString('en-CA') === todayStr)
    .map(m => ({ ...m, past: new Date(m.time).getTime() + m.durationMinutes * 60_000 < Date.now() }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return { meetings };
}
