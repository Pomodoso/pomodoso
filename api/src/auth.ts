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

/** Magic link (web): emails a clickable link that signs the user in and lands on
 *  `redirectTo`. New users are created on first use. */
export async function sendMagicLink(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

/** Email OTP (extension): emails a 6-digit code; complete with `verifyEmailOtp`.
 *  Used instead of a magic link in the extension, where a link redirect can't
 *  hand the session back to the popup. */
export async function sendEmailOtp(supabase: SupabaseClient, email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyEmailOtp(
  supabase: SupabaseClient,
  email: string,
  token: string,
): Promise<{ session: Session | null }> {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return { session: data.session };
}

export async function signUpWithEmail(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<void> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function resetPasswordForEmail(
  supabase: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(
  supabase: SupabaseClient,
  newPassword: string,
): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
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
