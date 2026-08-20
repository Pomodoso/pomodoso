import { useEffect } from 'react';
import { AppState } from 'react-native';

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

// Mounted once at the app root (_layout.tsx). syncNow() itself no-ops
// quietly if not signed in or not entitled — every call site here can fire
// unconditionally without checking auth state first.
export function useSyncLifecycle(): void {
  useEffect(() => {
    // Cold start / app reload — matches extension's own "session exists ->
    // sync immediately" behavior on load (App.tsx), rather than waiting for
    // the first foreground transition or poll tick.
    syncSilently('initial sync');

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') syncSilently('foreground sync');
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
