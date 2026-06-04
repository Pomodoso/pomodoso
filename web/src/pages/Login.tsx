import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { signInWithProvider, signInWithEmail, signUpWithEmail } from '@pomodoso/api';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase.ts';
import { useAuth } from '../lib/AuthContext.tsx';

export default function Login() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  if (session) return <Navigate to={next} replace />;

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-4">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-lg font-semibold mb-2">Not configured</h1>
          <p className="text-sm text-neutral-400">
            Add <code className="text-neutral-300">VITE_SUPABASE_URL</code> and{' '}
            <code className="text-neutral-300">VITE_SUPABASE_ANON_KEY</code> to{' '}
            <code className="text-neutral-300">.env.local</code> to enable auth.
          </p>
        </div>
      </div>
    );
  }

  const handleOAuth = async (provider: 'google' | 'azure') => {
    setError('');
    await signInWithProvider(getSupabase(), provider, `${window.location.origin}/dashboard`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        await signUpWithEmail(getSupabase(), email, password);
        setSignupDone(true);
      } else {
        await signInWithEmail(getSupabase(), email, password);
        void navigate(next, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  if (signupDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-4">
        <div className="max-w-sm w-full text-center">
          <div className="text-2xl mb-3">✉</div>
          <h1 className="text-lg font-semibold mb-2">Check your email</h1>
          <p className="text-sm text-neutral-400">We sent a confirmation link to <strong>{email}</strong>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-4">
      <div className="max-w-sm w-full">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Pomodoso</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
          </p>
        </div>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-2 mb-6">
          <button
            onClick={() => void handleOAuth('google')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-neutral-700 text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </button>
          <button
            onClick={() => void handleOAuth('azure')}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-neutral-700 text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
              <rect x="0" y="0" width="10" height="10" fill="#F25022"/>
              <rect x="11" y="0" width="10" height="10" fill="#7FBA00"/>
              <rect x="0" y="11" width="10" height="10" fill="#00A4EF"/>
              <rect x="11" y="11" width="10" height="10" fill="#FFB900"/>
            </svg>
            <span>Continue with Microsoft</span>
          </button>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-neutral-800" />
          <span className="text-xs text-neutral-500">or</span>
          <div className="flex-1 h-px bg-neutral-800" />
        </div>

        {/* Email/password form */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className="w-full px-4 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-4 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 text-sm placeholder-neutral-500 focus:outline-none focus:border-neutral-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors disabled:opacity-60"
          >
            {loading ? 'Loading…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-xs text-neutral-500 mt-6">
          {mode === 'signin' ? (
            <>No account?{' '}
              <button onClick={() => setMode('signup')} className="text-neutral-300 hover:underline">Sign up</button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button onClick={() => setMode('signin')} className="text-neutral-300 hover:underline">Sign in</button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
