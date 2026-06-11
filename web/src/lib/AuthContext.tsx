import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Entitlements } from '@pomodoso/types';
import { FREE_ENTITLEMENTS } from '@pomodoso/types';
import { getMe, onAuthStateChange } from '@pomodoso/api';
import { getSupabase, isSupabaseConfigured } from './supabase.ts';
import { api, setAuthToken } from './api.ts';

interface AuthContextValue {
  session: Session | null;
  entitlements: Entitlements;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  entitlements: FREE_ENTITLEMENTS,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
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

  // Fetch entitlements when session changes
  useEffect(() => {
    if (!session) {
      setEntitlements(FREE_ENTITLEMENTS);
      return;
    }

    getMe(api)
      .then(({ entitlements: fresh }) => setEntitlements(fresh))
      .catch(() => setEntitlements(FREE_ENTITLEMENTS));
  }, [session?.access_token]);

  return (
    <AuthContext.Provider value={{ session, entitlements, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
