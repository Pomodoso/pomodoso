// APPS_VERSION: the version of the app file format, on its own clock (not
// the extension's, not an app's own `version`). A client supports one
// APPS_VERSION and everything before it; each published app version
// records the lowest one it needs (`min_apps_version`), so the directory
// only shows a client what it can open, and hands it the latest version it
// understands. A client that doesn't say is treated as 0.1 (extension
// 1.4.0, the first release with apps).
//
// Adding to the format: give the new catalog entry its version below (the
// Record types fail the typecheck otherwise) or, for a new property, a check
// in requiredAppsVersion. Raise APPS_VERSION once per release that changes
// the format, and freeze the previous schema in schema/apps/<version>.json
// first (see CLAUDE.md).

import type { BlockType, BuiltinRef, CollectionKind, ComputedOp, FieldType, HookEvent, StatFormat, TodayWidgetType } from './catalog.ts';
import type { ComputedExpr, PluginManifest, ValueRef } from './manifest.ts';

export const APPS_VERSION = '0.2';
/** What a client that doesn't send its version understands. */
export const BASE_APPS_VERSION = '0.1';

/**
 * The first release of each client that opens each APPS_VERSION, so people
 * read "Pomodoso 1.4.1 or later" instead of a format number. Every
 * APPS_VERSION needs its row (a test checks it); a client that doesn't
 * open apps yet (mobile) has no column.
 */
export const APPS_VERSION_CLIENTS: Record<string, { extension: string }> = {
  '0.1': { extension: '1.4.0' },
  '0.2': { extension: '1.4.1' },
};

/** "Pomodoso 1.4.1 or later": what opens a file needing `appsVersion`. */
export function worksWith(appsVersion: string): string {
  const ext = APPS_VERSION_CLIENTS[appsVersion]?.extension;
  return ext ? `Pomodoso ${ext} or later` : `a newer version of Pomodoso`;
}

/** Negative when a < b. `0.10` is after `0.9`. */
export function compareAppsVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  return (x[0]! - y[0]!) || ((x[1] ?? 0) - (y[1] ?? 0));
}

const BLOCKS: Record<BlockType, string> = {
  'counter-button': '0.1', 'add-button': '0.1', form: '0.1', stat: '0.1', 'stat-row': '0.1', progress: '0.1', chart: '0.1',
  list: '0.1', 'tag-filter': '0.1', board: '0.1', 'year-grid': '0.1', 'day-picker': '0.1', breakdown: '0.1', text: '0.1',
};
const WIDGETS: Record<TodayWidgetType, string> = {
  'mini-counter': '0.1', 'select-today': '0.1', 'count-badge': '0.1', stat: '0.1', stats: '0.2', progress: '0.2',
};
const OPS: Record<ComputedOp, string> = {
  count: '0.1', sum: '0.1', avg: '0.1', min: '0.1', max: '0.1', last: '0.1', first: '0.1', streak: '0.1', taper: '0.1', delta: '0.1', calendar: '0.2', ratio: '0.2',
};
const FORMATS: Record<StatFormat, string> = {
  number: '0.1', time_ago: '0.1', days: '0.1', percent: '0.1', share: '0.2', duration: '0.1', date: '0.1',
};
const REFS: Record<BuiltinRef, string> = { today_date: '0.1', now: '0.1', 'tab.url': '0.1', 'tab.title': '0.1', 'tab.image': '0.2' };
const FIELDS: Record<FieldType, string> = {
  text: '0.1', longtext: '0.1', number: '0.1', scale: '0.1', boolean: '0.1', date: '0.1', url: '0.1', select: '0.1',
  multiselect: '0.1', tags: '0.1', rating: '0.1', duration: '0.1', image_url: '0.1',
};
const KINDS: Record<CollectionKind, string> = { event: '0.1', item: '0.1', daily: '0.1' };
const HOOKS: Record<HookEvent, string> = { pomodoro_end: '0.1', day_end: '0.1', daily_report: '0.1', weekly_report: '0.1' };

/** The lowest APPS_VERSION that can open this file. */
export function requiredAppsVersion(m: PluginManifest): string {
  let need = BASE_APPS_VERSION;
  const at = (v: string | undefined) => {
    if (v && compareAppsVersions(v, need) > 0) need = v;
  };

  const values = (v: ValueRef | undefined) => {
    if (v === undefined) return;
    if (typeof v === 'string') {
      if (v.startsWith('$')) at(REFS[v.slice(1) as BuiltinRef]);
      return;
    }
    if (typeof v === 'number') return;
    expr(v);
  };
  const expr = (e: ComputedExpr) => {
    const op = (Object.keys(OPS) as ComputedOp[]).find((o) => o in e);
    if (!op) return;
    at(OPS[op]);
    if ('taper' in e) for (const x of Object.values(e.taper)) values(x as ValueRef | undefined);
    if ('delta' in e) e.delta.forEach(values);
    if ('ratio' in e) e.ratio.forEach(values);
    if ('streak' in e) {
      values(e.at_least);
      values(e.at_most);
    }
  };
  const format = (f: StatFormat | undefined) => at(f && FORMATS[f]);
  const refs = (map: Record<string, unknown> | undefined) => {
    for (const v of Object.values(map ?? {})) if (typeof v === 'string' && v.startsWith('$')) at(REFS[v.slice(1) as BuiltinRef]);
  };

  // An app that keeps no data.
  if (m.collections.length === 0) at('0.2');
  for (const c of m.collections) {
    at(KINDS[c.kind]);
    for (const f of c.fields) at(FIELDS[f.type]);
  }
  for (const e of Object.values(m.computed ?? {})) expr(e);

  for (const view of m.views) {
    for (const b of view.blocks) {
      at(BLOCKS[b.type]);
      switch (b.type) {
        case 'counter-button':
          if (b.subtract !== undefined) at('0.2');
          refs(b.set);
          break;
        case 'add-button':
          refs(b.prefill);
          break;
        case 'stat':
          values(b.value);
          format(b.format);
          break;
        case 'stat-row':
          for (const it of b.items) {
            values(it.value);
            format(it.format);
          }
          break;
        case 'progress':
          values(b.value);
          values(b.max);
          format(b.format);
          if (b.style !== undefined) at('0.2');
          break;
        case 'chart':
          expr(b.series);
          values(b.reference);
          break;
        default:
          break;
      }
    }
  }

  const w = m.today?.widget;
  if (w) {
    at(WIDGETS[w.type]);
    switch (w.type) {
      case 'mini-counter':
        values(w.value);
        values(w.max);
        if (w.subtract !== undefined) at('0.2');
        break;
      case 'select-today':
        if (w.after !== undefined) at('0.2');
        break;
      case 'count-badge':
        values(w.value);
        break;
      case 'stat':
        values(w.value);
        format(w.format);
        break;
      case 'stats':
        for (const it of w.items) {
          values(it.value);
          format(it.format);
        }
        break;
      case 'progress':
        values(w.value);
        values(w.max);
        format(w.format);
        break;
    }
  }
  for (const h of m.hooks ?? []) at(HOOKS[h.on]);
  return need;
}
