import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  formatStat,
  parsePluginExport,
  parsePluginFile,
  SHOW_ON_TODAY_KEY,
  validatePluginData,
  type PluginExport,
  type PluginIssue,
  type PluginManifest,
  type PluginRecord,
} from '@pomodoso/types/plugins';
import { PluginIcon, PluginView, type PluginActions, type PluginEnv } from '@pomodoso/ui/plugins';

import { db, localDate, type PluginRow } from '../../db';
import {
  addRecord,
  deleteRecord,
  exportPlugin,
  importPlugin,
  installPlugin,
  installedBySlug,
  setDaily,
  applyPluginUpdate,
  setAutoUpdate,
  uninstallPlugin,
  updatePluginSetting,
  updateRecord,
} from '../../plugins';
import { defaultSettings, EditableOptions, SettingsFields } from './SettingsFields';
import { isSupported } from './supported';
import { Browse, directoryAvailable } from './Browse';
import { openListing, SignInToOpen } from './directory';
import { describeStep, updateFor, useDirectoryUpdates, type AvailableUpdate } from './useDirectoryUpdates';
import { usePluginData } from './usePluginData';

// The Apps tab: installed plugins, each one's views, its settings, and
// installing a new one from a file. Signed out, everything stays visible but
// read-only (docs: plugins-plan §11).

interface AppsTabProps {
  timezone: string;
  weekStart: number;
  isSignedIn: boolean;
  tab: { url: string; title: string };
  onSignIn: () => void;
  /** An app to open, e.g. from its Today widget; a new nonce opens it again. */
  openApp?: { id: string; nonce: number } | null;
  /** A directory app to preview for install, e.g. asked for by the web app. */
  installSlug?: { slug: string; nonce: number } | null;
}

/** What Browse picked: the listing's file, checked, on its way to the install preview. */
type Picked = { text: string; manifest: PluginManifest };
type Screen = { kind: 'list' } | { kind: 'add'; slug?: string; picked?: Picked; mode?: 'file' } | { kind: 'app'; id: string } | { kind: 'settings'; id: string } | { kind: 'updates' };

