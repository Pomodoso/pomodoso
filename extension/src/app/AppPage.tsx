import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { recordTitle } from '@pomodoso/types/plugins';
import { PluginIcon, PluginView, type PluginEnv } from '@pomodoso/ui/plugins';

import { db, localDate, type PluginRow } from '../db';
import { toEngineRecord } from '../pluginRows';
import { pluginActions, usePluginTasks } from '../popup/apps/appEnv';
import { isSupported } from '../popup/apps/supported';
import { usePluginData } from '../popup/apps/usePluginData';
import { useAuth } from '../popup/useAuth';

// One app, full page: its main screen, or a record's screen (an issue's
// board). Opening another record from here stays in this tab, in the
// browser's history, so Back works.

interface Place {
  view?: string | undefined;
  record?: string | undefined;
}

function readPlace(): Place & { plugin: string | null } {
  const q = new URLSearchParams(location.search);
  return { plugin: q.get('plugin'), view: q.get('view') ?? undefined, record: q.get('record') ?? undefined };
}

function useSetting<T>(key: string, fallback: T): T {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return (row?.value as T | undefined) ?? fallback;
}

export function AppPage(): React.JSX.Element {
  const [place, setPlace] = useState(readPlace);
  useEffect(() => {
    const onPop = () => setPlace(readPlace());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const plugin = useLiveQuery(async () => (place.plugin ? (await db.plugins.get(place.plugin)) ?? null : null), [place.plugin]);

  if (plugin === undefined) return <></>;
  if (!plugin || plugin.deletedAt || !isSupported(plugin)) {
    return <Message>This app isn't installed here, or needs a newer version of Pomodoso.</Message>;
  }
  const go = (next: Place) => {
    const q = new URLSearchParams({ plugin: plugin.id });
    if (next.view) q.set('view', next.view);
    if (next.record) q.set('record', next.record);
    history.pushState(null, '', `?${q.toString()}`);
    setPlace({ plugin: plugin.id, ...next });
  };
  return <Screen plugin={plugin} place={place} go={go} />;
}

function Screen({ plugin, place, go }: { plugin: PluginRow; place: Place; go: (p: Place) => void }) {
  const m = plugin.manifest;
  const timezone = useSetting('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const weekStart = useSetting('week_start', 0);
  const auth = useAuth();
  const { records, evaluator } = usePluginData(plugin, timezone, weekStart);
  const tasks = usePluginTasks();
  const actions = useMemo(() => pluginActions(plugin, timezone, weekStart), [plugin, timezone, weekStart]);

  const tabs = m.views.filter((v) => v.of === undefined);
  const asked = m.views.find((v) => v.id === place.view);
  const record = place.record ? records?.find((r) => r.id === place.record) : undefined;
  // A record's screen needs its record; without it (deleted), the main screen.
  const view = asked && (asked.of === undefined || record) ? asked : tabs[0]!;
  const title = view.of !== undefined && record ? recordTitle(m, toEngineRecord(record)) : null;
  useEffect(() => {
    document.title = title ? `${title} · ${m.name}` : `${m.name} · Pomodoso`;
  }, [title, m.name]);
  const wide = view.layout === 'wide';

  if (!records || !evaluator) return <></>;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-text)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <PluginIcon icon={m.icon} name={m.name} size={26} />
        <button type="button" onClick={() => go({})} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, fontWeight: 600, color: title ? 'var(--color-text-muted)' : 'var(--color-text)' }}>
          {m.name}
        </button>
        {title ? (
          <>
            <span style={{ color: 'var(--color-text-faint)' }}>›</span>
            <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          </>
        ) : null}
        {!title && tabs.length > 1 ? (
          <nav style={{ display: 'flex', gap: 6, marginLeft: 16 }}>
            {tabs.map((v, i) => (
              <button
                key={v.id} type="button" onClick={() => go({ view: v.id })}
                style={{ padding: '4px 12px', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 'var(--radius-sm)', border: `1px solid ${v.id === view.id ? 'var(--color-accent)' : 'var(--color-border)'}`, background: v.id === view.id ? 'var(--color-accent-soft)' : 'transparent', color: v.id === view.id ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: v.id === view.id ? 600 : 400 }}
              >
                {v.label ?? (i === 0 ? m.name : v.id)}
              </button>
            ))}
          </nav>
        ) : null}
        {!auth.loading && !auth.session ? <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-text-muted)' }}>Signed out: read only. Sign in from the Pomodoso popup.</span> : null}
      </header>
      <main style={{ padding: 24, maxWidth: wide ? 'none' : 520, margin: '0 auto' }}>
        <PluginView
          key={`${view.id}:${record?.id ?? ''}`}
          view={view}
          record={view.of !== undefined ? record?.id : undefined}
          env={{
            manifest: m,
            settings: plugin.settings,
            evaluator,
            today: localDate(timezone),
            now: new Date().toISOString(),
            timeZone: timezone,
            weekStart,
            readOnly: !auth.session,
            actions,
            openRecord: (v, r) => go({ view: v, record: r }),
            wide,
            tasks,
          } satisfies PluginEnv}
        />
      </main>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 48, textAlign: 'center', fontSize: 14, color: 'var(--color-text-muted)' }}>{children}</div>;
}
