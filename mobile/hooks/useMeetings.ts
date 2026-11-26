import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';

import { db } from '@/db/client';
import { meeting } from '@/db/schema';
import type { MeetingRow, MeetingTrackMode } from '@/db/schema';
import { parseMeetingTime } from '@/utils/meetingTime';
import { triggerSync } from '@/utils/sync';

import { useWorkspace } from './useWorkspace';

export { isAllDayMeetingTime, parseMeetingTime } from '@/utils/meetingTime';

export interface TodayMeeting extends MeetingRow {
  past: boolean;
  /** Minutes until it starts; null once it has. */
  minutesUntil: number | null;
}

function withTiming(m: MeetingRow, now: number): TodayMeeting {
  const start = parseMeetingTime(m.time).getTime();
  return {
    ...m,
    past: start + m.durationMinutes * 60_000 < now,
    minutesUntil: start > now ? Math.ceil((start - now) / 60_000) : null,
  };
}

/** Today's meetings in the active workspace scope, earliest first.
 *
 *  `tracked` (the default) keeps only the ones the user chose to track,
 *  which is what Home shows; the Schedule tab passes false to list them all,
 *  untracked ones included, so they can be tracked from there. `past` and
 *  `minutesUntil` are computed, not stored: they're functions of time. */
export function useMeetings({ tracked = true }: { tracked?: boolean } = {}): { meetings: TodayMeeting[] } {
  const { scopeId } = useWorkspace();
  // Re-rendered every 30s so countdowns, the starting-soon banner and
  // Start → Log move on with the clock even with no timer running.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const { data: rows } = useLiveQuery(
    db.select().from(meeting).where(scopeId === null ? isNull(meeting.deletedAt) : and(isNull(meeting.deletedAt), eq(meeting.workspaceId, scopeId))),
    [scopeId],
  );

  const now = Date.now();
  const todayStr = new Date().toLocaleDateString('en-CA');
  const meetings = (rows ?? [])
    .filter(m => (!tracked || m.trackMode !== 'off') && parseMeetingTime(m.time).toLocaleDateString('en-CA') === todayStr)
    .map(m => withTiming(m, now))
    .sort((a, b) => parseMeetingTime(a.time).getTime() - parseMeetingTime(b.time).getTime());

  return { meetings };
}

export function useMeeting(id: string | undefined): TodayMeeting | undefined {
  const { data } = useLiveQuery(db.select().from(meeting).where(eq(meeting.id, id ?? '')), [id]);
  const row = data?.[0];
  return row && !row.deletedAt ? withTiming(row, Date.now()) : undefined;
}

/** The last five logged occurrences of the same recurring series, newest first. */
export function useMeetingHistory(m: MeetingRow | undefined): MeetingRow[] {
  const { data } = useLiveQuery(
    db
      .select()
      .from(meeting)
      .where(
        and(
          eq(meeting.recurringEventId, m?.recurringEventId ?? ''),
          // The same calendar connected in two workspaces imports a copy of
          // the series into each; only this workspace's copy is its history.
          eq(meeting.workspaceId, m?.workspaceId ?? ''),
          ne(meeting.id, m?.id ?? ''),
          eq(meeting.logged, true),
          isNull(meeting.deletedAt),
        ),
      )
      .orderBy(desc(meeting.time))
      .limit(5),
    [m?.recurringEventId, m?.id, m?.workspaceId],
  );
  return m?.recurringEventId ? (data ?? []) : [];
}

export type MeetingUpdate = Partial<Pick<MeetingRow, 'title' | 'description' | 'notes' | 'projectId' | 'trackMode' | 'logged' | 'loggedMinutes'>>;

/** Edits a meeting and queues it for sync, like any other record. */
export function updateMeeting(id: string, patch: MeetingUpdate): void {
  db.update(meeting).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(meeting.id, id)).run();
  triggerSync();
}

/**
 * Starts a stopwatch on a meeting, in the meeting's own workspace, and only
 * when that worked logs its scheduled length (the extension's behaviour; the
 * detail screen corrects it). False when another session is running.
 */
export async function startMeeting(
  m: MeetingRow,
  startSession: (mode: 'stopwatch', taskId: string, opts: { workspaceId: string }) => Promise<boolean>,
): Promise<boolean> {
  const started = await startSession('stopwatch', m.id, { workspaceId: m.workspaceId });
  if (started) updateMeeting(m.id, { logged: true, loggedMinutes: m.durationMinutes });
  return started;
}

/** Off → Today only → Always, the extension's badge cycle. */
export function nextTrackMode(mode: MeetingTrackMode): MeetingTrackMode {
  return mode === 'off' ? 'once' : mode === 'once' ? 'always' : 'off';
}

export function durationLabel(minutes: number): string {
  return minutes >= 60 ? `${+(minutes / 60).toFixed(2)}h` : `${minutes}m`;
}
