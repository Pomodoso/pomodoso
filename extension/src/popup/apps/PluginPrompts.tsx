import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { addDays, fieldOptions, initialRecordData, templateFormat } from '@pomodoso/types/plugins';
import { PluginIcon } from '@pomodoso/ui/plugins';

import { db, localDate } from '../../db';
import { addRecord, setDaily } from '../../plugins';
import {
  EMPTY_PROMPT_STATE,
  breakKey,
  hookId,
  localNoon,
  pendingDayEnd,
  pickBreakPrompt,
  promptHooks,
  type PromptCandidate,
  type PromptState,
} from '../../pluginHooks';
import { toEngineRecord } from '../../pluginRows';
import { isSupported } from './supported';
import { usePluginData } from './usePluginData';

// Plugin questions on Today: the `pomodoro_end` question for the current
// break, else a `day_end` question about yesterday. One card at most, always
// dismissible, never in the timer's way. Lazy-loaded with the plugin engine;
// HomeState renders it only when signed in (signed out, hooks are off).

const STATE_KEY = 'plugin_prompts';

async function readState(): Promise<PromptState> {
  const row = await db.settings.get(STATE_KEY);
  return { ...EMPTY_PROMPT_STATE, ...(row?.value as Partial<PromptState> | undefined) };
}

/** Read-modify-write in one transaction, so two popups can't undo each other. */
async function updateState(change: (s: PromptState) => PromptState): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const prev = await readState();
    const next = change(prev);
    if (next !== prev) await db.settings.put({ key: STATE_KEY, value: next });
  });
}

const BREAK_STATUSES = new Set(['pomo-done', 'break']);

export function PluginPrompts({ timerStatus, sessionId, pomosCompletedToday, timezone, weekStart }: {
  timerStatus: string;
  /** The pomodoro session the break follows: what identifies the break. */
  sessionId: string | null;
  pomosCompletedToday: number;
  timezone: string;
  weekStart: number;
}) {
  const plugins = useLiveQuery(() => db.plugins.toArray(), []);
  const stateRow = useLiveQuery(() => db.settings.get(STATE_KEY), []);
  const state: PromptState = { ...EMPTY_PROMPT_STATE, ...(stateRow?.value as Partial<PromptState> | undefined) };
  const today = localDate(timezone);
  const yesterday = addDays(today, -1);
  const inBreak = BREAK_STATUSES.has(timerStatus);
  const key = breakKey(sessionId, today, pomosCompletedToday);

  const usable = useMemo(() => plugins?.filter(isSupported), [plugins]);
  const breakCandidates = useMemo(() => (usable ? promptHooks(usable, 'pomodoro_end') : []), [usable]);
  const dayEndCandidates = useMemo(() => (usable ? promptHooks(usable, 'day_end') : []), [usable]);
  const dayEndPluginIds = dayEndCandidates.map((c) => c.plugin.id).join(',');
  const dayEndRecords = useLiveQuery(
    async () => (dayEndPluginIds ? (await db.pluginRecords.where('pluginId').anyOf(dayEndPluginIds.split(',')).toArray()).map((r) => ({ pluginId: r.pluginId, record: toEngineRecord(r) })) : []),
    [dayEndPluginIds],
  );

  // A new break picks its question once; the pick is persisted so reopening
  // the popup shows the same one and the next break rotates.
  useEffect(() => {
    if (!inBreak || breakCandidates.length === 0) return;
    void updateState((s) => pickBreakPrompt(breakCandidates, s, key));
  }, [inBreak, key, breakCandidates]);

  if (!plugins) return null;

  let shown: { candidate: PromptCandidate; day: string; close: () => Promise<void> } | undefined;
  const pick = inBreak && state.break?.key === key && !state.break.done ? state.break.hook : null;
  const breakCandidate = pick ? breakCandidates.find((c) => hookId(c.plugin.id, c.index) === pick) : undefined;
  if (breakCandidate) {
    shown = {
      candidate: breakCandidate,
      day: today,
      close: () => updateState((s) => (s.break?.key === key ? { ...s, break: { ...s.break, done: true } } : s)),
    };
  } else if (dayEndRecords) {
    const c = pendingDayEnd(dayEndCandidates, state, yesterday, (id) => dayEndRecords.filter((r) => r.pluginId === id).map((r) => r.record));
    if (c) {
      const id = hookId(c.plugin.id, c.index);
      shown = { candidate: c, day: yesterday, close: () => updateState((s) => ({ ...s, dayEnd: { ...s.dayEnd, [id]: yesterday } })) };
    }
  }
  if (!shown) return null;
  return (
    <div style={{ padding: '10px 14px 0' }}>
      <PromptCard key={hookId(shown.candidate.plugin.id, shown.candidate.index)} {...shown} today={today} timezone={timezone} weekStart={weekStart} />
    </div>
  );
}

