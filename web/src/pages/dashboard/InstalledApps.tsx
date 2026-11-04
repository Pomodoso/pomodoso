import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SHOW_ON_TODAY_KEY, humanize, localDayOf, recordTitle } from '@pomodoso/types/plugins';
import { PluginIcon, PluginView, TodayWidget, type PluginEnv } from '@pomodoso/ui/plugins';
import { useAuth } from '../../lib/AuthContext.tsx';
import { evaluatorFor, useInstalledApps, type InstalledApp } from '../../lib/installedApps.ts';

// The apps installed in the user's extension, as synced: their screens in
// Dashboard → Apps (?open=<id> opens one), their Today widgets on Today.
// Writing needs sync (it goes through /sync/push); without it there's
// nothing on the server to show.

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function envFor(app: InstalledApp, readOnly: boolean, actions: PluginEnv['actions']): PluginEnv {
  const now = new Date().toISOString();
  return { manifest: app.manifest, settings: app.settings, evaluator: evaluatorFor(app), today: localDayOf(now, tz()), now, timeZone: tz(), weekStart: 0, readOnly, actions };
}

function AppScreen({ app, readOnly, actions, onBack }: { app: InstalledApp; readOnly: boolean; actions: PluginEnv['actions']; onBack: () => void }) {
  const [viewId, setViewId] = useState(app.manifest.views[0]!.id);
  // A record's screen (a view with `of`), opened from a list or board.
  const [opened, setOpened] = useState<{ view: string; record: string } | null>(null);
  const tabs = app.manifest.views.filter((v) => v.of === undefined);
  const recordView = opened ? app.manifest.views.find((v) => v.id === opened.view) : undefined;
  const record = opened ? app.records.find((r) => r.id === opened.record) : undefined;
  const inRecord = recordView !== undefined && record !== undefined;
  const view = inRecord ? recordView : tabs.find((v) => v.id === viewId) ?? tabs[0]!;
  const wide = view.layout === 'wide';
  const env = { ...envFor(app, readOnly, actions), wide, openRecord: (v: string, r: string) => setOpened({ view: v, record: r }) };
  return (
    <div className="pomo-card pomo-plugin-scope" style={{ maxWidth: wide ? 'none' : 720, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="pomo-btn pomo-btn-icon" aria-label={inRecord ? 'Back' : 'Back to your apps'} onClick={inRecord ? () => setOpened(null) : onBack}><i className="ti ti-chevron-left" /></button>
        <PluginIcon icon={app.manifest.icon} name={app.manifest.name} size={28} />
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{app.manifest.name}{inRecord ? <span style={{ color: 'var(--text-sec)' }}> › {recordTitle(app.manifest, record)}</span> : null}</div>
      </div>
      {!inRecord && tabs.length > 1 ? (
        <div role="tablist" aria-label="Screens" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === view.id}
              className="pomo-btn"
              style={{ fontSize: 12, padding: '3px 10px', ...(v.id === view.id ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : {}) }}
              onClick={() => setViewId(v.id)}
            >
              {v.label ?? humanize(v.id)}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ maxWidth: wide ? 'none' : 420 }}>
        <PluginView key={`${view.id}:${record?.id ?? ''}`} env={env} view={view} record={inRecord ? record.id : undefined} />
      </div>
    </div>
  );
}

/** Dashboard → Apps: the apps installed in the extension. */
export function InstalledApps() {
  const { entitlements } = useAuth();
  const canWrite = entitlements.features.sync;
  const { apps, error, writeError, actionsFor } = useInstalledApps(canWrite);
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const open = apps?.find((a) => a.id === openId);
  const setOpen = (id: string | null) => setParams(id ? { open: id } : {}, { replace: true });

  if (open) {
    return (
      <>
        {writeError ? <p style={{ color: 'var(--accent)', fontSize: 13 }}>{writeError}</p> : null}
        <AppScreen app={open} readOnly={!canWrite} actions={actionsFor(open)} onBack={() => setOpen(null)} />
      </>
    );
  }

  return (
    <div className="pomo-card" style={{ maxWidth: 720, marginBottom: 16 }}>
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-apps" /> Installed</div>
        {apps && apps.length > 0 ? <div className="pomo-card-meta">{apps.length} in your extension</div> : null}
      </div>
      {error ? (
        <p style={{ color: 'var(--accent)', fontSize: 13 }}>{error}</p>
      ) : apps === null ? (
        <div style={{ color: 'var(--text-tert)', fontSize: 13, padding: '8px 0' }}>Loading…</div>
      ) : apps.length === 0 ? (
        <div className="pomo-empty">
          <i className="ti ti-apps" />
          {canWrite ? (
            <>No apps installed yet. <Link to="/apps">Browse the directory</Link> and install one in the extension.</>
          ) : (
            <>Your apps live in the Pomodoso extension. With sync (Pro) they show up here too. <Link to="/pricing">See Pro</Link></>
          )}
        </div>
      ) : (
        apps.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpen(a.id)}
            className="pomo-plugin-scope"
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', border: 0, borderBottom: '1px solid var(--border)', background: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
          >
            <PluginIcon icon={a.manifest.icon} name={a.manifest.name} size={28} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>
                {a.manifest.name}
                {a.settings[SHOW_ON_TODAY_KEY] === true && a.manifest.today ? <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--text-tert)' }}> · On Today</span> : null}
              </span>
              {a.manifest.description ? <span style={{ display: 'block', fontSize: 12, color: 'var(--text-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.manifest.description}</span> : null}
            </span>
            <i className="ti ti-chevron-right" style={{ color: 'var(--text-tert)' }} />
          </button>
        ))
      )}
    </div>
  );
}

/** Today: the Today widgets of the apps the user turned on there. */
export default function TodayAppsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const { entitlements } = useAuth();
  const canWrite = entitlements.features.sync;
  const { apps, writeError, actionsFor } = useInstalledApps(canWrite);
  const shown = useMemo(() => (apps ?? []).filter((a) => a.manifest.today && a.settings[SHOW_ON_TODAY_KEY] === true), [apps]);
  if (shown.length === 0) return null;
  return (
    <div className="pomo-card pomo-plugin-scope">
      <div className="pomo-card-header">
        <div className="pomo-card-title"><i className="ti ti-apps" /> Apps</div>
      </div>
      {writeError ? <p style={{ color: 'var(--accent)', fontSize: 12 }}>{writeError}</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {shown.map((a) => {
          const actions = actionsFor(a);
          const now = new Date().toISOString();
          return (
            <TodayWidget
              key={a.id}
              manifest={a.manifest}
              settings={a.settings}
              evaluator={evaluatorFor(a)}
              today={localDayOf(now, tz())}
              now={now}
              timeZone={tz()}
              weekStart={0}
              readOnly={!canWrite}
              add={actions.add}
              remove={actions.remove}
              update={actions.update}
              setDay={actions.setDay}
              onOpen={() => onOpen(a.id)}
              open={() => onOpen(a.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
