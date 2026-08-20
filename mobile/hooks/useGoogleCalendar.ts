import { useCallback, useEffect, useRef, useState } from 'react';

import type { CalendarConnection, CalendarInfo } from '@/utils/googleCalendar';
import {
  connectCalendar,
  disconnectCalendar,
  getCalendarConnection,
  getCalendarLastSynced,
  getCalendarList,
  syncTodayMeetings,
  updateSelectedCalendars,
} from '@/utils/googleCalendar';

import { useWorkspace } from './useWorkspace';

// Connection state lives in expo-secure-store (utils/googleCalendar.ts),
// not SQLite — no useLiveQuery to piggyback on, so this hook owns its own
// state and refetches after every mutation. Matches extension's
// WorkspaceCalendarSection (SettingsState.tsx) in shape: one hook instance
// per workspace, since the connection itself is per-workspace.
export function useGoogleCalendar(): {
  connection: CalendarConnection | null;
  calendars: CalendarInfo[];
  lastSynced: string | null;
  loading: boolean;
  connecting: boolean;
  syncing: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  toggleCalendar: (id: string) => Promise<void>;
} {
  const { workspaceId } = useWorkspace();
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const [conn, calList, synced] = await Promise.all([
      getCalendarConnection(workspaceId),
      getCalendarList(workspaceId),
      getCalendarLastSynced(workspaceId),
    ]);
    setConnection(conn);
    setCalendars(calList);
    setLastSynced(synced);
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function connect(): Promise<void> {
    setConnecting(true);
    try {
      await connectCalendar(workspaceId);
      await refresh();
      // Immediate first sync, matching extension's background.ts calling
      // syncTodayMeetings right after a successful connect — otherwise
      // Home stays empty until the next foreground/interval sync tick.
      await syncTodayMeetings(workspaceId);
      await refresh();
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(): Promise<void> {
    await disconnectCalendar(workspaceId);
    await refresh();
  }

  async function syncNow(): Promise<void> {
    setSyncing(true);
    try {
      await syncTodayMeetings(workspaceId);
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  // A rapid burst of taps across several calendar rows needs: (1) each
  // toggle to compute its new array on top of the PREVIOUS toggle's
  // change, not a stale `connection` snapshot from before any of them
  // landed; (2) writes to land in the same order the taps happened; (3)
  // exactly one re-sync with real on-disk state once the whole burst
  // settles — not one per toggle, since independent per-toggle refreshes
  // can resolve out of order and let an earlier (slower) one's older
  // snapshot clobber a later toggle's already-persisted change; and (4) a
  // toggle whose write actually failed to leave the UI showing what's
  // really on disk, not the optimistic guess. All four fall out of one
  // design: track a synchronous ref for "next array to write" (React
  // state alone can't serve this — a second tap fired before re-render
  // wouldn't see the first tap's update), apply it to `connection`
  // immediately for responsive UI, chain the actual writes so they can
  // never reorder or get skipped by an earlier rejection, and defer
  // `refresh()` until the in-flight count drops to zero — which also
  // naturally corrects any optimistic state a failed write never actually
  // persisted, without needing separate rollback logic.
  const selectedIdsRef = useRef<string[] | null>(null);
  useEffect(() => {
    selectedIdsRef.current = connection?.selectedCalendarIds ?? null;
  }, [connection]);
  const toggleChainRef = useRef<Promise<void>>(Promise.resolve());
  const togglesInFlightRef = useRef(0);

  async function toggleCalendar(id: string): Promise<void> {
    if (!connection) return;
    const current = selectedIdsRef.current ?? connection.selectedCalendarIds;
    const next = current.includes(id) ? current.filter(c => c !== id) : [...current, id];
    selectedIdsRef.current = next;
    setConnection(prev => (prev ? { ...prev, selectedCalendarIds: next } : prev));

    togglesInFlightRef.current++;
    const writePromise = toggleChainRef.current.then(() => updateSelectedCalendars(workspaceId, next));
    // The chain itself must never carry a rejection forward — if it did,
    // every later `.then` (i.e. every subsequent toggle's write) would be
    // silently skipped once one write failed, permanently until the
    // screen remounts. This toggle's own caller still observes a real
    // failure via `await writePromise` below.
    toggleChainRef.current = writePromise.catch(() => {});
    try {
      await writePromise;
    } finally {
      togglesInFlightRef.current--;
      if (togglesInFlightRef.current === 0) await refresh();
    }
  }

  return { connection, calendars, lastSynced, loading, connecting, syncing, connect, disconnect, syncNow, toggleCalendar };
}
