import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { updatePassword } from '@pomodoso/api';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase.ts';

// Landing page for Supabase password-recovery links (requested from the
// extension or the web login). The recovery token in the URL hash signs the
// user in automatically; from there they can set a new password.
export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setReady(true); return; }
    const supabase = getSupabase();
    // The client processes the recovery token from the URL hash asynchronously —
    // wait for the session before deciding whether the link is valid.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      setReady(true);
    });
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasSession(true);
      // Give the hash-processing a moment before declaring the link invalid
      setTimeout(() => setReady(true), 1500);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); return; }
    setLoading(true);
    try {
      await updatePassword(getSupabase(), password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password');
    } finally {
      setLoading(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <p className="text-sm text-neutral-400">Auth is not configured on this deployment.</p>
      </Shell>
    );
  }

  if (!ready) {
    return (
      <Shell>
        <p className="text-sm text-neutral-400">Checking your reset link…</p>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold mb-2">Password updated ✓</h1>
        <p className="text-sm text-neutral-400 mb-6">
          You can now sign in with your new password — here and in the extension.
        </p>
        <Link
          to="/dashboard"
          className="inline-block px-5 py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100"
        >
          Go to dashboard
        </Link>
      </Shell>
    );
  }

  if (!hasSession) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold mb-2">Link expired or invalid</h1>
        <p className="text-sm text-neutral-400 mb-2">
          Password reset links can only be used once and expire after a while.
        </p>
        <p className="text-sm text-neutral-400">
          Request a new one from the extension (Account → Forgot password?) or the{' '}
          <Link to="/login" className="text-neutral-200 underline">login page</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold mb-1">Set a new password</h1>
      <p className="text-sm text-neutral-400 mb-6">Choose a new password for your Pomodoso account.</p>
      <form onSubmit={e => void handleSubmit(e)} className="flex flex-col gap-3">
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoFocus
          className="px-3 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        <input
          type="password"
          placeholder="Repeat new password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="px-3 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm text-neutral-100 outline-none focus:border-neutral-500"
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password || !confirm}
          className="mt-1 px-5 py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-4">
      <div className="max-w-sm w-full">{children}</div>
    </div>
  );
}
