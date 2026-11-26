import {
  addDays,
  breakKey,
  EMPTY_PROMPT_STATE,
  fieldOptions,
  hookId,
  initialRecordData,
  localNoon,
  pendingDayEnd,
  pickBreakPrompt,
  promptHooks,
  templateFormat,
  type PromptCandidate,
  type PromptState,
} from '@pomodoso/types/plugins';
import { toEngineRecord } from '@pomodoso/types/plugins/rows';
import { eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { db } from '@/db/client';
import { pluginRecord, settings } from '@/db/schema';
import { useAuth } from '@/hooks/useAuth';
import { isSupported, usePluginClock, usePluginData, usePlugins } from '@/hooks/usePlugins';
import { addRecord, localToday, setDaily, type PluginClock } from '@/utils/plugins';
import { recordFromColumns } from '@/utils/pluginStore';

import { Chip, PluginIcon, ui } from './primitives';

// Ports the extension's PluginPrompts: an app's question as a card on Today,
// never blocking the timer. `pomodoro_end` questions show during a break, one
// per break, rotating between apps; `day_end` questions ask about yesterday.
// The picking logic is shared (@pomodoso/types/plugins' prompts.ts); its
// state is kept in settings under the same key as the extension's.

const STATE_KEY = 'plugin_prompts';

function readState(): PromptState {
  const raw = db.select().from(settings).where(eq(settings.key, STATE_KEY)).all()[0]?.value;
  try {
    return { ...EMPTY_PROMPT_STATE, ...(raw ? (JSON.parse(raw) as Partial<PromptState>) : {}) };
  } catch {
    return EMPTY_PROMPT_STATE;
  }
}

function updateState(change: (s: PromptState) => PromptState): void {
  const prev = readState();
  const next = change(prev);
  if (next === prev) return;
  const value = JSON.stringify(next);
  db.insert(settings).values({ key: STATE_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function PluginPrompts({ inBreak, sessionId, pomosToday }: {
  inBreak: boolean;
  /** The focus session the break follows: what identifies the break. */
  sessionId: string | null;
  pomosToday: number;
}): React.JSX.Element | null {
  const { session } = useAuth();
  const plugins = usePlugins();
  const clock = usePluginClock();
  const { data: stateRows } = useLiveQuery(db.select().from(settings).where(eq(settings.key, STATE_KEY)));
  const state = useMemo<PromptState>(() => {
    try {
      return { ...EMPTY_PROMPT_STATE, ...(stateRows?.[0] ? (JSON.parse(stateRows[0].value) as Partial<PromptState>) : {}) };
    } catch {
      return EMPTY_PROMPT_STATE;
    }
  }, [stateRows]);
  const today = localToday(clock.timeZone);
  const yesterday = addDays(today, -1);
  // Fixed for as long as the break lasts: from pomo-done through the break
  // itself it's one break, and a key that moved (a session lookup that came
  // back different) would re-pick and rotate its question.
  const liveKey = breakKey(sessionId, today, pomosToday);
  const held = useRef<string | null>(null);
  if (!inBreak) held.current = null;
  else if (held.current === null) held.current = liveKey;
  const key = held.current ?? liveKey;

  const usable = useMemo(() => plugins?.filter(isSupported), [plugins]);
  const breakCandidates = useMemo(() => (usable ? promptHooks(usable, 'pomodoro_end') : []), [usable]);
  const dayEndCandidates = useMemo(() => (usable ? promptHooks(usable, 'day_end') : []), [usable]);
  const { data: recordRows } = useLiveQuery(db.select().from(pluginRecord).where(isNull(pluginRecord.deletedAt)));

  useEffect(() => {
    if (!inBreak || breakCandidates.length === 0) return;
    updateState(s => pickBreakPrompt(breakCandidates, s, key));
  }, [inBreak, key, breakCandidates]);

  // Like the extension: questions are asked only when signed in.
  if (!session || !plugins || !recordRows) return null;

  let shown: { candidate: PromptCandidate; day: string; close: () => void } | undefined;
  const pick = inBreak && state.break?.key === key && !state.break.done ? state.break.hook : null;
  const breakCandidate = pick ? breakCandidates.find(c => hookId(c.plugin.id, c.index) === pick) : undefined;
  if (breakCandidate) {
    shown = {
      candidate: breakCandidate,
      day: today,
      close: () => updateState(s => (s.break?.key === key ? { ...s, break: { ...s.break, done: true } } : s)),
    };
  } else {
    const c = pendingDayEnd(dayEndCandidates, state, yesterday, id =>
      recordRows.filter(r => r.pluginId === id).map(r => toEngineRecord(recordFromColumns(r))),
    );
    if (c) {
      const id = hookId(c.plugin.id, c.index);
      shown = { candidate: c, day: yesterday, close: () => updateState(s => ({ ...s, dayEnd: { ...s.dayEnd, [id]: yesterday } })) };
    }
  }
  if (!shown) return null;
  return <PromptCard key={hookId(shown.candidate.plugin.id, shown.candidate.index)} {...shown} today={today} clock={clock} />;
}

function PromptCard({ candidate, day, today, clock, close }: {
  candidate: PromptCandidate;
  day: string;
  today: string;
  clock: PluginClock;
  close: () => void;
}): React.JSX.Element | null {
  const { plugin, hook } = candidate;
  const { evaluator } = usePluginData(plugin, clock);
  const [busy, setBusy] = useState(false);
  if (!evaluator) return null;
  const now = new Date().toISOString();
  const question = evaluator.template(hook.ask, templateFormat(plugin.manifest, now));
  const settle = (work: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      work();
      close();
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => settle(() => {});
  const occurredAt = day === today ? undefined : localNoon(day, clock.timeZone);

  let actions: React.ReactNode = null;
  if (hook.yes) {
    const yes = hook.yes;
    const c = plugin.manifest.collections.find(x => x.key === yes.add);
    actions = (
      <>
        <Chip label="No" on={false} disabled={busy} onPress={dismiss} />
        {c ? (
          <Pressable
            disabled={busy}
            style={styles.yes}
            onPress={() =>
              settle(() => addRecord(plugin, c.key, initialRecordData(c, resolveSet(yes.set, v => evaluator.value(v))), clock, occurredAt ? { occurredAt } : {}))
            }
          >
            <Text style={styles.yesText}>Yes</Text>
          </Pressable>
        ) : null}
      </>
    );
  } else if (hook.pick) {
    const p = hook.pick;
    const c = plugin.manifest.collections.find(x => x.key === p.collection);
    const field = c?.fields.find(f => f.key === p.field);
    if (c && field) {
      actions = fieldOptions(c.key, field, plugin.settings).map(o => (
        <Chip key={o.value} label={o.label} color={o.color} on={false} disabled={busy} onPress={() => settle(() => setDaily(plugin, c.key, day, { [field.key]: o.value }, clock))} />
      ));
    }
  }

  return (
    <View style={[ui.card, { gap: 10 }]} accessibilityLabel={`${plugin.manifest.name} asks`}>
      <View style={styles.head}>
        <PluginIcon icon={plugin.manifest.icon} name={plugin.manifest.name} size={26} />
        <View style={{ flex: 1 }}>
          <Text style={styles.app}>
            {plugin.manifest.name}
            {day !== today ? ' · yesterday' : ''}
          </Text>
          <Text style={styles.question}>{question}</Text>
        </View>
        <Pressable onPress={dismiss} disabled={busy} hitSlop={8} accessibilityLabel="Dismiss">
          <Text style={{ fontSize: 18, color: colors.textTertiary }}>×</Text>
        </Pressable>
      </View>
      <View style={[styles.actions, hook.yes ? { justifyContent: 'flex-end' } : null]}>{actions}</View>
    </View>
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

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  app: { fontSize: 12, color: colors.textTertiary },
  question: { fontSize: 15, fontWeight: '600', color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  yes: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, justifyContent: 'center' },
  yesText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
