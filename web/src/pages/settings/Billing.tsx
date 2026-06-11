import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from '@pomodoso/api';
import { supabase } from '../../lib/supabase.ts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import { Sidebar } from '../../components/Sidebar.tsx';

// ─── Devices ───────────────────────────────────────────────────────────────────

interface DeviceInfo {
  id: string;
  kind: 'extension' | 'web' | 'mobile';
  name: string;
  browser: string;
  version: string;
  last_seen_at: string;
  last_sync_at: string | null;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function deviceIconClass(d: DeviceInfo): string {
  if (d.kind === 'web') return 'ti-world';
  if (d.kind === 'mobile') return 'ti-device-mobile';
  return 'ti-puzzle';
}

function DevicesCard() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);

  useEffect(() => {
    api.get<DeviceInfo[]>('/devices').then(setDevices).catch(() => setDevices([]));
  }, []);

  return (
    <div className="pomo-card" style={{ marginTop: 18 }}>
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-devices" /> Devices</div>
        {devices && devices.length > 0 && (
          <div className="pomo-card-meta">{devices.length} registered</div>
        )}
      </div>

      {devices === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-tert)', padding: '8px 0' }}>Loading…</div>
      ) : devices.length === 0 ? (
        <div className="pomo-empty">
          <i className="ti ti-devices-off" />
          No devices yet.<br />
          Open the extension, sign in, and it will register itself on the first sync.
        </div>
      ) : (
        devices.map(d => (
          <div
            key={d.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0', borderTop: '1px solid var(--border)',
            }}
          >
            <i className={`ti ${deviceIconClass(d)}`} style={{ fontSize: 18, color: 'var(--text-sec)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
                {d.name || d.browser || (d.kind === 'extension' ? 'Extension' : d.kind)}
                <span style={{ color: 'var(--text-tert)', fontWeight: 400 }}>
                  {' '}· {d.kind}{d.version ? ` · v${d.version}` : ''}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 2 }}>
                Last seen {timeAgo(d.last_seen_at)}
                {d.last_sync_at && <> · last sync {timeAgo(d.last_sync_at)}</>}
              </div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-tert)' }}>
              {d.id.slice(0, 8)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Plans ─────────────────────────────────────────────────────────────────────

const PRO_FEATURES = [
  'Everything in Free',
  'Multi-device sync',
  'Web dashboard',
  'Unlimited workspaces',
  'Full history',
  'No upgrade prompts',
];

const LIFETIME_FEATURES = [
  'Everything in Pro',
  'Lifetime access',
  'All future features',
  'Priority support',
  'Early AI access',
  'No recurring fees',
];

function PriceCard({ title, price, period, sub, badge, features, onSelect, disabled, highlight }: {
  title: string;
  price: string;
  period: string;
  sub?: string;
  badge?: string;
  features: string[];
  onSelect: () => void;
  disabled: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className="pomo-card"
      style={{
        display: 'flex', flexDirection: 'column',
        ...(highlight ? { borderColor: 'var(--warning)', background: 'var(--warning-soft)' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: highlight ? 'var(--warning)' : 'var(--text-sec)' }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--success)',
            background: 'var(--success-soft)', border: '1px solid rgba(74,124,74,0.25)',
            padding: '2px 8px', borderRadius: 99,
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{ marginBottom: 2 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>{price}</span>
        <span style={{ fontSize: 13, color: 'var(--text-tert)', marginLeft: 5 }}>{period}</span>
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-tert)' }}>{sub}</div>}
      <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 18px', flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {features.map(f => (
          <li key={f} style={{ fontSize: 13, color: 'var(--text-sec)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ti ti-check" style={{ color: highlight ? 'var(--warning)' : 'var(--success)', fontSize: 14 }} /> {f}
          </li>
        ))}
      </ul>
      <button
        className={highlight ? 'pomo-btn' : 'pomo-btn pomo-btn-primary'}
        onClick={onSelect}
        disabled={disabled}
        style={{
          width: '100%', justifyContent: 'center', padding: '9px 0', fontSize: 13, fontWeight: 600,
          ...(highlight ? { background: 'var(--warning)', color: '#fff', borderColor: 'var(--warning)' } : {}),
          ...(disabled ? { opacity: 0.6, cursor: 'default' } : {}),
        }}
      >
        {disabled ? 'Loading…' : 'Get started'}
      </button>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Billing() {
  const { session, entitlements } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const plan = entitlements.plan;

  const handleSignOut = async () => {
    await signOut(supabase);
    navigate('/login');
  };

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
  const userEmail = session?.user.email ?? '';
  const isPro = entitlements.features.dashboard;

  return (
    <div className="pomo-app">
      <Sidebar
        active="billing"
        userName={userEmail}
        userEmail={userEmail}
        isPro={isPro}
        onSignOut={() => void handleSignOut()}
      />

      <main className="pomo-main">
        {/* Page header */}
        <div className="pomo-page-header">
          <div>
            <div className="pomo-eyebrow">Settings</div>
            <h1 className="pomo-page-title">Plan &amp; devices</h1>
          </div>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: '0 0 18px' }}>
          Current plan: <b style={{ color: 'var(--text)' }}>{planLabel}</b>
        </p>

        {error && (
          <p style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 14 }}>{error}</p>
        )}

        {plan === 'founder_lifetime' ? (
          <div className="pomo-card" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 4px' }}>
              You have <b style={{ color: 'var(--warning)' }}>Founder Lifetime</b> access — all features, forever.
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-tert)', margin: 0 }}>
              No subscription to manage. Thank you for being an early supporter.
            </p>
          </div>
        ) : plan === 'pro' ? (
          <div className="pomo-card">
            <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: '0 0 14px' }}>
              You have access to all Pro features. Manage your subscription below.
            </p>
            <button
              className="pomo-btn pomo-btn-primary"
              onClick={() => void handlePortal()}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Manage subscription'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <PriceCard
              title="Pro — Annual"
              price="$49"
              period="/ year"
              sub="~$4/mo · save 43%"
              badge="Best value"
              features={PRO_FEATURES}
              onSelect={() => void handleCheckout('annual')}
              disabled={loading}
            />
            <PriceCard
              title="Pro — Monthly"
              price="$7"
              period="/ month"
              features={PRO_FEATURES}
              onSelect={() => void handleCheckout('monthly')}
              disabled={loading}
            />
            <PriceCard
              title="Founder Lifetime"
              price="$99"
              period="once"
              sub="First 200 users only"
              features={LIFETIME_FEATURES}
              onSelect={() => void handleCheckout('lifetime')}
              disabled={loading}
              highlight
            />
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-tert)', marginTop: 14 }}>
          All plans include a no-questions-asked refund within 7 days.
        </p>

        <DevicesCard />
      </main>
    </div>
  );
}
