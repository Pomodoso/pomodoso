import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { stringify } from 'yaml';
import { ApiError, getDirectoryPage, reportPlugin, type DirectoryPage } from '@pomodoso/api';
import { remixPrompt, validatePluginData, type PluginManifest } from '@pomodoso/types/plugins';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/AuthContext.tsx';
import { Seo } from '../../seo.tsx';
import { InstallAppButton } from '../../components/InstallAppButton.tsx';
import { AppTile, timeAgo } from './Directory.tsx';
import { LivePreview } from './LivePreview.tsx';
import { SiteHeader } from './SiteHeader.tsx';

// /apps/:slug: one app of the directory. Install (through the extension),
// download its file, try it in a live preview, read its file and versions,
// copy a remix prompt, report it.

type Tab = 'overview' | 'file' | 'versions';

// The stored file comes back from Postgres (jsonb) with its keys reordered;
// shown and downloaded in the order the format reads, the rest after.
const KEY_ORDER = [
  'schema_version', 'id', 'name', 'version', 'icon', 'description', 'author', 'license',
  'settings', 'collections', 'computed', 'views', 'today', 'hooks', 'migrate',
  'key', 'kind', 'title_field', 'type', 'label', 'on', 'ask', 'yes', 'pick', 'line',
  'default_on', 'widget', 'fields', 'blocks',
];

function inFormatOrder(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(inFormatOrder);
  if (!v || typeof v !== 'object') return v;
  const rank = (k: string) => (KEY_ORDER.includes(k) ? KEY_ORDER.indexOf(k) : KEY_ORDER.length);
  const keys = Object.keys(v).sort((a, b) => rank(a) - rank(b));
  return Object.fromEntries(keys.map((k) => [k, inFormatOrder((v as Record<string, unknown>)[k])]));
}

/** Block types, the Today widget and hooks the file uses, in reading order. */
function uses(m: PluginManifest): { name: string; hook: boolean }[] {
  const out: { name: string; hook: boolean }[] = [];
  const seen = new Set<string>();
  const add = (name: string, hook = false) => {
    if (seen.has(name)) return;
    seen.add(name);
    out.push({ name, hook });
  };
  for (const v of m.views) for (const b of v.blocks) add(b.type);
  if (m.today) add('today widget', true);
  for (const h of m.hooks ?? []) add(`on ${h.on}`, true);
  return out;
}

