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

  // Tracks the most recently computed selectedCalendarIds, including ones
  // from toggles still mid-flight — a second row tapped before the first
  // toggle's write+refresh resolves would otherwise both compute their new
  // array from the same stale `connection` snapshot, so the later write
  // (a full-array replace) silently discards the earlier tap (Greptile
  // P1). Only reset from a fresh `connection` while no toggle is
  // in-flight — otherwise a mid-chain refresh() (from an earlier toggle in
  // the same rapid-tap burst) would reset this to a snapshot that doesn't
  // yet include a later, still-queued toggle's change, corrupting the very
  // chain it's meant to protect.
  const pendingIdsRef = useRef<string[] | null>(null);
  const togglesInFlightRef = useRef(0);
  useEffect(() => {
    if (togglesInFlightRef.current === 0) {
      pendingIdsRef.current = connection?.selectedCalendarIds ?? null;
    }
  }, [connection]);
  const toggleChainRef = useRef<Promise<void>>(Promise.resolve());

  async function toggleCalendar(id: string): Promise<void> {
    if (!connection) return;
    const current = pendingIdsRef.current ?? connection.selectedCalendarIds;
    const next = current.includes(id) ? current.filter(c => c !== id) : [...current, id];
    pendingIdsRef.current = next;
    togglesInFlightRef.current++;
    const writePromise = toggleChainRef.current.then(() => updateSelectedCalendars(workspaceId, next));
    // The chain itself must never carry a rejection forward — if it did,
    // every later `.then` (i.e. every subsequent toggle's write) would be
    // silently skipped once one write failed, permanently until the
    // screen remounts (Greptile P1, follow-up round). This toggle's own
    // caller still observes a real failure via `await writePromise` below.
    toggleChainRef.current = writePromise.catch(() => {});
    try {
      await writePromise;
      await refresh();
    } finally {
      togglesInFlightRef.current--;
    }
  }

  return { connection, calendars, lastSynced, loading, connecting, syncing, connect, disconnect, syncNow, toggleCalendar };
}
