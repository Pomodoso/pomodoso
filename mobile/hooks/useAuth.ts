import { getMe, resetPasswordForEmail, sendMagicLink, signInWithEmail, signOut as supabaseSignOut, signUpWithEmail, TokenApiClient, updatePassword as supabaseUpdatePassword } from '@pomodoso/api';
import type { Entitlements } from '@pomodoso/types';
import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';

import { API_URL, getMobileSupabase, isAuthConfigured } from '@/lib/supabase';
import { syncNow } from '@/utils/sync';
import { recordSyncEntitlement } from '@/utils/syncChoice';

// Matches @pomodoso/types' FREE_ENTITLEMENTS exactly (kept as a literal here
// rather than importing the value — same Metro-can't-resolve-a-value-import-
// from-@pomodoso/types constraint documented in useSettings.ts; Entitlements
// above is fine as import type for the same reason).
const FREE_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  features: {
    sync: false,
    dashboard: false,
    multi_workspace: false,
    calendar: false,
    ai_summary: false,
    history_unlimited: false,
    api_integrations: false,
    max_devices: 1,
    max_workspaces: 1,
    history_days: 30,
  },
};

// Where Supabase redirects after a magic link / signup confirmation / password
// reset email is followed. app.json's "scheme": "pomodoso" already makes this
// deep link openable; no extra native config needed.
const REDIRECT_URL = Linking.createURL('auth-callback');

export interface AuthState {
  session: Session | null;
  entitlements: Entitlements;
  loading: boolean;
  isConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendMagicLinkEmail: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads entitlements from the backend. Called after a purchase: the app
   *  sends Apple's signed transaction to /iap/verify, which writes the
   *  subscription row, and only then does /me report Pro — so the app has to
   *  ask again rather than trusting what the purchase sheet returned. */
  refreshEntitlements: () => Promise<void>;
}

