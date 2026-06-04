import type { Session, User } from '@supabase/supabase-js';
import type { SupabaseClient } from './supabase.ts';

export type AuthProvider = 'google' | 'github' | 'azure';

export async function signInWithProvider(
  supabase: SupabaseClient,
  provider: AuthProvider,
  redirectTo?: string,
): Promise<void> {
  const credentials = redirectTo
    ? { provider, options: { redirectTo } as const }
    : { provider };
  const { error } = await supabase.auth.signInWithOAuth(credentials);
  if (error) throw error;
}

export async function signInWithEmail(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<{ user: User; session: Session }> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUpWithEmail(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(supabase: SupabaseClient): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser(supabase: SupabaseClient): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function onAuthStateChange(
  supabase: SupabaseClient,
  callback: (session: Session | null) => void,
) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
