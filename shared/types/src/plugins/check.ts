// Cross-reference checks that the schema can't express: every collection,
// field and `$reference` a file names must exist and fit where it is used.
// Runs only on a file that already passed manifestSchema.

import { BUILTIN_REFS, COMPUTED_OPS, type CollectionKind, type FieldType } from './catalog.ts';
import { formatPath, unknownMessage, type PluginIssue } from './issues.ts';
import type {
  ComputedExpr,
  PluginBlock,
  PluginCollection,
  PluginField,
  PluginManifest,
  SelectOption,
  ValueRef,
  Where,
} from './manifest.ts';

type Path = (string | number)[];

/** Fields every record has without declaring them, per collection kind. */
const BUILTIN_FIELDS: Record<CollectionKind, readonly string[]> = {
  event: ['occurred_at', 'created_at', 'updated_at'],
  item: ['created_at', 'updated_at'],
  daily: ['day', 'created_at', 'updated_at'],
};
const DATE_BUILTINS = new Set(['occurred_at', 'created_at', 'updated_at', 'day']);
const NUMERIC_TYPES: readonly FieldType[] = ['number', 'scale', 'rating', 'duration'];
const TEMPLATE_REF = /\{\$([^}]*)\}/g;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function optionValue(o: SelectOption): string {
  return typeof o === 'string' ? o : o.value;
}

/** Fields a quick action must fill itself, because the user won't see a form. */
function requiredFields(c: PluginCollection): PluginField[] {
  return c.fields.filter((f) => !f.optional && f.default === undefined);
}

type Literal = string | number | boolean;

/**
 * Why a literal can't go in a value of this shape, or undefined when it fits.
 * Fields and settings share it: both are a type plus optional options and
 * bounds.
 */
function misfit(v: Literal, type: FieldType, options: readonly SelectOption[] | undefined, min?: number, max?: number): string | undefined {
  switch (type) {
    case 'number':
    case 'scale':
    case 'rating':
    case 'duration':
      if (typeof v !== 'number') return `expected a number, got ${JSON.stringify(v)}`;
      if (min !== undefined && v < min) return `${v} is below the minimum ${min}`;
      if (max !== undefined && v > max) return `${v} is above the maximum ${max}`;
      return undefined;
    case 'boolean':
      return typeof v === 'boolean' ? undefined : `expected true or false, got ${JSON.stringify(v)}`;
    case 'select':
    case 'multiselect': {
      const values = (options ?? []).map(optionValue);
      return typeof v === 'string' && values.includes(v) ? undefined : unknownMessage('option', String(v), values);
    }
    case 'date':
      return typeof v === 'string' && DAY_PATTERN.test(v) ? undefined : `expected a date like 2026-01-31, got ${JSON.stringify(v)}`;
    default:
      return typeof v === 'string' ? undefined : `expected text, got ${JSON.stringify(v)}`;
  }
}

function operatorOf(e: ComputedExpr): (typeof COMPUTED_OPS)[number] {
  return COMPUTED_OPS.find((op) => op in e)!;
}