export function AppsTab({ timezone, weekStart, isSignedIn, tab, onSignIn, openApp, installSlug }: AppsTabProps) {
  const [screen, setScreen] = useState<Screen>(
    installSlug ? { kind: 'add', slug: installSlug.slug } : openApp ? { kind: 'app', id: openApp.id } : { kind: 'list' },
  );
  useEffect(() => {
    if (openApp) setScreen({ kind: 'app', id: openApp.id });
  }, [openApp?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (installSlug) setScreen({ kind: 'add', slug: installSlug.slug });
  }, [installSlug?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const plugins = useLiveQuery(async () => (await db.plugins.toArray()).filter((p) => !p.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), []);
  const readOnly = !isSignedIn;
  const { updates, gone } = useDirectoryUpdates(plugins);

  // Small (additive) updates apply on their own for apps that allow it; a
  // breaking one always waits for the user. Each version is tried once per
  // popup, so a failing one doesn't retry in a loop.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (readOnly || !plugins) return;
    for (const [id, u] of updates) {
      const p = plugins.find((x) => x.id === id);
      const attempt = `${id}@${u.next.version}`;
      if (!p?.autoUpdate || u.report.kind === 'breaking' || u.report.issues.length > 0 || tried.current.has(attempt)) continue;
      tried.current.add(attempt);
      void applyPluginUpdate(id, u.next).catch(() => {});
    }
  }, [updates, plugins, readOnly]);

  const current = screen.kind === 'app' || screen.kind === 'settings' ? plugins?.find((p) => p.id === screen.id && isSupported(p)) : undefined;
  // An app uninstalled (here or by sync) while open falls back to the list.
  // Asks the table rather than trusting `plugins`: right after an install the
  // live query hasn't caught up yet and the new app would look gone.
  const openId = screen.kind === 'app' || screen.kind === 'settings' ? screen.id : null;
  useEffect(() => {
    if (!openId || current) return;
    void db.plugins.get(openId).then((p) => {
      if (!p || p.deletedAt) setScreen({ kind: 'list' });
    });
  }, [openId, current, plugins]);

  // Installed | Browse. Until the user picks, it's Browse with nothing installed yet.
  const [listTab, setListTab] = useState<'installed' | 'browse' | null>(null);

  if (!plugins) return null;
  const listTabShown = !directoryAvailable ? 'installed' : listTab ?? (plugins.length === 0 ? 'browse' : 'installed');

  return (
    <div style={{ padding: '10px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {readOnly ? <SignedOutBanner onSignIn={onSignIn} /> : null}
      {screen.kind === 'add' ? (
        <AddApp
          key={screen.slug ?? screen.picked?.manifest.id ?? screen.mode ?? ''}
          slug={screen.slug}
          picked={screen.picked}
          initialMode={screen.mode}
          timezone={timezone}
          readOnly={readOnly}
          onCancel={() => setScreen({ kind: 'list' })}
          onInstalled={(id) => setScreen({ kind: 'app', id })}
        />
      ) : screen.kind === 'app' && current ? (
        <AppScreen
          plugin={current} timezone={timezone} weekStart={weekStart} tab={tab} readOnly={readOnly}
          onBack={() => setScreen({ kind: 'list' })}
          onSettings={() => setScreen({ kind: 'settings', id: current.id })}
        />
      ) : screen.kind === 'settings' && current ? (
        <AppSettings plugin={current} update={updates.get(current.id)} gone={gone.has(current.id)} readOnly={readOnly} onBack={() => setScreen({ kind: 'app', id: current.id })} />
      ) : screen.kind === 'updates' ? (
        <UpdatesScreen plugins={plugins} updates={updates} readOnly={readOnly} onBack={() => setScreen({ kind: 'list' })} onOpen={(id) => setScreen({ kind: 'app', id })} />
      ) : (
        <>
          <ListTabs tab={listTabShown} count={plugins.length} onChange={setListTab} />
          {listTabShown === 'browse' ? (
            <>
              <Browse
                autoFocus={false}
                installed={new Set(plugins.filter((p) => !p.deletedAt).map((p) => p.slug))}
                onOpenInstalled={(slug) => {
                  const p = plugins.find((x) => x.slug === slug && !x.deletedAt);
                  if (p) setScreen({ kind: 'app', id: p.id });
                }}
                onPick={(text, manifest) => {
                  // Back from the preview returns here, to Browse.
                  setListTab('browse');
                  setScreen({ kind: 'add', picked: { text, manifest } });
                }}
              />
              <button type="button" disabled={readOnly} onClick={() => setScreen({ kind: 'add', mode: 'file' })} style={{ ...btn('ghost'), alignSelf: 'center', fontSize: 11, opacity: readOnly ? 0.5 : 1 }}>
                Have a file? Install from a file ›
              </button>
            </>
          ) : (
            <AppList
              plugins={plugins} updates={updates} timezone={timezone} weekStart={weekStart}
              onOpen={(id) => setScreen({ kind: 'app', id })}
              onUpdate={(id) => setScreen({ kind: 'settings', id })}
              onUpdates={() => setScreen({ kind: 'updates' })}
              onBrowse={() => setListTab(directoryAvailable ? 'browse' : 'installed')}
              onAddFile={() => setScreen({ kind: 'add', mode: 'file' })}
              readOnly={readOnly}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const btn = (kind: 'primary' | 'secondary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '6px 12px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  ...(kind === 'primary' ? { background: 'var(--color-accent)', color: '#fff', border: '1px solid var(--color-accent)' }
    : kind === 'secondary' ? { background: 'var(--color-accent-soft)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)' }
    : kind === 'danger' ? { background: 'none', color: 'var(--color-accent)', border: '1px solid var(--color-border)' }
    : { background: 'none', color: 'var(--color-text-muted)', border: '1px solid transparent', fontWeight: 500 }),
});

const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 };

function SignedOutBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--color-text)' }}>
      <span style={{ flex: 1 }}>You're signed out. Sign in to use your apps.</span>
      <button type="button" onClick={onSignIn} style={btn('secondary')}>Sign in</button>
    </div>
  );
}

function Header({ title, onBack, right }: { title: React.ReactNode; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" aria-label="Back" onClick={onBack} style={{ ...btn('ghost'), padding: '2px 6px', fontSize: 16 }}>‹</button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
      {right}
    </div>
  );
}

function IssueList({ issues }: { issues: PluginIssue[] }) {
  return (
    <div style={{ padding: '8px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', background: 'var(--color-accent-soft)', fontSize: 11, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <strong style={{ fontSize: 12 }}>This file can't be installed</strong>
      {issues.slice(0, 8).map((i, k) => (
        <div key={k}>
          {i.path ? <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{i.path}{i.line ? ` (line ${i.line})` : ''}</code> : null} {i.message}
        </div>
      ))}
      {issues.length > 8 ? <div style={{ color: 'var(--color-text-muted)' }}>…and {issues.length - 8} more</div> : null}
    </div>
  );
}

function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ─── List ────────────────────────────────────────────────────────────────────

/** Installed | Browse, over the app list. Browse needs the directory; without it there's one tab. */
function ListTabs({ tab, count, onChange }: { tab: 'installed' | 'browse'; count: number; onChange: (t: 'installed' | 'browse') => void }) {
  if (!directoryAvailable) return null;
  const item = (value: 'installed' | 'browse', label: string) => (
    <button
      type="button" onClick={() => onChange(value)} aria-pressed={tab === value}
      style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: tab === value ? 600 : 400, fontFamily: 'inherit', cursor: 'pointer', border: 'none', borderBottom: `2px solid ${tab === value ? 'var(--color-accent)' : 'transparent'}`, background: 'none', color: tab === value ? 'var(--color-text)' : 'var(--color-text-muted)' }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
      {item('installed', count > 0 ? `Installed (${count})` : 'Installed')}
      {item('browse', 'Browse apps')}
    </div>
  );
}

function AppList({ plugins, updates, timezone, weekStart, readOnly, onOpen, onUpdate, onUpdates, onBrowse, onAddFile }: {
  plugins: PluginRow[];
  updates: Map<string, AvailableUpdate>;
  timezone: string;
  weekStart: number;
  readOnly: boolean;
  onOpen: (id: string) => void;
  /** The Update badge: that app's settings, where its update is. */
  onUpdate: (id: string) => void;
  onUpdates: () => void;
  onBrowse: () => void;
  onAddFile: () => void;
}) {
  const fromDirectory = plugins.some((p) => p.source === 'directory');
  return (
    <>
      {updates.size > 0 ? (
        <button
          type="button" onClick={onUpdates}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--color-text)', textAlign: 'left' }}
        >
          <span style={{ flex: 1 }}><b>{updates.size} update{updates.size === 1 ? '' : 's'}</b> available</span>
          <span style={{ color: 'var(--color-accent)', fontWeight: 600 }}>Review ›</span>
        </button>
      ) : fromDirectory ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onUpdates} style={{ ...btn('ghost'), padding: '0 2px', fontSize: 11 }}>Updates</button>
        </div>
      ) : null}
      {plugins.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 12px 8px', color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Apps</div>
          Small tools that live inside Pomodoso: a reading list, a quit-smoking tracker, a year in pixels… Each one is a single file you can install, share or write yourself.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plugins.map((p) => (isSupported(p)
            ? <AppRow key={p.id} plugin={p} hasUpdate={updates.has(p.id)} timezone={timezone} weekStart={weekStart} onOpen={() => onOpen(p.id)} onUpdate={() => onUpdate(p.id)} />
            : <UnsupportedRow key={p.id} plugin={p} />))}
        </div>
      )}
      {directoryAvailable ? (
        <button type="button" onClick={onBrowse} style={btn('secondary')}>Browse more apps ›</button>
      ) : (
        <button type="button" disabled={readOnly} onClick={onAddFile} style={{ ...btn('secondary'), opacity: readOnly ? 0.5 : 1 }}>+ Add an app from a file</button>
      )}
    </>
  );
}