function PromptCard({ candidate, day, today, timezone, weekStart, close }: {
  candidate: PromptCandidate;
  day: string;
  today: string;
  timezone: string;
  weekStart: number;
  close: () => Promise<void>;
}) {
  const { plugin, hook } = candidate;
  const { evaluator } = usePluginData(plugin, timezone, weekStart);
  // One answer per question: controls lock on the first click until the write and close land.
  const [busy, setBusy] = useState(false);
  if (!evaluator) return null;
  const env = { timezone, weekStart };
  const now = new Date().toISOString();
  const question = evaluator.template(hook.ask, templateFormat(plugin.manifest, now));
  const settle = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await close();
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => void settle(async () => {});
  // A yes about yesterday is an event of yesterday (its local noon), not of now.
  const occurredAt = day === today ? undefined : localNoon(day, timezone);

  let actions: React.ReactNode = null;
  if (hook.yes) {
    const yes = hook.yes;
    const c = plugin.manifest.collections.find((x) => x.key === yes.add);
    actions = (
      <>
        <button type="button" disabled={busy} onClick={dismiss} style={chip(false)}>No</button>
        {c ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void settle(() => addRecord(plugin, c.key, initialRecordData(c, resolveSet(yes.set, (v) => evaluator.value(v))), env, occurredAt ? { occurredAt } : {}))}
            style={chip(true)}
          >
            Yes
          </button>
        ) : null}
      </>
    );
  } else if (hook.pick) {
    const p = hook.pick;
    const c = plugin.manifest.collections.find((x) => x.key === p.collection);
    const field = c?.fields.find((f) => f.key === p.field);
    if (c && field) {
      actions = fieldOptions(c.key, field, plugin.settings).map((o) => (
        <button key={o.value} type="button" disabled={busy} onClick={() => void settle(() => setDaily(plugin, c.key, day, { [field.key]: o.value }, env))} style={chip(false, o.color)}>
          {o.color ? <span style={{ width: 8, height: 8, borderRadius: 2, background: o.color, marginRight: 5 }} /> : null}
          {o.label}
        </button>
      ));
    }
  }

  return (
    <div role="group" aria-label={`${plugin.manifest.name} asks`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PluginIcon icon={plugin.manifest.icon} name={plugin.manifest.name} size={22} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-faint)' }}>
            {plugin.manifest.name}
            {day !== today ? ' · yesterday' : ''}
          </span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{question}</span>
        </span>
        <button type="button" aria-label="Dismiss" disabled={busy} onClick={dismiss} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-faint)', fontSize: 14 }}>
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: hook.yes ? 'flex-end' : 'flex-start' }}>{actions}</div>
    </div>
  );
}

function resolveSet(set: Record<string, unknown> | undefined, value: (ref: string) => unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set ?? {})) {
    const r = typeof v === 'string' && v.startsWith('$') ? value(v) : v;
    if (r !== null && r !== undefined) out[k] = r;
  }
  return out;
}

function chip(primary: boolean, color?: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'inherit',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    border: `1px solid ${primary ? 'var(--color-accent)' : (color ?? 'var(--color-border)')}`,
    background: primary ? 'var(--color-accent)' : 'transparent',
    color: primary ? '#fff' : 'var(--color-text)',
  };
}
