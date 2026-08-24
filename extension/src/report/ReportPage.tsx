import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, localDate } from '../db';
import { formatReport, type ReportFormat } from '../reportFormat.ts';
import { buildReport, formatDuration, rangeStartDate, type ReportRange } from '../reports.ts';

const RANGES: { value: ReportRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  // Not in spec 6.6, which predates it — added because the task and habit
  // history views already offer it and a report with fewer choices than the
  // views beside it reads as unfinished.
  { value: 'month', label: 'This month' },
];

const FORMATS: { value: ReportFormat; label: string }[] = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'slack', label: 'Slack' },
];

function useSetting<T>(key: string, fallback: T): T {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return (row?.value as T | undefined) ?? fallback;
}

export function ReportPage(): React.JSX.Element {
  const [range, setRange] = useState<ReportRange>('today');
  const [format, setFormat] = useState<ReportFormat>('markdown');
  const [copied, setCopied] = useState(false);

  const timezone = useSetting('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
  const weekStart = useSetting('week_start', 0);
  // localStorage, not the Dexie settings table — that's where the popup keeps
  // it (App.tsx's 'pom_active_ws'), and 'all' is a real sentinel value, not a
  // workspace id.
  const activeWsId = localStorage.getItem('pom_active_ws')?.replace(/^"|"$/g, '') ?? 'default';

  const tasks = useLiveQuery(() => db.tasks.filter(t => !t.deletedAt).toArray()) ?? [];
  const projects = useLiveQuery(() => db.projects.filter(p => !p.deletedAt).toArray()) ?? [];
  const meetings = useLiveQuery(() => db.meetings.filter(m => !m.deletedAt).toArray()) ?? [];

  const report = useMemo(() => {
    const to = localDate(timezone);
    const from = rangeStartDate(range, timezone, weekStart);
    // A report is per work context, like every other view — mixing two
    // workspaces' totals into one standup summary would be actively wrong.
    // Same predicate as App.tsx's inWs, including that rows predating
    // workspaces (null) belong to whatever is active rather than vanishing.
    const inWs = <T extends { workspaceId?: string | null }>(rows: T[]) =>
      rows.filter(r => activeWsId === 'all' || r.workspaceId === activeWsId || r.workspaceId == null);
    return buildReport({ tasks: inWs(tasks), projects, meetings: inWs(meetings), range, from, to });
  }, [tasks, projects, meetings, range, timezone, weekStart, activeWsId]);

  const text = useMemo(() => formatReport(report, format), [report, format]);

  // Reset on any change to what's being copied, so the confirmation can't
  // linger next to a payload it no longer describes.
  useEffect(() => setCopied(false), [text]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px 64px', color: 'var(--color-text)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Report</h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', margin: '0 0 20px' }}>
        {report.range === 'today' ? report.from : `${report.from} → ${report.to}`}
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {RANGES.map(r => (
          <button key={r.value} onClick={() => setRange(r.value)} style={chip(range === r.value)}>
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <Stat label="Pomos" value={String(report.pomos)} />
        <Stat label="Focus" value={formatDuration(report.focusSeconds)} />
        <Stat label="Tasks done" value={String(report.tasksCompleted)} />
        {report.meetingsCount > 0 && (
          <Stat label="Meetings" value={`${report.meetingsCount} · ${formatDuration(report.meetingSeconds)}`} />
        )}
      </div>

      {report.lines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>No time logged in this range.</p>
      ) : (
        <>
          {range !== 'today' && (
            <Section title="By project">
              {report.byProject.map(p => (
                <Row
                  key={p.projectId ?? 'none'}
                  left={
                    <>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 8,
                        background: p.color ?? 'var(--color-border)',
                      }} />
                      {p.name}
                    </>
                  }
                  right={`${formatDuration(p.focusSeconds)} · ${p.pomos} pomo${p.pomos === 1 ? '' : 's'}`}
                />
              ))}
            </Section>
          )}

          <Section title="Tickets">
            {report.lines.map(l => (
              <Row
                key={l.taskId}
                left={
                  <>
                    {l.ticketId && (
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-info)', marginRight: 8 }}>
                        {l.ticketId}
                      </span>
                    )}
                    {l.title}
                    <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-faint)' }}>{l.status}</span>
                  </>
                }
                right={`${formatDuration(l.focusSeconds)} · ${l.pomos} pomo${l.pomos === 1 ? '' : 's'}`}
              />
            ))}
          </Section>
        </>
      )}

      <Section title="Export">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {FORMATS.map(f => (
            <button key={f.value} onClick={() => setFormat(f.value)} style={chip(format === f.value)}>
              {f.label}
            </button>
          ))}
          <button onClick={() => void copy()} style={{ ...chip(false), marginLeft: 'auto' }}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </div>
        <textarea
          readOnly
          value={text}
          style={{
            width: '100%', minHeight: 220, resize: 'vertical',
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
            padding: 12, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)', color: 'var(--color-text)',
          }}
        />
      </Section>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', fontSize: 12, fontWeight: active ? 600 : 400,
    borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
    background: active ? 'var(--color-accent-soft)' : 'transparent',
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
  };
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{
      flex: '1 1 140px', padding: '12px 14px', borderRadius: 10,
      border: '1px solid var(--color-border)', background: 'var(--color-surface)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--color-text-muted)', margin: '0 0 8px',
      }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ left, right }: { left: React.ReactNode; right: string }): React.JSX.Element {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13,
    }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {left}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', flexShrink: 0 }}>{right}</div>
    </div>
  );
}