/** One installed app, with its Today value as a hint when it declares one. */
function AppRow({ plugin, hasUpdate, timezone, weekStart, onOpen, onUpdate }: { plugin: PluginRow; hasUpdate: boolean; timezone: string; weekStart: number; onOpen: () => void; onUpdate: () => void }) {
  const { evaluator } = usePluginData(plugin, timezone, weekStart);
  const w = plugin.manifest.today?.widget;
  // The Today value as a hint: the widget's number, or a `stats` widget's first one.
  const shown = w && 'value' in w ? { label: w.label, value: w.value, format: w.type === 'stat' ? w.format : undefined } : w?.type === 'stats' ? w.items[0] : undefined;
  const hint = evaluator && shown ? `${shown.label}: ${formatStat(evaluator.value(shown.value), shown.format ?? 'number', new Date().toISOString())}` : plugin.manifest.description;
  // A div, not a button: the Update badge inside is a button of its own.
  return (
    <div
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
    >
      <PluginIcon icon={plugin.manifest.icon} name={plugin.manifest.name} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
          {plugin.manifest.name}
          {hasUpdate ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpdate(); }}
              style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, fontFamily: 'inherit', padding: '1px 5px', borderRadius: 99, border: 'none', cursor: 'pointer', background: 'var(--color-accent-soft)', color: 'var(--color-accent)', verticalAlign: 'middle' }}
            >
              Update
            </button>
          ) : null}
        </span>
        {hint ? <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span> : null}
      </span>
      <span style={{ color: 'var(--color-text-faint)' }}>›</span>
    </div>
  );
}

/**
 * An app synced from another device whose file this version can't read
 * (a newer format, or a damaged one). Its data is kept; it opens once this
 * Pomodoso is updated.
 */
function UnsupportedRow({ plugin }: { plugin: PluginRow }) {
  const name = typeof plugin.manifest?.name === 'string' ? plugin.manifest.name : plugin.slug;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--color-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', opacity: 0.75 }}>
      <PluginIcon name={name} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{name}</span>
        <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)' }}>Needs a newer version of Pomodoso to open</span>
      </span>
    </div>
  );
}

// ─── Add / preview ───────────────────────────────────────────────────────────