function ReportBox({ slug }: { slug: string }) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (!session) {
    return <Link to={`/login?next=${encodeURIComponent(`/apps/${slug}`)}`} style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Sign in to report this app</Link>;
  }
  if (state === 'sent') return <span role="status" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Thanks. We'll take a look.</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', border: 0, background: 'none', padding: 0, fontSize: 13, color: 'var(--color-text-muted)', textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>
        Report this app
      </button>
    );
  }
  const send = () => {
    if (!reason.trim() || state === 'sending') return;
    setState('sending');
    reportPlugin(api, slug, reason.trim())
      .then(() => setState('sent'))
      .catch(() => setState('error'));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor="report" style={{ fontSize: 13, fontWeight: 600 }}>What's wrong with it?</label>
      <textarea id="report" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} style={{ border: '1px solid var(--color-border-strong)', borderRadius: 8, padding: '8px 10px', font: 'inherit', fontSize: 13, resize: 'vertical' }} />
      {state === 'error' ? <span role="alert" style={{ fontSize: 12, color: '#A8432D' }}>Couldn't send it. Try again.</span> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="pomo-site-btn pomo-site-btn-secondary" style={{ height: 36 }} disabled={!reason.trim() || state === 'sending'} onClick={send}>Send report</button>
        <button type="button" className="pomo-site-btn" style={{ height: 36, background: 'none', color: 'var(--color-text-muted)' }} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export default function AppPage() {
  const { slug = '' } = useParams();
  const [page, setPage] = useState<DirectoryPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    setPage(null);
    setMissing(false);
    setError(false);
    getDirectoryPage(api, slug)
      .then((p) => live && setPage(p))
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setMissing(true);
        else setError(true);
      });
    return () => {
      live = false;
    };
  }, [slug]);

  const checked = useMemo(() => (page ? validatePluginData(page.manifest) : null), [page]);
  const file = useMemo(() => (page ? stringify(inFormatOrder(page.manifest), { lineWidth: 0 }) : ''), [page]);

  const download = () => {
    const url = URL.createObjectURL(new Blob([file], { type: 'text/yaml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyRemix = () => {
    void navigator.clipboard.writeText(remixPrompt(file)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const tabButton = (value: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setTab(value)}
      style={{ height: 40, border: 0, borderBottom: `2px solid ${tab === value ? 'var(--color-accent)' : 'transparent'}`, background: 'transparent', font: `${tab === value ? 600 : 500} 14px inherit`, fontFamily: 'inherit', color: tab === value ? 'var(--color-text)' : 'var(--color-text-muted)', padding: 0, cursor: 'pointer' }}
    >
      {label}
    </button>
  );

  return (
    <div className="pomo-site">
      <Seo
        title={page ? `${page.name} — a Pomodoso app` : 'A Pomodoso app'}
        description={page?.description ?? 'An app for Pomodoso, from the directory.'}
        path={`/apps/${slug}`}
      />
      <SiteHeader current="apps" />

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <Link to="/apps" style={{ fontSize: 14, textDecoration: 'none' }}>← All apps</Link>

        {missing ? (
          <div style={{ padding: '48px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>This app isn't in the directory</h1>
            <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>It may have been taken down, or it's private to its author. <Link to="/apps">Browse the apps</Link>.</p>
          </div>
        ) : error ? (
          <p role="alert" style={{ color: '#A8432D' }}>Couldn't load this app. Try again in a moment.</p>
        ) : !page ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : (
          <>
            <section style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}>
              <AppTile slug={page.slug} name={page.name} size={64} />
              <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h1 style={{ margin: 0, fontSize: 32, letterSpacing: '-0.01em' }}>{page.name}</h1>
                <span style={{ color: 'var(--color-text-muted)' }}>
                  {page.description}
                  {page.author ? <> · by {page.author}</> : null}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 420 }}>
                <InstallAppButton slug={page.slug} name={page.name} label="Install in Pomodoso" className="pomo-site-btn pomo-site-btn-primary" />
                <button type="button" className="pomo-site-btn pomo-site-btn-secondary" onClick={download}>Download file</button>
              </div>
            </section>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, alignItems: 'flex-start' }}>
              <div style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div role="tablist" aria-label="App" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--color-border)' }}>
                  {tabButton('overview', 'Overview')}
                  {tabButton('file', 'App file')}
                  {tabButton('versions', `Versions (${page.versions.length})`)}
                </div>

                {tab === 'overview' ? (
                  checked?.ok ? (
                    <>
                      <LivePreview manifest={checked.manifest} />
                      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 18 }}>What it uses</h2>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                          {uses(checked.manifest).map((u) => (
                            <span key={u.name} style={{ background: u.hook ? '#FBECE9' : 'var(--color-surface)', color: u.hook ? '#A8432D' : 'var(--color-text)', border: `1px solid ${u.hook ? '#F2D3CC' : 'var(--color-border)'}`, borderRadius: 6, padding: '3px 8px' }}>{u.name}</span>
                          ))}
                        </div>
                      </section>
                      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 18 }}>What it stores</h2>
                        <p style={{ margin: 0, color: '#44423C' }}>
                          {checked.manifest.collections.map((c) => c.key.replace(/_/g, ' ')).join(', ')}: only in your browser, and in your account if you sync. Apps only see their own data and can't run code.
                        </p>
                      </section>
                    </>
                  ) : (
                    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>This app needs a newer version of Pomodoso, so it can't be previewed here.</p>
                  )
                ) : tab === 'file' ? (
                  <pre style={{ margin: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, overflowX: 'auto', maxHeight: 640 }}>{file}</pre>
                ) : (
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {page.versions.map((v) => (
                      <li key={v.version} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{v.version}</span>
                          <span style={{ fontSize: 12, color: v.change_kind === 'breaking' ? '#A8432D' : 'var(--color-text-muted)' }}>{v.change_kind === 'initial' ? 'first version' : v.change_kind}</span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{timeAgo(v.created_at)}</span>
                        </span>
                        {v.changelog ? <span style={{ fontSize: 14, color: '#44423C', whiteSpace: 'pre-wrap' }}>{v.changelog}</span> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <aside style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <dl style={{ margin: 0, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 8px', fontSize: 14 }}>
                  <dt style={{ color: 'var(--color-text-muted)' }}>Version</dt><dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{page.latest_version}</dd>
                  <dt style={{ color: 'var(--color-text-muted)' }}>Updated</dt><dd style={{ margin: 0 }}>{timeAgo(page.updated_at)}</dd>
                  <dt style={{ color: 'var(--color-text-muted)' }}>Format</dt>
                  <dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>v1 {checked?.ok ? <span style={{ color: '#3F6E3F' }}>✓ valid</span> : <span style={{ color: '#A8432D' }}>newer</span>}</dd>
                  <dt style={{ color: 'var(--color-text-muted)' }}>License</dt><dd style={{ margin: 0 }}>{checked?.ok ? checked.manifest.license ?? 'MIT' : '—'}</dd>
                  {page.author ? <><dt style={{ color: 'var(--color-text-muted)' }}>Author</dt><dd style={{ margin: 0 }}>{page.author}</dd></> : null}
                  <dt style={{ color: 'var(--color-text-muted)' }}>Today widget</dt><dd style={{ margin: 0 }}>{page.has_today ? 'Yes' : 'No'}</dd>
                </dl>
                <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>Remix with an AI assistant</span>
                  <span style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>Copies this app's file with Pomodoso's notes, ready to paste into Claude, ChatGPT or your editor.</span>
                  <button type="button" className="pomo-site-btn pomo-site-btn-secondary" style={{ height: 40 }} onClick={copyRemix}>{copied ? 'Copied' : 'Copy remix prompt'}</button>
                </div>
                <ReportBox slug={page.slug} />
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
