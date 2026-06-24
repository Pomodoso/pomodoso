import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Entitlements, User } from '@pomodoso/types';
import { FREE_ENTITLEMENTS } from '@pomodoso/types';
import { getMe, onAuthStateChange } from '@pomodoso/api';
import { getSupabase, isSupabaseConfigured } from './supabase.ts';
import { api, setAuthToken } from './api.ts';
import { identifyUser, clearUser } from './analytics.ts';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  entitlements: Entitlements;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  entitlements: FREE_ENTITLEMENTS,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements>(FREE_ENTITLEMENTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    const sb = getSupabase();

    // Get initial session
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthToken(data.session?.access_token ?? null);
      setLoading(false);
    });

    // Listen for auth changes — keeps the api token in sync
    const unsubscribe = onAuthStateChange(sb, (newSession) => {
      setSession(newSession);
      setAuthToken(newSession?.access_token ?? null);
    });

    return unsubscribe;
  }, []);

  // Fetch user + entitlements when session changes (single /me call for the whole app)
  useEffect(() => {
    if (!session) {
      setUser(null);
      setEntitlements(FREE_ENTITLEMENTS);
      clearUser();
      return;
    }

    getMe(api)
      .then(({ user: freshUser, entitlements: fresh }) => {
        setUser(freshUser);
        setEntitlements(fresh);
        // Identify by opaque UUID only (never email/name) + plan as a segment.
        identifyUser(freshUser.id, { plan: fresh.plan });
      })
      .catch(() => setEntitlements(FREE_ENTITLEMENTS));
  }, [session?.access_token]);

  return (
    <AuthContext.Provider value={{ session, user, entitlements, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