function AddApp({ slug, picked, initialMode, timezone, readOnly, onCancel, onInstalled }: {
  slug?: string | undefined;
  /** Chosen in the Browse tab: straight to its install preview. */
  picked?: Picked | undefined;
  initialMode?: 'file' | undefined;
  timezone: string;
  readOnly: boolean;
  onCancel: () => void;
  onInstalled: (id: string) => void;
}) {
  const [text, setText] = useState(picked?.text ?? '');
  const [manifest, setManifest] = useState<PluginManifest | null>(picked?.manifest ?? null);
  const [backup, setBackup] = useState<PluginExport | null>(null);
  const [issues, setIssues] = useState<PluginIssue[]>([]);

  const [mode, setMode] = useState<'browse' | 'file'>(initialMode ?? (directoryAvailable ? 'browse' : 'file'));
  const [source, setSource] = useState<PluginRow['source']>(picked ? 'directory' : 'file');
  // A file (or listing) of an app that's already installed updates it rather
  // than installing a second copy: undefined while it's looked up.
  const [installed, setInstalled] = useState<PluginRow | null | undefined>(undefined);
  useEffect(() => {
    if (!manifest) {
      setInstalled(undefined);
      return;
    }
    let live = true;
    void installedBySlug(manifest.id).then((p) => live && setInstalled(p ?? null));
    return () => {
      live = false;
    };
  }, [manifest]);

  // Asked for by slug (from the web app): open that listing's preview.
  const [opening, setOpening] = useState<{ slug: string; error: string | null } | null>(slug ? { slug, error: null } : null);
  useEffect(() => {
    if (!slug) return;
    let live = true;
    openListing(slug)
      .then((page) => {
        if (!live) return;
        const r = validatePluginData(page.manifest);
        if (!r.ok) {
          setOpening({ slug, error: `"${page.name}" needs a newer version of Pomodoso.` });
          return;
        }
        // JSON is YAML, so the install path parses it like any file.
        setText(JSON.stringify(page.manifest));
        setSource('directory');
        setManifest(r.manifest);
        setOpening(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setOpening({
          slug,
          error: e instanceof SignInToOpen
            ? 'Sign in to Pomodoso to install your private apps.'
            : "Couldn't open that app. It may have been taken down, or it's private to another account.",
        });
      });
    return () => {
      live = false;
    };
  }, [slug]);
  const check = (input: string) => {
    setSource('file');
    setText(input);
    // An app's export (from its settings) restores the app with its data.
    if (/^pomodoso_plugin_export:/m.test(input)) {
      const r = parsePluginExport(input);
      setBackup(r.ok ? r.value : null);
      setIssues(r.ok ? [] : r.issues);
      return;
    }
    const r = parsePluginFile(input);
    if (r.ok) {
      setManifest(r.manifest);
      setIssues([]);
    } else {
      setManifest(null);
      setIssues(r.issues);
    }
  };

  if (backup) {
    return <RestorePreview text={text} backup={backup} readOnly={readOnly} onBack={() => setBackup(null)} onInstalled={onInstalled} />;
  }
  if (opening) {
    return (
      <>
        <Header title="Add an app" onBack={onCancel} />
        <div style={{ fontSize: 12, color: opening.error ? 'var(--color-accent)' : 'var(--color-text-muted)', textAlign: 'center', padding: '16px 8px', lineHeight: 1.5 }}>
          {opening.error ?? `Opening “${opening.slug}”…`}
        </div>
      </>
    );
  }
  if (manifest && installed === undefined) return null;
  if (manifest && installed) {
    return <UpdatePreview installed={installed} next={manifest} readOnly={readOnly} onBack={() => (picked ? onCancel() : setManifest(null))} onUpdated={onInstalled} />;
  }
  if (manifest) {
    return <InstallPreview text={text} manifest={manifest} source={source} timezone={timezone} readOnly={readOnly} onBack={() => (picked ? onCancel() : setManifest(null))} onInstalled={onInstalled} />;
  }

  const tab = (value: 'browse' | 'file', label: string) => (
    <button
      type="button" onClick={() => setMode(value)}
      style={{ flex: 1, padding: '5px 0', fontSize: 12, fontWeight: mode === value ? 600 : 400, fontFamily: 'inherit', cursor: 'pointer', border: 'none', borderBottom: `2px solid ${mode === value ? 'var(--color-accent)' : 'transparent'}`, background: 'none', color: mode === value ? 'var(--color-text)' : 'var(--color-text-muted)' }}
    >
      {label}
    </button>
  );

  return (
    <>
      <Header title="Add an app" onBack={onCancel} />
      {directoryAvailable ? <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>{tab('browse', 'Browse')}{tab('file', 'From a file')}</div> : null}
      {mode === 'browse' && directoryAvailable ? (
        <Browse
          onPick={(picked, m) => {
            setText(picked);
            setSource('directory');
            setManifest(m);
          }}
        />
      ) : (
        <FromFile text={text} issues={issues} setText={setText} check={check} />
      )}
    </>
  );
}

function FromFile({ text, issues, setText, check }: {
  text: string;
  issues: PluginIssue[];
  setText: (t: string) => void;
  check: (t: string) => void;
}) {
  return (
    <>
      <label style={{ ...btn('secondary'), textAlign: 'center' }}>
        Choose a file (.yaml)
        <input
          type="file" accept=".yaml,.yml,text/yaml" style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) check(await readFile(file));
          }}
        />
      </label>
      <div style={{ fontSize: 11, color: 'var(--color-text-faint)', textAlign: 'center' }}>or paste it</div>
      <textarea
        value={text} rows={10} spellCheck={false}
        placeholder={'schema_version: 1\nid: my-app\nname: My app\n…'}
        onChange={(e) => setText(e.target.value)}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 11, padding: 8, color: 'var(--color-text)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', resize: 'vertical', outline: 'none' }}
      />
      {issues.length > 0 ? <IssueList issues={issues} /> : null}
      <button type="button" disabled={!text.trim()} onClick={() => check(text)} style={{ ...btn('primary'), opacity: text.trim() ? 1 : 0.5 }}>Continue</button>
    </>
  );
}

