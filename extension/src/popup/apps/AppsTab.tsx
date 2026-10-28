import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  formatStat,
  parsePluginExport,
  parsePluginFile,
  SHOW_ON_TODAY_KEY,
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
  setDaily,
  uninstallPlugin,
  updatePluginSetting,
  updateRecord,
} from '../../plugins';
import { defaultSettings, EditableOptions, SettingsFields } from './SettingsFields';
import { isSupported } from './supported';
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
}

type Screen = { kind: 'list' } | { kind: 'add' } | { kind: 'app'; id: string } | { kind: 'settings'; id: string };

export function AppsTab({ timezone, weekStart, isSignedIn, tab, onSignIn, openApp }: AppsTabProps) {
  const [screen, setScreen] = useState<Screen>(openApp ? { kind: 'app', id: openApp.id } : { kind: 'list' });
  useEffect(() => {
    if (openApp) setScreen({ kind: 'app', id: openApp.id });
  }, [openApp?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const plugins = useLiveQuery(async () => (await db.plugins.toArray()).filter((p) => !p.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), []);
  const readOnly = !isSignedIn;

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

  if (!plugins) return null;

  return (
    <div style={{ padding: '10px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {readOnly ? <SignedOutBanner onSignIn={onSignIn} /> : null}
      {screen.kind === 'add' ? (
        <AddApp
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
        <AppSettings plugin={current} readOnly={readOnly} onBack={() => setScreen({ kind: 'app', id: current.id })} />
      ) : (
        <AppList plugins={plugins} timezone={timezone} weekStart={weekStart} readOnly={readOnly} onOpen={(id) => setScreen({ kind: 'app', id })} onAdd={() => setScreen({ kind: 'add' })} />
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

function AppList({ plugins, timezone, weekStart, readOnly, onOpen, onAdd }: {
  plugins: PluginRow[];
  timezone: string;
  weekStart: number;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      {plugins.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 12px 8px', color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>Apps</div>
          Small tools that live inside Pomodoso: a reading list, a quit-smoking tracker, a year in pixels… Each one is a single file you can install, share or write yourself.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plugins.map((p) => (isSupported(p)
            ? <AppRow key={p.id} plugin={p} timezone={timezone} weekStart={weekStart} onOpen={() => onOpen(p.id)} />
            : <UnsupportedRow key={p.id} plugin={p} />))}
        </div>
      )}
      <button type="button" disabled={readOnly} onClick={onAdd} style={{ ...btn('secondary'), opacity: readOnly ? 0.5 : 1 }}>+ Add an app</button>
    </>
  );
}

/** One installed app, with its Today value as a hint when it declares one. */
function AppRow({ plugin, timezone, weekStart, onOpen }: { plugin: PluginRow; timezone: string; weekStart: number; onOpen: () => void }) {
  const { evaluator } = usePluginData(plugin, timezone, weekStart);
  const w = plugin.manifest.today?.widget;
  const hint = evaluator && w && 'value' in w ? `${w.label}: ${formatStat(evaluator.value(w.value), w.type === 'stat' ? w.format : 'number', new Date().toISOString())}` : plugin.manifest.description;
  return (
    <button
      type="button" onClick={onOpen}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
    >
      <PluginIcon icon={plugin.manifest.icon} name={plugin.manifest.name} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{plugin.manifest.name}</span>
        {hint ? <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span> : null}
      </span>
      <span style={{ color: 'var(--color-text-faint)' }}>›</span>
    </button>
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

function AddApp({ timezone, readOnly, onCancel, onInstalled }: { timezone: string; readOnly: boolean; onCancel: () => void; onInstalled: (id: string) => void }) {
  const [text, setText] = useState('');
  const [manifest, setManifest] = useState<PluginManifest | null>(null);
  const [backup, setBackup] = useState<PluginExport | null>(null);
  const [issues, setIssues] = useState<PluginIssue[]>([]);

  const check = (source: string) => {
    setText(source);
    // An app's export (from its settings) restores the app with its data.
    if (/^pomodoso_plugin_export:/m.test(source)) {
      const r = parsePluginExport(source);
      setBackup(r.ok ? r.value : null);
      setIssues(r.ok ? [] : r.issues);
      return;
    }
    const r = parsePluginFile(source);
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
  if (manifest) {
    return <InstallPreview text={text} manifest={manifest} timezone={timezone} readOnly={readOnly} onBack={() => setManifest(null)} onInstalled={onInstalled} />;
  }

  return (
    <>
      <Header title="Add an app" onBack={onCancel} />
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

function InstallPreview({ text, manifest, timezone, readOnly, onBack, onInstalled }: {
  text: string;
  manifest: PluginManifest;
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
          const r = await installPlugin(text, timezone, { settings, showOnToday });
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
  // `$tab` is only a web page: never chrome:// or the extension's own pages.
  const webTab = /^https?:\/\//i.test(tab.url) ? tab : undefined;
  const { evaluator } = usePluginData(plugin, timezone, weekStart, webTab);
  const view = plugin.manifest.views.find((v) => v.id === viewId) ?? plugin.manifest.views[0]!;

  const actions: PluginActions = useMemo(() => {
    const env = { timezone, weekStart };
    return {
      // Writes return their promise so a form can reset once the record is stored.
      add: (c, data) => addRecord(plugin, c, data, env),
      setDay: (c, day, data) => setDaily(plugin, c, day, data, env),
      update: (r: PluginRecord, data) => updateRecord(plugin, r.id, data, env),
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

function AppSettings({ plugin, readOnly, onBack }: { plugin: PluginRow; readOnly: boolean; onBack: () => void }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const m = plugin.manifest;
  // One key at a time, merged over the stored settings: two quick changes can't undo each other.
  const save = (key: string, value: unknown) => void updatePluginSetting(plugin.id, key, value);
  const exportIt = async () => downloadText(await exportPlugin(plugin.id), `${m.id}-${new Date().toISOString().slice(0, 10)}.pomodoso.yaml`);

  return (
    <>
      <Header title={`${m.name} settings`} onBack={onBack} />
      <SettingsFields manifest={m} values={plugin.settings} disabled={readOnly} onChange={save} />
      <EditableOptions manifest={m} values={plugin.settings} disabled={readOnly} onChange={save} />
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

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
    </svg>
  );
}
