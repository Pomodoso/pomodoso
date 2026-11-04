import { useMemo, useState } from 'react';
import { cascadeIds, createEvaluator, humanize, initialRecordData, localDayOf, normalizeOption, recordTitle, reportLines, type PluginManifest, type PluginRecord } from '@pomodoso/types/plugins';
import { PluginView, TodayWidget, type PluginEnv, type PluginTasks } from '@pomodoso/ui/plugins';

// An app's screen and Today widget, rendered from its file with the same
// components as the extension, on data that lives only in this page: try the
// buttons and forms, nothing is saved anywhere.

function defaultSettings(manifest: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings ?? []) {
    if (s.default !== undefined) out[s.key] = s.default;
    else if (s.type === 'select' && s.options?.[0] !== undefined) out[s.key] = normalizeOption(s.options[0]).value;
  }
  return out;
}

/** `data` over `base`; a null clears a field, as the extension's writes do. */
function merged(base: Record<string, unknown>, data: Record<string, unknown>) {
  const out = { ...base };
  for (const [k, v] of Object.entries(data)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** `initialRecords` seeds the preview (the docs' sample data); edits stay local. */
/** Sample tasks for `task` fields: the preview has no task list of its own. */
const SAMPLE_TASKS = [
  { value: 'sample-task-1', label: 'Publish the app' },
  { value: 'sample-task-2', label: 'Write the release notes' },
];
const sampleTasks: PluginTasks = { list: () => SAMPLE_TASKS, title: (id) => SAMPLE_TASKS.find((t) => t.value === id)?.label };

export function LivePreview({ manifest, initialRecords = [] }: { manifest: PluginManifest; initialRecords?: PluginRecord[] }) {
  const [records, setRecords] = useState<PluginRecord[]>(initialRecords);
  const [viewId, setViewId] = useState(manifest.views[0]!.id);
  // A record's screen (a view with `of`), opened from a list or board.
  const [opened, setOpened] = useState<{ view: string; record: string } | null>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const now = new Date().toISOString();
  const today = localDayOf(now, timeZone);
  const settings = useMemo(() => defaultSettings(manifest), [manifest]);
  const evaluator = useMemo(
    () => createEvaluator(manifest, { today, now, timeZone, weekStart: 0, installedOn: today, settings, records }),
    // `now` moves every render; the records are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifest, records, today, timeZone, settings],
  );

  const collection = (key: string) => manifest.collections.find((c) => c.key === key);
  const add = (key: string, data: Record<string, unknown>, opts?: { occurredAt?: string | undefined }) => {
    const c = collection(key);
    if (!c) return;
    const at = new Date().toISOString();
    setRecords((rs) => [...rs, { id: crypto.randomUUID(), collection: key, occurred_at: c.kind === 'event' ? opts?.occurredAt ?? at : null, created_at: at, updated_at: at, data: merged(initialRecordData(c), data) }]);
  };
  // A record takes what belongs to it (records whose `ref` points at it).
  const remove = (rec: PluginRecord) =>
    setRecords((rs) => {
      const gone = new Set(cascadeIds(manifest, rs, rec.id));
      return rs.filter((r) => !gone.has(r.id));
    });
  const setDay = (key: string, day: string, data: Record<string, unknown>) => {
    const at = new Date().toISOString();
    setRecords((rs) => {
      const prev = rs.find((r) => r.collection === key && r.day === day);
      if (prev) return rs.map((r) => (r === prev ? { ...r, updated_at: at, data: merged(r.data, data) } : r));
      const c = collection(key);
      return [...rs, { id: crypto.randomUUID(), collection: key, day, created_at: at, updated_at: at, data: merged(c ? initialRecordData(c) : {}, data) }];
    });
  };

  const env: PluginEnv = {
    manifest,
    settings,
    evaluator,
    today,
    now,
    timeZone,
    weekStart: 0,
    readOnly: false,
    actions: {
      add,
      setDay,
      update: (rec, data, opts) => setRecords((rs) => rs.map((r) => (r.id === rec.id ? { ...r, ...(r.occurred_at && opts?.occurredAt ? { occurred_at: opts.occurredAt } : {}), updated_at: new Date().toISOString(), data: merged(r.data, data) } : r))),
      remove,
      openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    },
  };
  const tabs = manifest.views.filter((v) => v.of === undefined);
  const recordView = opened ? manifest.views.find((v) => v.id === opened.view) : undefined;
  const record = opened ? records.find((r) => r.id === opened.record) : undefined;
  const inRecord = recordView !== undefined && record !== undefined;
  const view = inRecord ? recordView : tabs.find((v) => v.id === viewId) ?? tabs[0]!;
  // A wide screen (a kanban) takes the whole preview, as it takes a whole tab in the extension.
  const wide = view.layout === 'wide';
  const asks = (manifest.hooks ?? []).flatMap((h) => ('ask' in h ? [h] : []));
  const reports = (['daily_report', 'weekly_report'] as const).flatMap((on) => reportLines(manifest, on, evaluator, now).map((line) => ({ on, line })));

  return (
    <div style={{ background: '#F4F2EC', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
      <div style={{ width: wide ? '100%' : 340, maxWidth: '100%', background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '12px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{wide ? 'In its own tab' : 'In Apps'}</div>
        {inRecord ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" onClick={() => setOpened(null)} aria-label="Back" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--color-text-muted)', padding: 0 }}>‹</button>
            <span style={{ fontWeight: 600 }}>{recordTitle(manifest, record)}</span>
          </div>
        ) : tabs.length > 1 ? (
          <div role="tablist" aria-label="Screens" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tabs.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={v.id === view.id}
                onClick={() => setViewId(v.id)}
                style={{ padding: '3px 10px', fontSize: 11, fontFamily: 'inherit', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: `1px solid ${v.id === view.id ? 'var(--color-accent)' : 'var(--color-border)'}`, background: v.id === view.id ? 'var(--color-accent-soft)' : 'transparent', color: v.id === view.id ? 'var(--color-accent)' : 'var(--color-text-muted)', fontWeight: v.id === view.id ? 600 : 400 }}
              >
                {v.label ?? humanize(v.id)}
              </button>
            ))}
          </div>
        ) : null}
        <PluginView key={`${view.id}:${record?.id ?? ''}`} env={{ ...env, wide, openRecord: (v, r) => setOpened({ view: v, record: r }), tasks: sampleTasks }} view={view} record={inRecord ? record.id : undefined} />
      </div>

      {manifest.today || asks.length > 0 || reports.length > 0 ? (
        <div style={{ width: 240, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {manifest.today ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>On Today</div>
              <TodayWidget manifest={manifest} settings={settings} evaluator={evaluator} today={today} now={now} timeZone={timeZone} weekStart={0} readOnly={false} add={add} remove={remove} update={env.actions.update} setDay={setDay} onOpen={() => { setOpened(null); setViewId(tabs[0]!.id); }} />
            </div>
          ) : null}
          {asks.map((h, i) => (
            <div key={i} style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-accent)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: '#A8432D' }}>{h.on === 'day_end' ? 'THE NEXT DAY' : 'DURING A BREAK'}</span>
              <span style={{ fontWeight: 600 }}>{h.ask}</span>
            </div>
          ))}
          {reports.map((r, i) => (
            <div key={`r${i}`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)' }}>{r.on === 'daily_report' ? 'IN THE DAILY REPORT' : 'IN THE WEEKLY REPORT'}</span>
              <span>{r.line}</span>
            </div>
          ))}
        </div>
      ) : null}
      <span style={{ flexBasis: '100%', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)' }}>Live preview, rendered from the app's file. Try it: nothing is saved.</span>
    </div>
  );
}