/** A newer file of an installed app: what changes, then the update, entries kept (and converted for a breaking one). */
function UpdatePreview({ installed, next, readOnly, onBack, onUpdated }: {
  installed: PluginRow;
  next: PluginManifest;
  readOnly: boolean;
  onBack: () => void;
  onUpdated: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = updateFor(installed.manifest, next);
  const breaking = update?.report.kind === 'breaking';
  const blocked = (update?.report.issues.length ?? 0) > 0;
  const steps = update?.report.migrates ? next.migrate?.steps ?? [] : [];
  const box = { fontSize: 11, color: 'var(--color-text)', lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${breaking || blocked ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column' as const, gap: 6 };

  return (
    <>
      <Header title="Update app" onBack={onBack} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <PluginIcon icon={next.icon} name={next.name} size={40} />
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>
          {next.name} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-faint)' }}>{installed.manifest.version} → {next.version}</span>
        </div>
      </div>
      {!update ? (
        <div style={box}>
          You already have {installed.manifest.name} {installed.manifest.version}. To update it, raise <code>version</code> in the file above {installed.manifest.version}.
        </div>
      ) : (
        <div style={box}>
          {blocked ? (
            update.report.issues.map((i, n) => <div key={n} style={{ color: 'var(--color-accent)' }}>{i.message}</div>)
          ) : breaking ? (
            <>
              <div>It changes how your entries are stored:</div>
              {steps.map((s, i) => <div key={i}>• {describeStep(s)}</div>)}
            </>
          ) : update.report.changes.length > 0 ? (
            update.report.changes.slice(0, 8).map((c, i) => <div key={i} style={{ color: 'var(--color-text-muted)' }}>• {c.message}</div>)
          ) : (
            <div style={{ color: 'var(--color-text-muted)' }}>Only the version changes.</div>
          )}
          <div style={{ color: 'var(--color-text-faint)' }}>Your entries and settings stay.</div>
        </div>
      )}
      {error ? <div style={{ fontSize: 11, color: 'var(--color-accent)' }}>{error}</div> : null}
      {update && !blocked ? (
        <button
          type="button" disabled={readOnly || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await applyPluginUpdate(installed.id, next);
              onUpdated(installed.id);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          style={{ ...btn('primary'), opacity: readOnly ? 0.5 : 1 }}
        >
          {breaking ? 'Update and convert my entries' : 'Update'}
        </button>
      ) : null}
    </>
  );
}

function InstallPreview({ text, manifest, source, timezone, readOnly, onBack, onInstalled }: {
  text: string;
  manifest: PluginManifest;
  source: PluginRow['source'];
  timezone: string;
  /** Signing out while the preview is open disables the write. */
  readOnly: boolean;
  onBack: () => void;
  onInstalled: (id: string) => void;
}) {
  const [settings, setSettings] = useState<Record<string, unknown>>(() => defaultSettings(manifest));
  const [showOnToday, setShowOnToday] = useState(manifest.today?.default_on ?? false);
  const prompts = (manifest.hooks ?? []).flatMap((h) => ('ask' in h ? [h.ask] : []));
  const reports = (manifest.hooks ?? []).filter((h) => !('ask' in h)).length;
  const [issues, setIssues] = useState<PluginIssue[]>([]);
  const [busy, setBusy] = useState(false);


  return (
    <>
      <Header title="Install app" onBack={onBack} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PluginIcon icon={manifest.icon} name={manifest.name} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{manifest.name} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-faint)' }}>v{manifest.version}</span></div>
          {manifest.author ? <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>by {manifest.author}</div> : null}
          {manifest.description ? <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>{manifest.description}</div> : null}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
        <div style={sectionTitle}>What it adds</div>
        <div>• {manifest.views.length === 1 ? 'A screen' : `${manifest.views.length} screens`} in Apps</div>
        {manifest.today ? <div>• A widget for Today: “{manifest.today.widget.label}”</div> : null}
        {prompts.map((q) => <div key={q}>• Asks: “{q}”</div>)}
        {reports > 0 ? <div>• Adds a line to your reports</div> : null}
        <div>• Stores: {manifest.collections.map((c) => c.key.replace(/_/g, ' ')).join(', ')} — only in this browser{' '}(and your account, with sync)</div>
        <div style={{ color: 'var(--color-text-faint)', marginTop: 4 }}>Apps only see their own data. They can't read your tasks or run code.</div>
      </div>

      {(manifest.settings?.length ?? 0) > 0 ? (
        <div>
          <div style={{ ...sectionTitle, marginBottom: 8 }}>Settings</div>
          <SettingsFields manifest={manifest} values={settings} onChange={(k, v) => setSettings((s) => ({ ...s, [k]: v }))} />
        </div>
      ) : null}

      {manifest.today ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text)' }}>
          <input type="checkbox" checked={showOnToday} onChange={(e) => setShowOnToday(e.target.checked)} />
          Show on Today
        </label>
      ) : null}

      {issues.length > 0 ? <IssueList issues={issues} /> : null}
      <button
        type="button" disabled={busy || readOnly}
        onClick={async () => {
          setBusy(true);
          const r = await installPlugin(text, timezone, { settings, showOnToday, source });
          setBusy(false);
          if (r.ok) onInstalled(r.plugin.id);
          else setIssues(r.issues);
        }}
        style={{ ...btn('primary'), opacity: readOnly ? 0.5 : 1 }}
      >
        Install
      </button>
    </>
  );
}

