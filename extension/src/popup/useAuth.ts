import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { TokenApiClient, getMe, signInWithEmail, signOut as supabaseSignOut, resetPasswordForEmail, sendEmailOtp, verifyEmailOtp } from '@pomodoso/api';
import type { Entitlements, ExtensionResponse } from '@pomodoso/types';
import { FREE_ENTITLEMENTS } from '@pomodoso/types';
import { db } from '../db';
import { getExtensionSupabase } from '../supabaseClient';

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
  requestEmailCode: (email: string) => Promise<void>;
  verifyEmailCode: (email: string, code: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
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
          const supabase = getExtensionSupabase();
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

  // Follow token refreshes (and sign-outs) that happen in the background so the
  // popup never shows a stale/expired session. The client also mirrors these to
  // IndexedDB; here we just keep React state in step.
  useEffect(() => {
    if (!isConfigured) return;
    const supabase = getExtensionSupabase();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) setEntitlements(FREE_ENTITLEMENTS);
    });
    return () => sub.subscription.unsubscribe();
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

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    const supabase = getExtensionSupabase();
    const { session: newSession } = await signInWithEmail(supabase, email, password);
    setSession(newSession);
    await db.settings.put({ key: SESSION_KEY, value: newSession });
  }, [isConfigured]);

  // Runs in the background service worker (background.ts's authFlow.ts),
  // not here — chrome.identity.launchWebAuthFlow's interactive window steals
  // focus, which closes this popup (standard Chrome behavior) before a
  // popup-local async chain would otherwise resolve; login would then
  // silently never complete. The background flow persists the session to
  // IndexedDB regardless of whether this popup is still around to receive
  // the response — setSession here is just a nice-to-have for the case
  // where the popup survives; if not, useAuth's restore-on-mount effect
  // picks the already-persisted session up next time the popup opens.
  const signInWithGoogle = useCallback(async () => {
    if (!isConfigured) throw new Error('Auth not configured');
    const response = (await chrome.runtime.sendMessage({ type: 'auth.googleSignIn' })) as ExtensionResponse<Session>;
    if (!response.ok) throw new Error(response.error);
    setSession(response.data);
  }, [isConfigured]);

  // Passwordless: email a one-time code, then verify it. (A magic *link* can't
  // return the session to the popup, so the extension uses the OTP code.)
  const requestEmailCode = useCallback(async (email: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    await sendEmailOtp(getExtensionSupabase(), email);
  }, [isConfigured]);

  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    const { session: newSession } = await verifyEmailOtp(getExtensionSupabase(), email, code.trim());
    if (!newSession) throw new Error('Invalid or expired code');
    setSession(newSession);
    await db.settings.put({ key: SESSION_KEY, value: newSession });
  }, [isConfigured]);

  const resetPassword = useCallback(async (email: string) => {
    if (!isConfigured) throw new Error('Auth not configured');
    const supabase = getExtensionSupabase();
    // The email link lands on the web app, which has a proper page to set
    // a new password (popups can't receive Supabase redirects).
    await resetPasswordForEmail(supabase, email, `${WEB_URL}/reset-password`);
  }, [isConfigured]);

  const signOut = useCallback(async () => {
    if (!isConfigured) return;
    const supabase = getExtensionSupabase();
    await supabaseSignOut(supabase);
    setSession(null);
    setEntitlements(FREE_ENTITLEMENTS);
    await db.settings.delete(SESSION_KEY);
    await db.settings.delete(ENTITLEMENTS_KEY);
  }, [isConfigured]);

  return { session, entitlements, loading, signIn, signInWithGoogle, requestEmailCode, verifyEmailCode, resetPassword, signOut, isConfigured };
}
