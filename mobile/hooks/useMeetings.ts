import { and, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { db } from '@/db/client';
import { meeting } from '@/db/schema';
import type { MeetingRow } from '@/db/schema';
import { parseMeetingTime } from '@/utils/meetingTime';

import { useWorkspace } from './useWorkspace';

export { isAllDayMeetingTime, parseMeetingTime } from '@/utils/meetingTime';

export interface TodayMeeting extends MeetingRow {
  past: boolean;
}

// Read-only for now (Fase B6b-1 adds the actual connect flow, still not
// wired into the UI here) — meetings arrive via sync (from the extension or
// another mobile device that's connected Google Calendar) or, once B6b-2
// ships, mobile's own connect flow too. `past` is computed here rather than
// stored (unlike the extension's local row, which persists it) — it's a
// pure function of `time`/`durationMinutes`, no reason to let it go stale
// between renders.
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
