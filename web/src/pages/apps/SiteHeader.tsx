import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/AuthContext.tsx';
import { CHROME_STORE_URL } from '../../lib/extension.ts';

// The public app pages' top bar (/apps, /apps/:slug, /apps/build).

export function SiteHeader({ current }: { current: 'apps' | 'build' }) {
  const { session, loading } = useAuth();
  const navLink = (to: string, label: string, active: boolean) => (
    <Link to={to} aria-current={active ? 'page' : undefined} style={{ color: active ? 'var(--color-text)' : 'var(--color-text-muted)', fontWeight: active ? 600 : 400, textDecoration: 'none' }}>
      {label}
    </Link>
  );
  return (
    <header style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <Link to="/" style={{ fontWeight: 700, fontSize: 17, color: 'var(--color-text)', textDecoration: 'none' }}>Pomodoso</Link>
        <nav className="pomo-site-nav-links" aria-label="Site">
          {navLink('/#features', 'Features', false)}
          {navLink('/apps', 'Apps', current === 'apps')}
          {navLink('/apps/build', 'Build an app', current === 'build')}
          {navLink('/pricing', 'Pricing', false)}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          {loading ? null : session ? (
            <Link to="/dashboard/apps" style={{ fontSize: 14, color: 'var(--color-text-muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Your apps</Link>
          ) : (
            <Link to="/login" style={{ fontSize: 14, color: 'var(--color-text-muted)', textDecoration: 'none', whiteSpace: 'nowrap' }}>Sign in</Link>
          )}
          <a href={CHROME_STORE_URL} className="pomo-site-btn" style={{ height: 36, padding: '0 14px', background: 'var(--color-text)', color: '#FFFFFF' }}>Add to Chrome</a>
        </div>
      </div>
    </header>
  );
}
