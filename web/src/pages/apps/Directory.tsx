import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { searchDirectory, type DirectoryListing } from '@pomodoso/api';
import { api } from '../../lib/api.ts';
import { Seo } from '../../seo.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// /apps: the public directory. Anyone can browse; installing goes through the
// extension, signed in. Kept free of the plugin validator so it loads fast.

const TILES = [
  { bg: '#FBECE9', fg: '#A8432D' },
  { bg: '#E9EFF7', fg: '#3A5A88' },
  { bg: '#F1ECF8', fg: '#5E4592' },
  { bg: '#EEF5EE', fg: '#3F6E3F' },
  { bg: '#FDF6E3', fg: '#7A5410' },
  { bg: '#F4F2EC', fg: '#44423C' },
];

/** A stable color for an app's initial, from its slug. */
export function tileFor(slug: string) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TILES[h % TILES.length]!;
}

export function AppTile({ slug, name, size = 36 }: { slug: string; name: string; size?: number }) {
  const t = tileFor(slug);
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: size / 4, background: t.bg, color: t.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42, flexShrink: 0 }}>
      {name.trim()[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  if (s < 86400 * 365) return `${Math.round(s / (86400 * 30))}mo ago`;
  return `${Math.round(s / (86400 * 365))}y ago`;
}

export default function Directory() {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'name'>('newest');
  const [apps, setApps] = useState<DirectoryListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  // `/` focuses the search, as on most directories.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      searchDirectory(api, { q: q.trim(), sort, limit: 100 })
        .then((r) => {
          if (!live) return;
          setApps(r);
          setError(null);
        })
        .catch(() => live && setError("Couldn't load the directory. Try again in a moment."));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, sort]);

  const sortButton = (value: 'newest' | 'name', label: string) => (
    <button
      type="button"
      aria-pressed={sort === value}
      onClick={() => setSort(value)}
      style={{ height: 36, padding: '0 14px', borderRadius: 18, border: sort === value ? 0 : '1px solid var(--color-border)', background: sort === value ? 'var(--color-text)' : 'var(--color-surface)', color: sort === value ? '#FFFFFF' : 'var(--color-text)', font: `${sort === value ? 600 : 500} 13px inherit`, fontFamily: 'inherit', cursor: 'pointer' }}
    >
      {label}
    </button>
  );

  return (
    <div className="pomo-site">
      <Seo
        title="Apps for Pomodoso — trackers, journals and counters"
        description="Small apps that live next to your pomodoro timer: water, reading list, mood, quit smoking. Install one or build your own with an AI assistant."
        path="/apps"
      />
      <SiteHeader current="apps" />

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '48px 24px 64px', display: 'flex', flexDirection: 'column', gap: 40 }}>
        <section style={{ display: 'flex', flexWrap: 'wrap', gap: 32, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ flex: '1 1 520px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#A8432D' }}>APPS</span>
            <h1 style={{ margin: 0, fontSize: 'clamp(2rem, 5vw, 2.75rem)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Small apps for the rest of your day.</h1>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', maxWidth: 560 }}>
              Trackers, check-ins and counters that live next to your pomodoros. Each app is one text file: no code runs, it only uses Pomodoso's own components.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/dashboard/apps" className="pomo-site-btn pomo-site-btn-primary">Publish yours</Link>
            <Link to="/apps/build" className="pomo-site-btn pomo-site-btn-secondary">Build with an AI assistant</Link>
          </div>
        </section>

        <section aria-labelledby="all" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 id="all" style={{ margin: 0, fontSize: 20 }}>Browse apps</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ flex: '1 1 320px', display: 'flex', alignItems: 'center', gap: 10, height: 44, border: '1px solid var(--color-border-strong)', borderRadius: 8, background: 'var(--color-surface)', padding: '0 12px', color: 'var(--color-text-muted)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input
                ref={search}
                type="search"
                aria-label="Search apps"
                placeholder="Search apps"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', font: 'inherit', color: 'var(--color-text)' }}
              />
              <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 11, border: '1px solid var(--color-border)', borderRadius: 4, padding: '1px 6px' }}>/</kbd>
            </label>
            <div role="group" aria-label="Sort" style={{ display: 'flex', gap: 6 }}>
              {sortButton('newest', 'Newest')}
              {sortButton('name', 'Name')}
            </div>
          </div>

          {error ? <p role="alert" style={{ margin: 0, color: '#A8432D' }}>{error}</p> : null}

          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden' }}>
            {apps === null && !error ? (
              <div style={{ padding: 24, color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading…</div>
            ) : apps?.length === 0 ? (
              <div style={{ padding: 32, color: 'var(--color-text-muted)', textAlign: 'center' }}>
                {q.trim() ? `No apps match "${q.trim()}".` : 'No apps published yet.'} <Link to="/apps/build">Build the first one</Link>.
              </div>
            ) : (
              apps?.map((a) => (
                <Link
                  key={a.slug}
                  to={`/apps/${a.slug}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: '1px solid #F0EEE8', textDecoration: 'none', color: 'var(--color-text)', flexWrap: 'wrap' }}
                >
                  <AppTile slug={a.slug} name={a.name} />
                  <span style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>
                      {a.name}{a.author ? <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--color-text-muted)' }}> by {a.author}</span> : null}
                    </span>
                    {a.description ? <span style={{ fontSize: 14, color: '#44423C' }}>{a.description}</span> : null}
                  </span>
                  {a.has_today ? (
                    <span style={{ fontSize: 12, color: '#A8432D', background: '#FBECE9', border: '1px solid #F2D3CC', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' }}>Today widget</span>
                  ) : null}
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>v{a.latest_version} · {timeAgo(a.updated_at)}</span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)', borderRadius: 12, padding: 28, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>Made an app? Share it.</h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
              Publish the file from your dashboard. Every file is checked against the format before it's listed. Listings aren't hand-reviewed: report anything off.
            </p>
          </div>
          <Link to="/dashboard/apps" className="pomo-site-btn pomo-site-btn-primary">Publish yours</Link>
        </section>
      </main>
    </div>
  );
}
