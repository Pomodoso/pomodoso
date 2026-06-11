import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, TokenApiClient, getMe, signInWithEmail, signOut as supabaseSignOut, resetPasswordForEmail } from '@pomodoso/api';
import type { Entitlements } from '@pomodoso/types';
import { FREE_ENTITLEMENTS } from '@pomodoso/types';
import { db } from '../db';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

const SESSION_KEY = 'auth_session';
const ENTITLEMENTS_KEY = 'entitlements';
const WEB_URL = (import.meta.env.VITE_WEB_URL as string | undefined) ?? 'https://pomodoso.com';

export interface AuthState {
  session: Session | null;
  entitlements: Entitlements;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
}

async function oauthFlow(
  provider: 'google' | 'azure',
  supabaseUrl: string,
  supabaseAnonKey: string,
  persistSession: (s: Session) => Promise<void>,
  setSession: (s: Session) => void,
) {
  const supabase = getSupabaseClient(supabaseUrl, supabaseAnonKey);
  const redirectTo = chrome.identity.getRedirectURL('callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data.url) throw error ?? new Error('OAuth URL unavailable');

  const callbackUrl = await new Promise<string>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'OAuth cancelled'));
      } else {
        resolve(url);
      }
    });
  });

  // Supabase may return tokens in the URL hash (implicit) or as a code (PKCE)
  const parsed = new URL(callbackUrl);
  const hash = new URLSearchParams(parsed.hash.slice(1));
  const query = parsed.searchParams;

  const accessToken = hash.get('access_token') ?? query.get('access_token');
  const refreshToken = hash.get('refresh_token') ?? query.get('refresh_token');
  const code = query.get('code');

  let newSession: Session | null = null;

  if (accessToken && refreshToken) {
    const { data: sd } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    newSession = sd.session;
  } else if (code) {
    const { data: sd } = await supabase.auth.exchangeCodeForSession(code);
    newSession = sd.session;
  }

  if (!newSession) throw new Error('No session returned from OAuth');
  setSession(newSession);
  await persistSession(newSession);
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);

  const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

  // Restore session from IndexedDB on mount
  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const stored = await db.settings.get(SESSION_KEY);
        const storedSession = stored?.value as Session | undefined;

        if (storedSession) {
          const supabase = getSupabaseClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
          const { data, error } = await supabase.auth.setSession({
            access_token: storedSession.access_token,
            refresh_token: storedSession.refresh_token,
          });

          if (!error && data.session) {
            setSession(data.session);
            await db.settings.put({ key: SESSION_KEY, value: data.session });
          } else {
            // Session expired or invalid — clear it
            await db.settings.delete(SESSION_KEY);
          }
        }

        // Restore cached entitlements while we wait for a fresh fetch
        const cachedEnt = await db.settings.get(ENTITLEMENTS_KEY);
        if (cachedEnt?.value) {
          setEntitlements(cachedEnt.value as Entitlements);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [isConfigured]);

  // Refresh entitlements whenever session changes (only when API is configured)
  useEffect(() => {
    if (!isConfigured || !session || !API_URL) return;

    void (async () => {
      try {
        const client = new TokenApiClient(API_URL, session.access_token);
        const { entitlements: fresh } = await getMe(client);
        setEntitlements(fresh);
        await db.settings.put({ key: ENTITLEMENTS_KEY, value: fresh });
      } catch {
        // Use cached entitlements on network error
      }
    })();
  }, [isConfigured, session?.access_token]);

  const persistSession = useCallback(async (s: Session) => {
    await db.settings.put({ key: SESSION_KEY, value: s });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    const supabase = getSupabaseClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    const { session: newSession } = await signInWithEmail(supabase, email, password);
    setSession(newSession);
    await db.settings.put({ key: SESSION_KEY, value: newSession });
  }, [isConfigured]);

  const signInWithGoogle = useCallback(async () => {
    if (!isConfigured) throw new Error('Auth not configured');
    await oauthFlow('google', SUPABASE_URL!, SUPABASE_ANON_KEY!, persistSession, setSession);
  }, [isConfigured, persistSession]);

  const signInWithMicrosoft = useCallback(async () => {
    if (!isConfigured) throw new Error('Auth not configured');
    await oauthFlow('azure', SUPABASE_URL!, SUPABASE_ANON_KEY!, persistSession, setSession);
  }, [isConfigured, persistSession]);

  const resetPassword = useCallback(async (email: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    const supabase = getSupabaseClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    // The email link lands on the web app, which has a proper page to set
    // a new password (popups can't receive Supabase redirects).
    await resetPasswordForEmail(supabase, email, `${WEB_URL}/reset-password`);
  }, [isConfigured]);

  const signOut = useCallback(async () => {
    if (!isConfigured) return;
    const supabase = getSupabaseClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
    await supabaseSignOut(supabase);
    setSession(null);
    setEntitlements(FREE_ENTITLEMENTS);
    await db.settings.delete(SESSION_KEY);
    await db.settings.delete(ENTITLEMENTS_KEY);
  }, [isConfigured]);

  return { session, entitlements, loading, signIn, signInWithGoogle, signInWithMicrosoft, resetPassword, signOut, isConfigured };
}
