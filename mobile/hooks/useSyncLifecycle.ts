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
// De-duping overlapping calls (e.g. a cold-start sync racing a near-
// immediate foreground transition) is handled inside
// syncTodayMeetings/syncAllConnectedWorkspaces itself (googleCalendar.ts),
// not here — a guard local to this file wouldn't cover connect()'s or the
// manual Sync now button's own direct calls to the same underlying
// non-atomic import (Greptile P1, follow-up round after an earlier version
// of this fix only guarded this file's two call sites).
function syncCalendarSilently(reason: string): void {
  syncAllConnectedWorkspaces().catch(err => console.warn(`[calendar] ${reason} failed`, err));
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
