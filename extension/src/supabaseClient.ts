import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, type SupabaseClient } from '@pomodoso/api';
import { db } from './db';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// The app + sync engine read the access token from here; Supabase keeps its own
// copy under STORAGE_KEY in chrome.storage.local. Both are kept in lock-step by
// the onAuthStateChange mirror below.
const SESSION_KEY = 'auth_session';
const STORAGE_KEY = 'sb-pomodoso-auth';

// chrome.storage.local-backed storage for Supabase. localStorage doesn't exist
// in an MV3 service worker, so the default adapter loses the session whenever the
// worker is torn down — which is why the extension "logged out after a while".
// chrome.storage.local is durable across worker restarts, so the auto-refreshed
// token persists and the session survives.
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const r = await chrome.storage.local.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

let _mirroring = false;

export function isAuthConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** The single Supabase client for the extension (popup + service worker). Always
 *  go through this so the chrome.storage adapter is wired before the underlying
 *  singleton is created. */
export function getExtensionSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Auth not configured');
  const client = getSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    storage: chromeStorageAdapter,
    storageKey: STORAGE_KEY,
    // No background auto-refresh: the popup and the service worker are separate
    // contexts, and two GoTrue timers refreshing the same account rotate the
    // refresh token against each other → Supabase reuse detection signs the user
    // out "every X time". Instead the service worker refreshes explicitly on its
    // periodic alarm via ensureFreshSession(), so only one context ever rotates.
    autoRefreshToken: false,
  });
  // Register once per context: every refresh/sign-in/sign-out is mirrored into
  // IndexedDB, where the sync engine and popup read the token.
  if (!_mirroring) {
    _mirroring = true;
    client.auth.onAuthStateChange((_event, session) => {
      void mirrorSession(session);
    });
  }
  return client;
}

/** Keep IndexedDB's auth_session in step with Supabase's session. */
export async function mirrorSession(session: Session | null): Promise<void> {
  if (session) await db.settings.put({ key: SESSION_KEY, value: session });
  else await db.settings.delete(SESSION_KEY);
}

/** Returns a non-expired session, refreshing proactively when it's within 5
 *  minutes of expiry. Works with the popup closed (called from the service
 *  worker on the periodic alarm), so the token never silently lapses.
 *
 *  Falls back to the IndexedDB session for users upgrading from the old
 *  localStorage-only client, seeding the chrome.storage adapter on the way. */
async function storedSession(): Promise<Session | null> {
  const s = (await db.settings.get(SESSION_KEY))?.value as Session | undefined;
  return s?.access_token && s?.refresh_token ? s : null;
}

export async function ensureFreshSession(): Promise<Session | null> {
  if (!isAuthConfigured()) return null;
  const supabase = getExtensionSupabase();

  // Adopt the freshest stored session first. Another context (or a previous
  // service-worker lifetime) may have already rotated the refresh token; using a
  // stale in-memory one would trip reuse detection and sign the user out.
  let session = (await supabase.auth.getSession()).data.session;
  const stored = await storedSession();
  if (stored && (!session || stored.refresh_token !== session.refresh_token)) {
    const { data } = await supabase.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    session = data.session ?? session;
  }
  if (!session) return null;

  const expiresMs = (session.expires_at ?? 0) * 1000;
  if (expiresMs && expiresMs < Date.now() + 5 * 60 * 1000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) {
      await mirrorSession(data.session);
      return data.session;
    }
    // Refresh failed — most likely a concurrent refresh already rotated the
    // token. If a newer valid session landed in storage, adopt it instead of
    // dropping the user to the login screen.
    const latest = await storedSession();
    if (latest && latest.refresh_token !== session.refresh_token) {
      const { data: d2 } = await supabase.auth.setSession({
        access_token: latest.access_token,
        refresh_token: latest.refresh_token,
      });
      if (d2.session) return d2.session;
    }
  }
  return session;
}
