// Which plugin question to ask, and when. Pure: the popup persists the
// returned state in settings ('plugin_prompts') and renders the card.
//
// Rules (plugins-plan §7): a question never blocks the timer, it's a card the
// user can dismiss; at most one plugin question per break, rotating between
// plugins so none of them takes every break; `day_end` asks about yesterday
// on the first open of the next day, until it's answered or dismissed.

import type { PluginHook, PluginRecord } from '@pomodoso/types/plugins';

import type { PluginRow } from './db.ts';

export type PromptHook = Extract<PluginHook, { ask: string }>;

export interface PromptCandidate {
  plugin: PluginRow;
  /** Index in the manifest's `hooks`: with the plugin id, a stable hook id. */
  index: number;
  hook: PromptHook;
}

export interface PromptState {
  /** Increments once per break; `lastShown` compares these. */
  seq: number;
  /** The break being shown: its key, the hook picked for it, and whether it was answered or dismissed. */
  break?: { key: string; hook: string | null; done: boolean } | undefined;
  /** hook id → `seq` of the break it was last asked in. */
  lastShown: Record<string, number>;
  /** hook id → the day a `day_end` question was answered or dismissed for. */
  dayEnd: Record<string, string>;
}

export const EMPTY_PROMPT_STATE: PromptState = { seq: 0, lastShown: {}, dayEnd: {} };

export const hookId = (pluginId: string, index: number) => `${pluginId}#${index}`;

/** Prompt hooks for an event, from live, enabled plugins, in install order. */
export function promptHooks(plugins: readonly PluginRow[], on: PromptHook['on']): PromptCandidate[] {
  return [...plugins]
    .filter((p) => !p.deletedAt && p.enabled)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((plugin) =>
      (plugin.manifest.hooks ?? []).flatMap((hook, index) =>
        'ask' in hook && hook.on === on ? [{ plugin, index, hook }] : [],
      ),
    );
}

/** A break's key: one per completed pomodoro. */
export const breakKey = (today: string, pomosCompletedToday: number) => `${today}#${pomosCompletedToday}`;

/**
 * The `pomodoro_end` question for this break. The first call for a new break
 * picks the hook asked least recently (never asked first, then install
 * order) and returns the state to persist; later calls for the same break
 * return the same pick, so reopening the popup doesn't rotate it.
 */
export function pickBreakPrompt(candidates: readonly PromptCandidate[], state: PromptState, key: string): PromptState {
  if (state.break?.key === key) return state;
  const seq = state.seq + 1;
  let best: PromptCandidate | undefined;
  for (const c of candidates) {
    const id = hookId(c.plugin.id, c.index);
    if (!best || (state.lastShown[id] ?? 0) < (state.lastShown[hookId(best.plugin.id, best.index)] ?? 0)) best = c;
  }
  const id = best ? hookId(best.plugin.id, best.index) : null;
  return {
    ...state,
    seq,
    break: { key, hook: id, done: false },
    lastShown: id ? { ...state.lastShown, [id]: seq } : state.lastShown,
  };
}

/**
 * The first `day_end` question still open for `yesterday`. A `pick` is open
 * while yesterday's daily record lacks the field; any question is closed
 * once answered or dismissed. Plugins installed today have no yesterday.
 */
export function pendingDayEnd(
  candidates: readonly PromptCandidate[],
  state: PromptState,
  yesterday: string,
  recordsOf: (pluginId: string) => readonly PluginRecord[],
): PromptCandidate | undefined {
  return candidates.find((c) => {
    if (c.plugin.installedOn > yesterday) return false;
    if (state.dayEnd[hookId(c.plugin.id, c.index)] === yesterday) return false;
    const pick = c.hook.pick;
    if (!pick) return true;
    const rec = recordsOf(c.plugin.id).find((r) => r.collection === pick.collection && r.day === yesterday && !r.deleted_at);
    const v = rec?.data[pick.field];
    return v === undefined || v === null || v === '';
  });
}