export function checkManifest(m: PluginManifest): PluginIssue[] {
  const issues: PluginIssue[] = [];
  const add = (path: Path, message: string) => issues.push({ path: formatPath(path), message });

  // ─── Declarations ──────────────────────────────────────────────────────────

  const collections = new Map<string, PluginCollection>();
  m.collections.forEach((c, i) => {
    if (collections.has(c.key)) add(['collections', i, 'key'], `duplicate collection "${c.key}"`);
    else collections.set(c.key, c);

    const seen = new Set<string>();
    c.fields.forEach((f, j) => {
      const at: Path = ['collections', i, 'fields', j];
      if (seen.has(f.key)) add([...at, 'key'], `duplicate field "${f.key}" in collection "${c.key}"`);
      seen.add(f.key);
      if (BUILTIN_FIELDS[c.kind].includes(f.key)) {
        add([...at, 'key'], `"${f.key}" is built into ${c.kind} collections; pick another key`);
      }
      if (f.options) {
        const values = f.options.map(optionValue);
        const dup = values.find((v, k) => values.indexOf(v) !== k);
        if (dup !== undefined) add([...at, 'options'], `duplicate option "${dup}"`);
      }
      if (f.default !== undefined) {
        const list = f.type === 'multiselect' || f.type === 'tags';
        if (list !== Array.isArray(f.default)) {
          add([...at, 'default'], list ? `a ${f.type} default is a list` : `a ${f.type} default is a single value, not a list`);
        } else {
          for (const d of Array.isArray(f.default) ? f.default : [f.default]) {
            const why = f.type === 'tags' ? undefined : misfit(d, f.type, f.options, f.min, f.max);
            if (why) add([...at, 'default'], why);
          }
        }
      }
    });

    if (c.title_field !== undefined) {
      const f = c.fields.find((x) => x.key === c.title_field);
      if (!f) add(['collections', i, 'title_field'], unknownMessage('field', c.title_field, c.fields.map((x) => x.key)));
      else if (f.type !== 'text') add(['collections', i, 'title_field'], `title_field must be a text field; "${f.key}" is ${f.type}`);
    }
  });

  const settingKeys = new Set<string>();
  m.settings?.forEach((s, i) => {
    if (settingKeys.has(s.key)) add(['settings', i, 'key'], `duplicate setting "${s.key}"`);
    settingKeys.add(s.key);
    if (s.default !== undefined) {
      const why = misfit(s.default, s.type, s.options, s.min, s.max);
      if (why) add(['settings', i, 'default'], why);
    }
  });

  const computedKeys = new Set(Object.keys(m.computed ?? {}));
  for (const k of computedKeys) {
    if (settingKeys.has(k)) add(['computed', k], `"${k}" is both a setting and a computed value; rename one`);
  }
  // $now and $today_date are built in; a declared name would shadow them.
  const builtins = new Set<string>(BUILTIN_REFS);
  m.settings?.forEach((s, i) => {
    if (builtins.has(s.key)) add(['settings', i, 'key'], `"${s.key}" is a built-in reference ($${s.key}); pick another key`);
  });
  for (const k of computedKeys) {
    if (builtins.has(k)) add(['computed', k], `"${k}" is a built-in reference ($${k}); pick another key`);
  }

  const viewIds = new Set<string>();
  m.views.forEach((v, i) => {
    if (viewIds.has(v.id)) add(['views', i, 'id'], `duplicate view "${v.id}"`);
    viewIds.add(v.id);
  });

  // ─── Reference helpers ─────────────────────────────────────────────────────

  const refNames = [...settingKeys, ...computedKeys, ...BUILTIN_REFS];

  function ref(path: Path, raw: string, allowTab = false) {
    const name = raw.startsWith('$') ? raw.slice(1) : raw;
    if (name.startsWith('tab.')) {
      if (!(BUILTIN_REFS as readonly string[]).includes(name)) add(path, unknownMessage('reference', `$${name}`, BUILTIN_REFS.map((b) => `$${b}`)));
      else if (!allowTab) add(path, `$${name} is only available in an add-button's prefill`);
      return;
    }
    if (settingKeys.has(name) || computedKeys.has(name) || (BUILTIN_REFS as readonly string[]).includes(name)) return;
    add(path, unknownMessage('reference', `$${name}`, refNames.map((r) => `$${r}`)));
  }

  function template(path: Path, text: string) {
    for (const match of text.matchAll(TEMPLATE_REF)) ref(path, match[1]!);
  }

  function collection(path: Path, k: string, kinds?: readonly CollectionKind[], usage?: string) {
    const c = collections.get(k);
    if (!c) {
      add(path, unknownMessage('collection', k, collections.keys()));
      return undefined;
    }
    if (kinds && !kinds.includes(c.kind)) {
      add(path, `${usage ?? 'this'} needs a ${kinds.join(' or ')} collection; "${k}" is ${c.kind}`);
    }
    return c;
  }

  function field(path: Path, c: PluginCollection | undefined, k: string, types?: readonly FieldType[], usage?: string) {
    if (!c) return undefined;
    if (BUILTIN_FIELDS[c.kind].includes(k)) {
      if (types) add(path, `${usage ?? 'this'} needs a ${types.join(' or ')} field; "${k}" is a built-in date`);
      return undefined;
    }
    const f = c.fields.find((x) => x.key === k);
    if (!f) {
      add(path, unknownMessage(`field in "${c.key}"`, k, [...c.fields.map((x) => x.key), ...BUILTIN_FIELDS[c.kind]]));
      return undefined;
    }
    if (types && !types.includes(f.type)) {
      add(path, `${usage ?? 'this'} needs a ${types.join(' or ')} field; "${k}" is ${f.type}`);
    }
    return f;
  }

  function dateField(path: Path, c: PluginCollection | undefined, k: string) {
    if (!c || DATE_BUILTINS.has(k) && BUILTIN_FIELDS[c.kind].includes(k)) return;
    field(path, c, k, ['date'], '"by"');
  }

  function valueMap(path: Path, c: PluginCollection | undefined, map: Record<string, Literal>, allowTab = false) {
    for (const [k, v] of Object.entries(map)) {
      const f = field([...path, k], c, k);
      if (typeof v === 'string' && v.startsWith('$')) ref([...path, k], v, allowTab);
      else if (f) {
        const why = f.type === 'tags' ? undefined : misfit(v, f.type, f.options, f.min, f.max);
        if (why) add([...path, k], why);
      }
    }
  }

  function where(path: Path, c: PluginCollection | undefined, w: Where) {
    for (const [k, cond] of Object.entries(w)) {
      const at = [...path, k];
      if (c && !BUILTIN_FIELDS[c.kind].includes(k)) field(at, c, k);
      if (typeof cond === 'string' && cond.startsWith('$')) ref(at, cond);
      if (typeof cond === 'object') {
        for (const [op, v] of Object.entries(cond)) {
          if (typeof v === 'string' && v.startsWith('$')) ref([...at, op], v);
          if (Array.isArray(v)) {
            v.forEach((x, n) => {
              if (typeof x === 'string' && x.startsWith('$')) ref([...at, op, n], x);
            });
          }
        }
      }
    }
  }

  function value(path: Path, v: ValueRef) {
    if (typeof v === 'number') return;
    if (typeof v === 'string') return ref(path, v);
    computed(path, v);
  }

  function computed(path: Path, e: ComputedExpr) {
    const op = operatorOf(e);
    switch (op) {
      case 'count':
      case 'sum':
      case 'avg':
      case 'min':
      case 'max': {
        const x = e as ComputedExpr & { where?: Where; by?: string; field?: string };
        const c = collection([...path, op], (e as unknown as Record<string, string>)[op]!);
        if (op !== 'count') field([...path, 'field'], c, x.field!, NUMERIC_TYPES, `"${op}"`);
        if (x.where) where([...path, 'where'], c, x.where);
        if (x.by !== undefined) dateField([...path, 'by'], c, x.by);
        return;
      }
      case 'last':
      case 'first': {
        const x = e as { where?: Where; field?: string } & Record<string, unknown>;
        const c = collection([...path, op], x[op] as string);
        if (x.field !== undefined) field([...path, 'field'], c, x.field);
        if (x.where) where([...path, 'where'], c, x.where);
        return;
      }
      case 'streak': {
        const x = e as Extract<ComputedExpr, { streak: string }>;
        const c = collection([...path, 'streak'], x.streak);
        if (x.where) where([...path, 'where'], c, x.where);
        if (x.at_least !== undefined) value([...path, 'at_least'], x.at_least);
        if (x.at_most !== undefined) value([...path, 'at_most'], x.at_most);
        return;
      }
      case 'taper': {
        const t = (e as Extract<ComputedExpr, { taper: unknown }>).taper;
        for (const k of ['from', 'down_by', 'up_by', 'min', 'max'] as const) {
          const v = t[k];
          if (v !== undefined) value([...path, 'taper', k], v);
        }
        return;
      }
      case 'delta': {
        const [a, b] = (e as Extract<ComputedExpr, { delta: unknown }>).delta;
        value([...path, 'delta', 0], a);
        value([...path, 'delta', 1], b);
        return;
      }
    }
  }

  function quickAdd(path: Path, c: PluginCollection | undefined, set: Record<string, unknown> | undefined, usage: string, picked?: string) {
    if (!c) return;
    const missing = requiredFields(c).filter((f) => f.key !== picked && (!set || !(f.key in set)));
    if (missing.length > 0) {
      add(path, `${usage} adds to "${c.key}" without a form, but ${missing.map((f) => `"${f.key}"`).join(', ')} is required; make it optional, give it a default, or set it here`);
    }
  }

  // ─── Computed values (plus cycles between them) ───────────────────────────

  const computedEntries = Object.entries(m.computed ?? {});
  for (const [k, e] of computedEntries) computed(['computed', k], e);

  const deps = new Map<string, string[]>();
  for (const [k, e] of computedEntries) {
    const names = [...JSON.stringify(e).matchAll(/"\$([a-z][a-z0-9_]*)"/g)].map((x) => x[1]!).filter((n) => computedKeys.has(n));
    deps.set(k, names);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (k: string, trail: string[]): void => {
    if (state.get(k) === 'done') return;
    if (state.get(k) === 'visiting') {
      add(['computed', k], `circular reference: ${[...trail.slice(trail.indexOf(k)), k].map((n) => `$${n}`).join(' → ')}`);
      return;
    }
    state.set(k, 'visiting');
    for (const d of deps.get(k) ?? []) visit(d, [...trail, k]);
    state.set(k, 'done');
  };
  for (const k of computedKeys) visit(k, []);

  // ─── Rules ─────────────────────────────────────────────────────────────────

  m.rules?.forEach((r, i) => {
    const c = collection(['rules', i, 'collection'], r.collection);
    where(['rules', i, 'when'], c, r.when);
    valueMap(['rules', i, 'set'], c, r.set);
  });

  // ─── Views ─────────────────────────────────────────────────────────────────

  m.views.forEach((v, i) => v.blocks.forEach((b, j) => block(['views', i, 'blocks', j], b)));

  function block(path: Path, b: PluginBlock) {
    switch (b.type) {
      case 'counter-button': {
        const c = collection([...path, 'adds'], b.adds, ['event'], 'counter-button');
        if (b.set) valueMap([...path, 'set'], c, b.set);
        template([...path, 'label'], b.label);
        if (b.details !== 'form') quickAdd(path, c, b.set, 'counter-button');
        return;
      }
      case 'add-button': {
        const c = collection([...path, 'adds'], b.adds, ['item'], 'add-button');
        if (b.prefill) valueMap([...path, 'prefill'], c, b.prefill, true);
        template([...path, 'label'], b.label);
        return;
      }
      case 'form':
        collection([...path, 'collection'], b.collection);
        return;
      case 'stat':
        value([...path, 'value'], b.value);
        template([...path, 'label'], b.label);
        return;
      case 'stat-row':
        b.items.forEach((it, k) => {
          value([...path, 'items', k, 'value'], it.value);
          template([...path, 'items', k, 'label'], it.label);
        });
        return;
      case 'progress':
        value([...path, 'value'], b.value);
        value([...path, 'max'], b.max);
        if (b.label !== undefined) template([...path, 'label'], b.label);
        return;
      case 'chart': {
        const op = operatorOf(b.series);
        const grouped = op === 'count' || op === 'sum' || op === 'avg' || op === 'min' || op === 'max';
        if (!grouped || !('group' in b.series) || b.series.group === undefined) {
          add([...path, 'series'], 'a chart series must be count, sum, avg, min or max with a "group" (day, week or month)');
        }
        computed([...path, 'series'], b.series);
        if (b.reference !== undefined) value([...path, 'reference'], b.reference);
        if (b.label !== undefined) template([...path, 'label'], b.label);
        return;
      }
      case 'list': {
        const c = collection([...path, 'collection'], b.collection);
        field([...path, 'primary'], c, b.primary);
        b.secondary?.forEach((s, k) => field([...path, 'secondary', k], c, s));
        if (b.open !== undefined) field([...path, 'open'], c, b.open, ['url'], '"open"');
        if (b.sort && !(c && BUILTIN_FIELDS[c.kind].includes(b.sort.field))) field([...path, 'sort', 'field'], c, b.sort.field);
        if (b.filter) where([...path, 'filter'], c, b.filter);
        if (b.swipe) {
          valueMap([...path, 'swipe', 'set'], c, b.swipe.set);
          if (b.swipe.label !== undefined) template([...path, 'swipe', 'label'], b.swipe.label);
        }
        return;
      }
      case 'tag-filter': {
        const c = collection([...path, 'collection'], b.collection);
        field([...path, 'field'], c, b.field, ['tags', 'multiselect', 'select'], 'tag-filter');
        return;
      }
      case 'board': {
        const c = collection([...path, 'collection'], b.collection, ['item'], 'board');
        field([...path, 'group_by'], c, b.group_by, ['select'], 'group_by');
        field([...path, 'card', 'title'], c, b.card.title);
        if (b.card.subtitle !== undefined) field([...path, 'card', 'subtitle'], c, b.card.subtitle);
        if (b.card.image !== undefined) field([...path, 'card', 'image'], c, b.card.image, ['image_url'], 'card image');
        if (b.card.badge !== undefined) field([...path, 'card', 'badge'], c, b.card.badge);
        return;
      }
      case 'year-grid': {
        const c = collection([...path, 'collection'], b.collection, ['daily', 'event'], 'year-grid');
        if (b.color_by !== undefined) field([...path, 'color_by'], c, b.color_by, ['select'], 'color_by');
        return;
      }
      case 'day-picker': {
        const c = collection([...path, 'collection'], b.collection, ['daily'], 'day-picker');
        field([...path, 'field'], c, b.field, ['select'], 'day-picker');
        quickAdd(path, c, undefined, 'day-picker', b.field);
        return;
      }
      case 'breakdown': {
        const c = collection([...path, 'collection'], b.collection);
        field([...path, 'field'], c, b.field, ['select', 'multiselect', 'tags'], 'breakdown');
        return;
      }
      case 'text':
        template([...path, 'text'], b.text);
        return;
    }
  }

  // ─── Today ─────────────────────────────────────────────────────────────────

  if (m.today) {
    const w = m.today.widget;
    const path: Path = ['today', 'widget'];
    template([...path, 'label'], w.label);
    switch (w.type) {
      case 'mini-counter': {
        const c = collection([...path, 'adds'], w.adds, ['event'], 'mini-counter');
        quickAdd(path, c, undefined, 'mini-counter');
        value([...path, 'value'], w.value);
        if (w.max !== undefined) value([...path, 'max'], w.max);
        break;
      }
      case 'select-today': {
        const c = collection([...path, 'collection'], w.collection, ['daily'], 'select-today');
        field([...path, 'field'], c, w.field, ['select'], 'select-today');
        quickAdd(path, c, undefined, 'select-today', w.field);
        break;
      }
      case 'count-badge':
      case 'stat':
        value([...path, 'value'], w.value);
        break;
    }
  }

  // ─── Hooks ─────────────────────────────────────────────────────────────────

  m.hooks?.forEach((h, i) => {
    const path: Path = ['hooks', i];
    if ('line' in h) {
      template([...path, 'line'], h.line);
      return;
    }
    template([...path, 'ask'], h.ask);
    if (h.yes) {
      const c = collection([...path, 'yes', 'add'], h.yes.add, ['event'], 'a hook action');
      if (h.yes.set) valueMap([...path, 'yes', 'set'], c, h.yes.set);
      quickAdd([...path, 'yes'], c, h.yes.set, 'this hook');
    }
    if (h.pick) {
      const c = collection([...path, 'pick', 'collection'], h.pick.collection, ['daily'], 'pick');
      field([...path, 'pick', 'field'], c, h.pick.field, ['select'], 'pick');
      quickAdd([...path, 'pick'], c, undefined, 'pick', h.pick.field);
    }
  });

  return issues;
}