function RestorePreview({ text, backup, readOnly, onBack, onInstalled }: {
  text: string;
  backup: PluginExport;
  readOnly: boolean;
  onBack: () => void;
  onInstalled: (id: string) => void;
}) {
  const [issues, setIssues] = useState<PluginIssue[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const m = backup.plugin.manifest;
  // Restoring over the same install replaces its data with the file's; say so first.
  const live = useLiveQuery(async () => {
    const p = await db.plugins.get(backup.plugin.id);
    if (!p || p.deletedAt) return null;
    const n = await db.pluginRecords.where('pluginId').equals(p.id).filter((r) => !r.deletedAt).count();
    return { name: p.manifest.name, entries: n };
  }, [backup.plugin.id]);
  const needsConfirm = live != null && !confirmed;
  return (
    <>
      <Header title="Restore app" onBack={onBack} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <PluginIcon icon={m.icon} name={m.name} size={40} />
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{m.name} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-faint)' }}>v{m.version}</span></div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {backup.records.length} {backup.records.length === 1 ? 'entry' : 'entries'} · exported {formatStat(backup.exported_at, 'date', new Date().toISOString())}
          </div>
        </div>
      </div>
      {live ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, lineHeight: 1.5, color: 'var(--color-text)', padding: '8px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)' }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>
            {live.name} is installed with {live.entries} {live.entries === 1 ? 'entry' : 'entries'}. Restoring replaces them with this file&apos;s;
            entries added since the export are removed.
          </span>
        </label>
      ) : null}
      {issues.length > 0 ? <IssueList issues={issues} /> : null}
      <button
        type="button"
        disabled={readOnly || needsConfirm || live === undefined}
        onClick={async () => {
          const r = await importPlugin(text);
          if (r.ok) onInstalled(r.plugin.id);
          else setIssues(r.issues);
        }}
        style={{ ...btn('primary'), opacity: readOnly || needsConfirm ? 0.5 : 1 }}
      >
        {live ? 'Replace data' : 'Restore'}
      </button>
    </>
  );
}

// ─── An app ──────────────────────────────────────────────────────────────────

/**
 * The active page's preview image (og:image, else twitter:image), for
 * `$tab.image`. Read from the tab's DOM, only when the app's file uses it;
 * https only, as covers render from it.
 */
