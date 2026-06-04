import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from '@pomodoso/api';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import type { MeResponse } from '@pomodoso/api';
import { api } from '../../lib/api.ts';

export default function Dashboard() {
  const { session, entitlements } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    api.get<MeResponse>('/me')
      .then(setMe)
      .catch(console.error);
  }, [session?.access_token]);

  const handleSignOut = async () => {
    await signOut(supabase);
    window.location.href = '/login';
  };

  const isPro = entitlements.features.dashboard;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-tight">Pomodoso</span>
          <span className="text-xs text-neutral-500 bg-neutral-800 px-2 py-0.5 rounded-full">
            {isPro ? 'Pro' : 'Free'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-neutral-400">{me?.user.email ?? session?.user.email}</span>
          <Link to="/settings" className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
            Settings
          </Link>
          <button
            onClick={() => void handleSignOut()}
            className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {!isPro && (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900/50 px-5 py-4 mb-8 flex items-center justify-between gap-4">
            <p className="text-sm text-neutral-400">
              Unlock multi-device sync, full history, and unlimited workspaces with{' '}
              <span className="text-neutral-200 font-medium">Pomodoso Pro</span>.
            </p>
            <Link
              to="/settings/billing"
              className="shrink-0 px-4 py-2 bg-white text-neutral-900 text-xs font-semibold rounded-lg hover:bg-neutral-100 transition-colors"
            >
              Upgrade
            </Link>
          </div>
        )}

        <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Focus time today" value="—" />
          <StatCard label="Pomodoros today" value="—" />
          <StatCard label="Tasks completed" value="—" />
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-sm font-semibold text-neutral-300 mb-4">This week</h2>
          <p className="text-sm text-neutral-500">
            Start using the extension to see your focus data here.
          </p>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
