import type { Session } from '@supabase/supabase-js';
import { db } from './db';
import { getExtensionSupabase } from './supabaseClient';

const SESSION_KEY = 'auth_session';

// Runs in the background service worker (background.ts's 'auth.googleSignIn'
// case), not the popup — moved out of popup/useAuth.ts because
// chrome.identity.launchWebAuthFlow's interactive window steals focus,
// which closes the extension popup (standard Chrome behavior: a popup
// closes on blur) before its own pending Promise would otherwise resolve.
// Observed on a real account: login silently never completed unless
// DevTools was attached to the popup, which is the one thing that keeps a
// popup open across a focus loss — that was the tell, not a coincidence.
// The service worker isn't tied to the popup's lifecycle, so the flow (and
// persisting the session to IndexedDB) completes regardless of whether the
// popup that triggered it is still open — same durability principle as
// calendar.connect's chrome.storage.local writes. The popup, current or
// reopened, picks the session up from IndexedDB on its next mount
// (useAuth.ts's restore-on-mount effect) even if it missed the sendMessage
// response.
export async function googleSignInFlow(): Promise<Session> {
  const supabase = getExtensionSupabase();
  const redirectTo = chrome.identity.getRedirectURL('callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
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
  await db.settings.put({ key: SESSION_KEY, value: newSession });
  return newSession;
}
