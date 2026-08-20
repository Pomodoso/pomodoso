import { useEffect } from 'react';
import { AppState } from 'react-native';

import { registerBackgroundSync } from '@/utils/backgroundSync';
import { syncAllConnectedWorkspaces } from '@/utils/googleCalendar';
import { syncNow } from '@/utils/sync';

// Matches extension's chrome.alarms('periodic-sync') cadence (background.ts)
// — same 1-minute interval, foreground-only here since mobile has no
// reliable way to run a JS timer while backgrounded (unlike a Chrome MV3
// service worker, which survives the popup closing). True background
// attempts are Fase B5b (expo-background-fetch): best-effort, OS-scheduled,
// not this.
const FOREGROUND_POLL_MS = 60_000;

function syncSilently(reason: string): void {
  syncNow().catch(err => console.warn(`[sync] ${reason} failed`, err));
}

// Matches extension's own "popup open -> syncAllConnectedWorkspaces" trigger
// (App.tsx) — cold-start/foreground only, not the periodic poll below. The
// extension doesn't re-fetch Google Calendar events on its 1-minute alarm
// either, only the generic entity sync; a connected calendar refreshes on
// app-open/foreground, the manual Sync now button, or right after connect.
//
// Module-level in-flight guard — a cold-start sync overlapping a near-
// immediate foreground transition (or two rapid foreground transitions)
// would otherwise run two uncoordinated read-check-insert passes over the
// same Google events; googleEventId has no uniqueness constraint, so both
// passes could see the same event as "not yet imported" and insert two
// rows for it (Greptile P1). syncTodayMeetings has no reentrancy guard of
// its own, so it's enforced here instead.
let calendarSyncInFlight = false;
function syncCalendarSilently(reason: string): void {
  if (calendarSyncInFlight) return;
  calendarSyncInFlight = true;
  syncAllConnectedWorkspaces()
    .catch(err => console.warn(`[calendar] ${reason} failed`, err))
    .finally(() => {
      calendarSyncInFlight = false;
    });
}

// Mounted once at the app root (_layout.tsx). syncNow() itself no-ops
// quietly if not signed in or not entitled — every call site here can fire
// unconditionally without checking auth state first.
export function useSyncLifecycle(): void {
  useEffect(() => {
    // Cold start / app reload — matches extension's own "session exists ->
    // sync immediately" behavior on load (App.tsx), rather than waiting for
    // the first foreground transition or poll tick.
    syncSilently('initial sync');
    syncCalendarSilently('initial sync');

    // Fase B5b: best-effort OS-scheduled catch-up sync for when the app is
    // backgrounded/killed — see backgroundSync.ts for why this is only a
    // supplement to, not a replacement for, the foreground triggers below.
    registerBackgroundSync().catch(err => console.warn('[sync] background registration failed', err));

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        syncSilently('foreground sync');
        syncCalendarSilently('foreground sync');
      }
    });

    const interval = setInterval(() => {
      if (AppState.currentState === 'active') syncSilently('periodic sync');
    }, FOREGROUND_POLL_MS);

    return () => {
      subscription.remove();
      clearInterval(interval);
    };
  }, []);
}