function useTabImage(url: string, manifest: PluginRow['manifest']): string | undefined {
  const [image, setImage] = useState<string | undefined>();
  const wanted = useMemo(() => JSON.stringify(manifest).includes('$tab.image'), [manifest]);
  useEffect(() => {
    setImage(undefined);
    if (!wanted || !/^https?:\/\//i.test(url)) return;
    let live = true;
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([t]) =>
        t?.id === undefined
          ? undefined
          : chrome.scripting.executeScript({
              target: { tabId: t.id },
              func: () => {
                const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content;
                const raw = meta('meta[property="og:image"]') ?? meta('meta[name="og:image"]') ?? meta('meta[name="twitter:image"]') ?? meta('meta[property="twitter:image"]');
                try {
                  return raw ? new URL(raw, location.href).href : null;
                } catch {
                  return null;
                }
              },
            }),
      )
      .then((res) => {
        const v = res?.[0]?.result;
        if (live && typeof v === 'string' && /^https:\/\//i.test(v)) setImage(v);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url, wanted]);
  return image;
}

function AppScreen({ plugin, timezone, weekStart, tab, readOnly, onBack, onSettings }: {
  plugin: PluginRow;
  timezone: string;
  weekStart: number;
  tab: { url: string; title: string };
  readOnly: boolean;
  onBack: () => void;
  onSettings: () => void;
}) {
  const [viewId, setViewId] = useState(plugin.manifest.views[0]!.id);
  const image = useTabImage(tab.url, plugin.manifest);
  // `$tab` is only a web page: never chrome:// or the extension's own pages.
  const webTab = useMemo(() => (/^https?:\/\//i.test(tab.url) ? { ...tab, ...(image ? { image } : {}) } : undefined), [tab, image]);
  const { evaluator } = usePluginData(plugin, timezone, weekStart, webTab);
  const view = plugin.manifest.views.find((v) => v.id === viewId) ?? plugin.manifest.views[0]!;

  const actions: PluginActions = useMemo(() => {
    const env = { timezone, weekStart };
    return {
      // Writes return their promise so a form can reset once the record is stored.
      add: (c, data, opts) => addRecord(plugin, c, data, env, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      setDay: (c, day, data) => setDaily(plugin, c, day, data, env),
      update: (r: PluginRecord, data, opts) => updateRecord(plugin, r.id, data, env, opts?.occurredAt ? { occurredAt: opts.occurredAt } : {}),
      remove: (r: PluginRecord) => deleteRecord(r.id),
      openUrl: (url) => {
        if (/^https?:\/\//i.test(url)) void chrome.tabs.create({ url });
      },
    };
  }, [plugin, timezone, weekStart]);

  return (
    <>
      <Header
        title={<><PluginIcon icon={plugin.manifest.icon} name={plugin.manifest.name} size={22} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plugin.manifest.name}</span></>}
        onBack={onBack}
        right={<button type="button" aria-label="App settings" onClick={onSettings} style={{ ...btn('ghost'), padding: '2px 6px' }}><GearIcon /></button>}
      />
      {plugin.manifest.views.length > 1 ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {plugin.manifest.views.map((v, i) => {
            const on = v.id === view.id;
            return (
              <button
                key={v.id} type="button" onClick={() => setViewId(v.id)}
                style={{ padding: '3px 10px', fontSize: 11, fontWeight: on ? 600 : 400, fontFamily: 'inherit', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`, background: on ? 'var(--color-accent-soft)' : 'transparent', color: on ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              >
                {v.label ?? (i === 0 ? plugin.manifest.name : v.id)}
              </button>
            );
          })}
        </div>
      ) : null}
      {evaluator ? (
        <PluginView
          key={view.id}
          view={view}
          env={{
            manifest: plugin.manifest,
            settings: plugin.settings,
            evaluator,
            today: localDate(timezone),
            now: new Date().toISOString(),
            timeZone: timezone,
            weekStart,
            readOnly,
            actions,
          } satisfies PluginEnv}
        />
      ) : null}
    </>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────────

function AppSettings({ plugin, update, gone, readOnly, onBack }: { plugin: PluginRow; update: AvailableUpdate | undefined; gone: boolean; readOnly: boolean; onBack: () => void }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const m = plugin.manifest;
  // One key at a time, merged over the stored settings: two quick changes can't undo each other.
  const save = (key: string, value: unknown) => void updatePluginSetting(plugin.id, key, value);
  const exportIt = async () => downloadText(await exportPlugin(plugin.id), `${m.id}-${new Date().toISOString().slice(0, 10)}.pomodoso.yaml`);

  return (
    <>
      <Header title={`${m.name} settings`} onBack={onBack} />
      {/* An available update comes first: the Update badge leads here. */}
      {plugin.source === 'directory' && !gone && update ? <Updates plugin={plugin} update={update} readOnly={readOnly} /> : null}
      <SettingsFields manifest={m} values={plugin.settings} disabled={readOnly} onChange={save} />
      <EditableOptions manifest={m} values={plugin.settings} disabled={readOnly} onChange={save} />
      {plugin.source === 'directory' && gone ? (
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--color-text-muted)', padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
          This app is no longer in the directory. It keeps working here with all your entries, but won't get updates.
        </div>
      ) : plugin.source === 'directory' && !update ? (
        <Updates plugin={plugin} update={update} readOnly={readOnly} />
      ) : null}
      {m.today ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text)' }}>
          <input type="checkbox" disabled={readOnly} checked={plugin.settings[SHOW_ON_TODAY_KEY] === true} onChange={(e) => save(SHOW_ON_TODAY_KEY, e.target.checked)} />
          Show on Today
        </label>
      ) : null}

      <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={sectionTitle}>Data</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Export saves this app with all its data in one file. Restore it from Apps → Add an app, here or on another device.
        </div>
        <button type="button" onClick={() => void exportIt()} style={btn('secondary')}>Export app and data</button>
        {confirmUninstall && !readOnly ? (
          <div style={{ padding: '8px 10px', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-md)', fontSize: 11, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            Uninstall {m.name}? Its data is deleted too. Export first if you want to keep it.
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setConfirmUninstall(false)} style={btn('ghost')}>Cancel</button>
              <button type="button" onClick={() => void exportIt()} style={btn('secondary')}>Export</button>
              <button type="button" onClick={() => void uninstallPlugin(plugin.id)} style={btn('primary')}>Uninstall</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={readOnly} onClick={() => setConfirmUninstall(true)} style={{ ...btn('danger'), opacity: readOnly ? 0.5 : 1 }}>Uninstall</button>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-faint)', textAlign: 'center' }}>
        {m.id} · v{m.version}{m.author ? ` · ${m.author}` : ''}{m.license ? ` · ${m.license}` : ''}
      </div>
    </>
  );
}

/**
 * A directory app's updates: the version available and what it changes,
 * the button to apply it, and whether small updates apply on their own.
 * A breaking update spells out what happens to the user's data first.
 */
function Updates({ plugin, update, readOnly }: { plugin: PluginRow; update: AvailableUpdate | undefined; readOnly: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const breaking = update?.report.kind === 'breaking';
  const blocked = (update?.report.issues.length ?? 0) > 0;
  return (
    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={sectionTitle}>Updates</div>
      {update ? (
        <div style={{ fontSize: 11, color: 'var(--color-text)', lineHeight: 1.5, padding: '8px 10px', border: `1px solid ${breaking ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <b>Version {update.next.version}</b> is available (you have {plugin.manifest.version}).
          </div>
          <UpdateDetails update={update} />
          {error ? <div style={{ color: 'var(--color-accent)' }}>{error}</div> : null}
          {!blocked ? (
            <button
              type="button" disabled={readOnly || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await applyPluginUpdate(plugin.id, update.next);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              style={{ ...btn('primary'), alignSelf: 'flex-start', opacity: readOnly ? 0.5 : 1 }}
            >
              {breaking ? 'Update and convert my entries' : 'Update'}
            </button>
          ) : null}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>You have the latest version ({plugin.manifest.version}).</div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text)' }}>
        <input type="checkbox" disabled={readOnly} checked={plugin.autoUpdate} onChange={(e) => void setAutoUpdate(plugin.id, e.target.checked)} />
        Update automatically (small changes only)
      </label>
    </div>
  );
}

/** What an update does: why it's skipped, how it converts entries, or what changes. */
function UpdateDetails({ update }: { update: AvailableUpdate }) {
  if (update.report.issues.length > 0) return <div style={{ color: 'var(--color-accent)' }}>This version can't be applied to your data, so it's skipped.</div>;
  if (update.report.kind === 'breaking') {
    const steps = update.report.migrates ? update.next.migrate?.steps ?? [] : [];
    return (
      <>
        <div>It changes how your entries are stored:</div>
        {steps.map((s, i) => <div key={i}>• {describeStep(s)}</div>)}
      </>
    );
  }
  return <>{update.report.changes.slice(0, 5).map((c, i) => <div key={i} style={{ color: 'var(--color-text-muted)' }}>• {c.message}</div>)}</>;
}

// ─── Updates ─────────────────────────────────────────────────────────────────

/**
 * Every available update in one place: each with what it does and its own
 * button, or all at once. A version that converts entries says how right
 * where it's listed, so "Update all" never converts anything unseen.
 */
function UpdatesScreen({ plugins, updates, readOnly, onBack, onOpen }: {
  plugins: PluginRow[];
  updates: Map<string, AvailableUpdate>;
  readOnly: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const pending = plugins.flatMap((p) => {
    const u = updates.get(p.id);
    return u && isSupported(p) ? [{ plugin: p, update: u }] : [];
  });
  const applicable = pending.filter((x) => x.update.report.issues.length === 0);
  const converts = applicable.filter((x) => x.update.report.kind === 'breaking').length;

  const apply = async (items: typeof pending) => {
    setBusy((b) => new Set([...b, ...items.map((x) => x.plugin.id)]));
    // One at a time: each update is its own transaction over its own records.
    for (const { plugin, update } of items) {
      try {
        await applyPluginUpdate(plugin.id, update.next);
        setErrors((e) => { const n = new Map(e); n.delete(plugin.id); return n; });
      } catch (err) {
        setErrors((e) => new Map(e).set(plugin.id, (err as Error).message));
      }
      setBusy((b) => { const n = new Set(b); n.delete(plugin.id); return n; });
    }
  };

  return (
    <>
      <Header title="Updates" onBack={onBack} />
      {pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>All up to date</div>
          Your apps from the directory have their latest version.
        </div>
      ) : (
        <>
          {applicable.length > 1 ? (
            <button type="button" disabled={readOnly || busy.size > 0} onClick={() => void apply(applicable)} style={{ ...btn('primary'), opacity: readOnly ? 0.5 : 1 }}>
              {busy.size > 0 ? 'Updating…' : `Update all (${applicable.length})${converts > 0 ? ' and convert entries' : ''}`}
            </button>
          ) : null}
          {pending.map(({ plugin, update }) => {
            const blocked = update.report.issues.length > 0;
            const breaking = update.report.kind === 'breaking';
            const error = errors.get(plugin.id);
            return (
              <div key={plugin.id} style={{ fontSize: 11, color: 'var(--color-text)', lineHeight: 1.5, padding: '8px 10px', background: 'var(--color-surface)', border: `1px solid ${breaking ? 'var(--color-accent)' : 'var(--color-border)'}`, borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PluginIcon icon={update.next.icon} name={update.next.name} size={24} />
                  <button type="button" onClick={() => onOpen(plugin.id)} style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{update.next.name}</span>
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-faint)' }}>{plugin.manifest.version} → {update.next.version}</span>
                  </button>
                  {!blocked ? (
                    <button type="button" disabled={readOnly || busy.has(plugin.id)} onClick={() => void apply([{ plugin, update }])} style={{ ...btn(breaking ? 'primary' : 'secondary'), flexShrink: 0, opacity: readOnly ? 0.5 : 1 }}>
                      {busy.has(plugin.id) ? 'Updating…' : breaking ? 'Update and convert' : 'Update'}
                    </button>
                  ) : null}
                </div>
                <UpdateDetails update={update} />
                {error ? <div style={{ color: 'var(--color-accent)' }}>{error}</div> : null}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </svg>
  );
}
