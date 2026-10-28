import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyPlugin, myPlugins, publishPlugin, takeDownPlugin, type DirectoryListing, type DirectoryVisibility } from '@pomodoso/api';
import {
  STARTER_PROMPT,
  checkUpdate,
  compareVersions,
  parsePluginFile,
  validatePluginData,
  type PluginIssue,
  type PluginManifest,
  type UpdateReport,
} from '@pomodoso/types/plugins';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/AuthContext.tsx';

// Dashboard → Apps: the apps you've published to the directory. Publish a new
// one or a new version (checked here like the CLI does, and again by the
// server), choose who sees it, take it down. Private is a Pro feature.

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function where(i: PluginIssue): string {
  const at = i.path || 'file';
  return i.line !== undefined ? `${at} (line ${i.line})` : at;
}

// ─── Publish ───────────────────────────────────────────────────────────────────

type Checked =
  | { ok: false; issues: PluginIssue[] }
  | { ok: true; manifest: PluginManifest; current: DirectoryListing | null; update: UpdateReport | null; error: string | null };

function PublishPanel({ mine, onPublished }: { mine: DirectoryListing[]; onPublished: () => void }) {
  const { entitlements } = useAuth();
  const canPrivate = entitlements.features.private_plugins;
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [visibility, setVisibility] = useState<DirectoryVisibility>('public');
  const [changelog, setChangelog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-checked as the file changes; a new version is compared with what's published.
  useEffect(() => {
    if (!text.trim()) {
      setChecked(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      const r = parsePluginFile(text);
      if (!r.ok) {
        setChecked({ ok: false, issues: r.issues });
        return;
      }
      const current = mine.find((l) => l.slug === r.manifest.id) ?? null;
      if (!current) {
        setChecked({ ok: true, manifest: r.manifest, current: null, update: null, error: null });
        return;
      }
      getMyPlugin(api, current.slug)
        .then((page) => {
          if (!live) return;
          const prev = validatePluginData(page.manifest);
          let err: string | null = null;
          if (compareVersions(r.manifest.version, current.latest_version) <= 0) {
            err = `Version ${r.manifest.version} is already published. Raise it above ${current.latest_version}.`;
          }
          setChecked({ ok: true, manifest: r.manifest, current, update: prev.ok ? checkUpdate(prev.manifest, r.manifest) : null, error: err });
        })
        .catch((e: unknown) => live && setChecked({ ok: true, manifest: r.manifest, current, update: null, error: message(e, "Couldn't load the published version.") }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, mine]);

  // A new version keeps the listing's visibility unless changed; a lapsed
  // subscriber's private app has to go public to get a new version.
  const current = checked?.ok ? checked.current : null;
  useEffect(() => {
    setVisibility(current && (current.visibility === 'public' || canPrivate) ? current.visibility : 'public');
  }, [current?.slug, current?.visibility, canPrivate]);

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(setText);
  };

  const blocked =
    !checked || !checked.ok || checked.error !== null || (checked.update !== null && checked.update.issues.length > 0) || (visibility === 'private' && !canPrivate);

  const publish = async () => {
    if (blocked || !checked?.ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const kind = checked.update?.kind;
      await publishPlugin(api, {
        manifest: checked.manifest,
        visibility,
        changelog: changelog.trim() || undefined,
        change_kind: kind === 'breaking' ? 'breaking' : checked.current ? 'additive' : undefined,
      });
      setText('');
      setChangelog('');
      onPublished();
    } catch (e) {
      setError(message(e, "Couldn't publish. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const copyPrompt = () => {
    void navigator.clipboard.writeText(STARTER_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="pomo-card" style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Publish an app</h2>
        <button className="pomo-link-btn" onClick={copyPrompt}>{copied ? 'Copied' : 'Copy a prompt for your AI assistant'}</button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6, marginBottom: 10 }}>
        Paste the app's file or pick it from your computer. To update one of your apps, publish its file with a higher version.
      </p>
      <textarea
        className="pomo-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="schema_version: 1&#10;id: my-app&#10;…"
        spellCheck={false}
        rows={8}
        style={{ width: '100%', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, resize: 'vertical' }}
      />
      <label className="pomo-btn" style={{ display: 'inline-flex', marginTop: 8, fontSize: 12, cursor: 'pointer' }}>
        <i className="ti ti-upload" style={{ marginRight: 6 }} />
        Choose a file
        <input type="file" accept=".yaml,.yml,.json,text/yaml,application/json" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
      </label>

      {checked && !checked.ok ? (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--accent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {checked.issues.length} problem{checked.issues.length === 1 ? '' : 's'} to fix
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {checked.issues.slice(0, 20).map((i, n) => (
              <li key={n}><code>{where(i)}</code>: {i.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {checked?.ok ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>
            <b>{checked.manifest.name}</b> <span style={{ color: 'var(--text-tert)' }}>· {checked.manifest.id} · v{checked.manifest.version}</span>
            <div style={{ fontSize: 12, color: 'var(--text-sec)', marginTop: 2 }}>
              {checked.current ? `New version of your app (published: v${checked.current.latest_version}).` : 'A new app.'}
            </div>
          </div>

          {checked.error ? <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{checked.error}</div> : null}

          {checked.update ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-sec)', lineHeight: 1.6 }}>
              <div style={{ color: 'var(--text)' }}>
                {checked.update.kind === 'breaking'
                  ? `Breaking update${checked.update.migrates ? ': installed copies run its migrate steps' : ''}.`
                  : checked.update.kind === 'additive'
                    ? 'Additive update: installed copies can update automatically.'
                    : 'Only the version changed.'}
              </div>
              {checked.update.changes.length > 0 ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {checked.update.changes.slice(0, 12).map((c, n) => (
                    <li key={n}>{c.kind === 'breaking' ? '⚠ ' : ''}<code>{c.path}</code>: {c.message}</li>
                  ))}
                </ul>
              ) : null}
              {checked.update.issues.map((i, n) => (
                <div key={n} style={{ color: 'var(--accent)' }}><code>{where(i)}</code>: {i.message}</div>
              ))}
            </div>
          ) : null}

          <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <legend style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Who can see it</legend>
            <label style={{ display: 'flex', gap: 8, fontSize: 12.5, color: 'var(--text)', alignItems: 'baseline' }}>
              <input type="radio" name="visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
              <span>Public <span style={{ color: 'var(--text-sec)' }}>— in the directory, anyone can install it</span></span>
            </label>
            <label style={{ display: 'flex', gap: 8, fontSize: 12.5, color: canPrivate ? 'var(--text)' : 'var(--text-tert)', alignItems: 'baseline' }}>
              <input type="radio" name="visibility" disabled={!canPrivate} checked={visibility === 'private'} onChange={() => setVisibility('private')} />
              <span>
                Private <span style={{ color: 'var(--text-sec)' }}>— only you see it and install it, from here</span>{' '}
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: 'var(--bg-darker)', color: 'var(--text-sec)' }}>PRO</span>
                {!canPrivate ? <> · <Link to="/pricing" style={{ color: 'var(--accent)' }}>Upgrade</Link></> : null}
              </span>
            </label>
            {checked.current?.visibility === 'private' && !canPrivate ? (
              <div style={{ fontSize: 12, color: 'var(--text-sec)' }}>This app is private. Without Pro, a new version has to be public; the current one stays private.</div>
            ) : null}
          </fieldset>

          {checked.current ? (
            <textarea
              className="pomo-input"
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="What's new (optional)"
              maxLength={2000}
              rows={2}
              style={{ width: '100%', fontSize: 12.5, resize: 'vertical' }}
            />
          ) : null}

          {error ? <div style={{ fontSize: 12.5, color: 'var(--accent)' }}>{error}</div> : null}
          <div>
            <button className="pomo-btn pomo-btn-primary" disabled={blocked || busy} onClick={() => void publish()}>
              {busy ? 'Publishing…' : checked.current ? `Publish v${checked.manifest.version}` : 'Publish'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Your apps ─────────────────────────────────────────────────────────────────

function AppRow({ app, onTakenDown }: { app: DirectoryListing; onTakenDown: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeDown = () => {
    setError(null);
    takeDownPlugin(api, app.slug)
      .then(onTakenDown)
      .catch((e: unknown) => setError(message(e, "Couldn't take it down.")));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--bg-darker)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text-sec)', flexShrink: 0 }}>
        {app.name[0]?.toUpperCase()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>
          {app.name}{' '}
          <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-tert)' }}>
            v{app.latest_version} · {app.visibility === 'private' ? 'Private' : 'Public'}
            {app.has_today ? ' · Today widget' : ''}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {app.description ?? app.slug}
        </div>
        {error ? <div style={{ fontSize: 11.5, color: 'var(--accent)' }}>{error}</div> : null}
      </div>
      {confirming ? (
        <button
          className="pomo-btn"
          style={{ fontSize: 11, padding: '4px 8px', color: 'var(--accent)', borderColor: 'var(--accent)' }}
          onClick={takeDown}
          onBlur={() => setConfirming(false)}
          autoFocus
        >
          Confirm take down
        </button>
      ) : (
        <button className="pomo-btn pomo-btn-icon" aria-label={`Take down ${app.name}`} title="Take down" onClick={() => setConfirming(true)}>
          <i className="ti ti-trash" />
        </button>
      )}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AppsPage() {
  const [mine, setMine] = useState<DirectoryListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setError(null);
    myPlugins(api)
      .then(setMine)
      .catch((e: unknown) => setError(message(e, "Couldn't load your apps.")));
  };

  useEffect(refresh, []);

  return (
    <>
      <div className="pomo-page-header">
        <div>
          <div className="pomo-eyebrow">Directory</div>
          <h1 className="pomo-page-title">Your apps</h1>
        </div>
      </div>

      {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="pomo-card" style={{ maxWidth: 720, marginBottom: 16 }}>
        {mine === null && !error ? (
          <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
        ) : mine?.length === 0 ? (
          <div className="pomo-empty">
            <i className="ti ti-apps" />
            You haven't published any apps yet.
          </div>
        ) : (
          mine?.map((a) => <AppRow key={a.slug} app={a} onTakenDown={refresh} />)
        )}
      </div>

      <PublishPanel mine={mine ?? []} onPublished={refresh} />
    </>
  );
}
