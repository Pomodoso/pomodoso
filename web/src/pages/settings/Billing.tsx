import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/AuthContext.tsx';

export default function Billing() {
  const { entitlements } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const plan = entitlements.plan;

  const handleCheckout = async (price: 'annual' | 'monthly' | 'lifetime') => {
    setError('');
    setLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/checkout', {
        price,
        success_url: `${window.location.origin}/dashboard?upgraded=1`,
        cancel_url: `${window.location.origin}/settings/billing`,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handlePortal = async () => {
    setLoading(true);
    try {
      const { url } = await api.post<{ url: string }>('/billing/portal', {
        return_url: `${window.location.origin}/settings/billing`,
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const planLabel = plan === 'founder_lifetime' ? 'Founder Lifetime' : plan === 'pro' ? 'Pro' : 'Free';

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center gap-4">
        <Link to="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">← Dashboard</Link>
        <span className="text-sm font-semibold">Billing</span>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-xl font-bold mb-2">Plan & Billing</h1>
        <p className="text-sm text-neutral-400 mb-8">
          Current plan: <span className="font-semibold text-neutral-200">{planLabel}</span>
        </p>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {plan === 'founder_lifetime' ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.03] p-6">
            <p className="text-sm text-neutral-300 mb-1">
              You have <span className="text-amber-400 font-semibold">Founder Lifetime</span> access — all features, forever.
            </p>
            <p className="text-xs text-neutral-500">No subscription to manage. Thank you for being an early supporter.</p>
          </div>
        ) : plan === 'pro' ? (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-6">
            <p className="text-sm text-neutral-300 mb-4">
              You have access to all Pro features. Manage your subscription below.
            </p>
            <button
              onClick={() => void handlePortal()}
              disabled={loading}
              className="px-5 py-2.5 rounded-lg bg-white text-neutral-900 text-sm font-semibold hover:bg-neutral-100 transition-colors disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Manage subscription'}
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-3 gap-4">
            <PriceCard
              title="Pro — Annual"
              price="$49"
              period="/ year"
              sub="~$4/mo · save 43%"
              badge="Best value"
              features={[
                'Everything in Free',
                'Multi-device sync',
                'Web dashboard',
                'Unlimited workspaces',
                'Full history',
                'No upgrade prompts',
              ]}
              onSelect={() => void handleCheckout('annual')}
              disabled={loading}
            />
            <PriceCard
              title="Pro — Monthly"
              price="$7"
              period="/ month"
              features={[
                'Everything in Free',
                'Multi-device sync',
                'Web dashboard',
                'Unlimited workspaces',
                'Full history',
                'No upgrade prompts',
              ]}
              onSelect={() => void handleCheckout('monthly')}
              disabled={loading}
            />
            <PriceCard
              title="Founder Lifetime"
              price="$99"
              period="once"
              sub="First 200 users only"
              features={[
                'Everything in Pro',
                'Lifetime access',
                'All future features',
                'Priority support',
                'Early AI access',
                'No recurring fees',
              ]}
              onSelect={() => void handleCheckout('lifetime')}
              disabled={loading}
              variant="lifetime"
            />
          </div>
        )}

        <p className="text-xs text-neutral-500 mt-8">
          All plans include a <span className="text-neutral-400">no-questions-asked refund</span> within 7 days.
        </p>
      </main>
    </div>
  );
}

function PriceCard({ title, price, period, sub, badge, features, onSelect, disabled, variant }: {
  title: string;
  price: string;
  period: string;
  sub?: string;
  badge?: string;
  features: string[];
  onSelect: () => void;
  disabled: boolean;
  variant?: 'lifetime';
}) {
  const isLifetime = variant === 'lifetime';

  return (
    <div className={`rounded-xl border p-6 flex flex-col ${isLifetime ? 'border-amber-400/20 bg-amber-400/[0.03]' : 'border-neutral-700 bg-neutral-900'}`}>
      <div className="flex items-start justify-between mb-3">
        <span className={`text-xs font-medium ${isLifetime ? 'text-amber-400/70' : 'text-neutral-400'}`}>{title}</span>
        {badge && (
          <span className="text-xs bg-green-900/50 text-green-400 border border-green-800/50 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </div>
      <div className="mb-1">
        <span className="text-2xl font-bold">{price}</span>
        <span className="text-sm font-normal text-neutral-400 ml-1">{period}</span>
      </div>
      {sub && <div className="text-xs text-neutral-500 mb-4">{sub}</div>}
      <ul className="space-y-1.5 mb-5 flex-1 mt-3">
        {features.map(f => (
          <li key={f} className="text-sm text-neutral-300 flex items-center gap-2">
            <span className={isLifetime ? 'text-amber-400' : 'text-green-400'}>✓</span> {f}
          </li>
        ))}
      </ul>
      <button
        onClick={onSelect}
        disabled={disabled}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
          isLifetime
            ? 'bg-amber-400 text-neutral-900 hover:bg-amber-300'
            : 'bg-white text-neutral-900 hover:bg-neutral-100'
        }`}
      >
        {disabled ? 'Loading…' : 'Get started'}
      </button>
    </div>
  );
}
