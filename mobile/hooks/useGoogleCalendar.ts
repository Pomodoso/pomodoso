import { useCallback, useEffect, useState } from 'react';

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

  async function toggleCalendar(id: string): Promise<void> {
    if (!connection) return;
    const ids = connection.selectedCalendarIds.includes(id)
      ? connection.selectedCalendarIds.filter(c => c !== id)
      : [...connection.selectedCalendarIds, id];
    await updateSelectedCalendars(workspaceId, ids);
    await refresh();
  }

  return { connection, calendars, lastSynced, loading, connecting, syncing, connect, disconnect, syncNow, toggleCalendar };
}