// Extracts access_token/refresh_token from a Supabase auth redirect URL and
// establishes the session. Supabase puts them in the URL fragment
// (#access_token=...&refresh_token=...), which Linking.parse doesn't split
// out on its own, so this parses the fragment manually — same shape as
// extension's oauthFlow (useAuth.ts) handles for its OAuth callback, just
// arriving via a universal/deep link here instead of chrome.identity.
async function applySessionFromUrl(url: string): Promise<void> {
  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) return;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return;
  // A password-reset link lands here too (same "pomodoso://auth-callback"
  // redirect as magic link/signup) — Supabase tells them apart via
  // type=recovery in the fragment. Navigate BEFORE setSession below, not
  // after: if the login screen happens to still be mounted, it closes
  // itself on ANY session appearing (its own useAuth instance's session
  // effect), and that would race a post-setSession router.push and pop the
  // reset screen right back off before the user sees it. replace (not
  // push) unmounts login synchronously here, so its effect never gets the
  // chance to fire (mirrors web's ResetPassword.tsx, reached the same way
  // there).
  if (params.get('type') === 'recovery') {
    router.replace('/reset-password');
  }
  const supabase = getMobileSupabase();
  const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) {
    console.warn('Failed to apply session from auth redirect', error);
    return;
  }
  // Magic link / signup confirmation: don't rely solely on login.tsx's own
  // `if (auth.session) router.back()` effect to leave the screen — that
  // depends on ITS OWN useAuth() instance's onAuthStateChange listener
  // firing and re-rendering before the user notices, which is a real gap
  // when the deep link reopens the app from the background (observed on
  // device: session was set correctly, but the login screen didn't leave
  // until manually navigated back). Navigate explicitly here instead, same
  // as the recovery branch above already does for its own screen.
  if (params.get('type') !== 'recovery') {
    router.replace('/');
  }
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);

  const fetchEntitlements = useCallback(async (accessToken: string) => {
    if (!API_URL) return;
    try {
      const client = new TokenApiClient(API_URL, accessToken);
      const me = await getMe(client);
      setEntitlements(me.entitlements);

      // syncNow() runs from triggers with no access to React state, so the
      // answer is cached where they can read it. Syncing right here when the
      // account turns out to be entitled matters: useSyncLifecycle fires on
      // the session appearing, which usually beats this request, and that
      // attempt is now skipped. Without this a Pro user would wait for the
      // 60s poll after every sign-in.
      recordSyncEntitlement(me.entitlements.features.sync);
      if (me.entitlements.features.sync) {
        void syncNow().catch(err => console.warn('[sync] post-entitlement sync failed', err));
      }
    } catch (err) {
      // Network/backend hiccup — stay on whatever entitlements were last
      // known (or FREE_ENTITLEMENTS on first load) rather than throwing;
      // the user is still signed in either way.
      console.warn('Failed to fetch entitlements', err);
    }
  }, []);

  useEffect(() => {
    if (!isAuthConfigured()) {
      setLoading(false);
      return;
    }
    const supabase = getMobileSupabase();
    let mounted = true;

    void supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      // Wait for entitlements too (fetchEntitlements never throws — it
      // warns and keeps the current value on failure) before flipping
      // loading off. Otherwise a signed-in Pro user briefly reads as
      // "Free" the moment Settings mounts: loading would go false right
      // after getSession resolves, while entitlements are still sitting
      // on the FREE_ENTITLEMENTS default until the separate /me call
      // finishes.
      if (data.session) await fetchEntitlements(data.session.access_token);
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        void fetchEntitlements(newSession.access_token);
      } else {
        setEntitlements(FREE_ENTITLEMENTS);
      }
    });

    // Handles both: the app already running when the redirect link is
    // tapped (event listener), and a cold start from tapping the link
    // (getInitialURL) — a magic link email is very often opened after the
    // app was fully closed.
    const linkingSub = Linking.addEventListener('url', ({ url }) => {
      void applySessionFromUrl(url);
    });
    void Linking.getInitialURL().then(url => {
      if (url) void applySessionFromUrl(url);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
      linkingSub.remove();
    };
  }, [fetchEntitlements]);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmail(getMobileSupabase(), email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    await signUpWithEmail(getMobileSupabase(), email, password, REDIRECT_URL);
  }, []);

  // Mirrors extension's oauthFlow (popup/useAuth.ts) — a popup/RN app can't
  // receive a normal browser redirect the way web's signInWithProvider does,
  // so skipBrowserRedirect gets back the Google authorize URL instead of
  // navigating, and an in-app browser session (not the OS browser — this one
  // reliably returns control to the app on redirect) drives it. The
  // resulting pomodoso://auth-callback#access_token=... is the exact same
  // shape magic link/signup already produce, so applySessionFromUrl handles
  // it unchanged — no new callback plumbing needed, just a new trigger.
  const signInWithGoogle = useCallback(async () => {
    const supabase = getMobileSupabase();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
    });
    if (error) throw error;
    if (!data.url) throw new Error('No Google auth URL returned');
    const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
    if (result.type === 'success' && result.url) {
      await applySessionFromUrl(result.url);
    }
  }, []);

  const sendMagicLinkEmail = useCallback(async (email: string) => {
    await sendMagicLink(getMobileSupabase(), email, REDIRECT_URL);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await resetPasswordForEmail(getMobileSupabase(), email, REDIRECT_URL);
  }, []);

  const updatePassword = useCallback(async (newPassword: string) => {
    await supabaseUpdatePassword(getMobileSupabase(), newPassword);
  }, []);

  // No purchase identity to detach: nothing caches who bought what on this
  // device. Each purchase carries the buyer's user id inside the transaction
  // Apple signs, so a second account signing in here simply owns none of them.
  const signOut = useCallback(async () => {
    await supabaseSignOut(getMobileSupabase());
    setSession(null);
    setEntitlements(FREE_ENTITLEMENTS);
    // Cleared here too, not just in React state: the cache outlives this
    // component, and leaving it set would let the next account on this device
    // sync on the strength of the previous one's plan.
    recordSyncEntitlement(false);
  }, []);


  const refreshEntitlements = useCallback(async () => {
    const token = session?.access_token;
    if (token) await fetchEntitlements(token);
  }, [session?.access_token, fetchEntitlements]);

  return {
    session,
    entitlements,
    loading,
    refreshEntitlements,
    isConfigured: isAuthConfigured(),
    signIn,
    signUp,
    signInWithGoogle,
    sendMagicLinkEmail,
    resetPassword,
    updatePassword,
    signOut,
  };
}
