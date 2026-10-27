// The shape of a plugin file (schema v1).
//
// Every object is strict: an unknown key is an error, never ignored, because
// a typo like `colection` silently dropping a setting is exactly the kind of
// mistake an LLM makes and can't see. Cross-references (does `adds: book`
// name a collection? does `$limit` exist?) are not expressible here and are
// checked afterwards in check.ts.

import { z } from './zod.ts';

import {
  BLOCK_TYPES,
  COLLECTION_KINDS,
  COMPUTED_OPS,
  FIELD_TYPES,
  GROUP_PERIODS,
  HOOK_EVENTS,
  NAMED_RANGES,
  PLUGIN_SCHEMA_VERSION,
  RANGE_PATTERN,
  SETTING_TYPES,
  STAT_FORMATS,
  TODAY_WIDGET_TYPES,
} from './catalog.ts';

// ─── Primitives ──────────────────────────────────────────────────────────────

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const REF_PATTERN = /^\$[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;

const key = z.string().regex(KEY_PATTERN, 'must be lower_snake_case: a-z, 0-9 and _, starting with a letter (max 40)');
const label = z.string().min(1).max(80);
const longText = z.string().max(2000);
const literal = z.union([z.string().max(500), z.number(), z.boolean()]);
const valueMap = z.record(key, literal);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #2D8A7A');

export const refString = z
  .string()
  .regex(REF_PATTERN, 'must be a $reference like $limit (references start with $ and use lower_snake_case)');

const range = z
  .string()
  .refine((v) => (NAMED_RANGES as readonly string[]).includes(v) || RANGE_PATTERN.test(v), {
    message: `expected one of ${NAMED_RANGES.join(', ')}, or a rolling window like 14d or 12mo`,
  });

// ─── Where ───────────────────────────────────────────────────────────────────

const comparable = z.union([z.number(), refString]);

const whereCondition = z.union([
  literal,
  z
    .strictObject({
      in: z.array(literal).min(1).optional(),
      exists: z.boolean().optional(),
      lt: comparable.optional(),
      lte: comparable.optional(),
      gt: comparable.optional(),
      gte: comparable.optional(),
    })
    .refine((o) => Object.keys(o).length > 0, { message: 'needs at least one of in, exists, lt, lte, gt, gte' }),
]);

export const whereSchema = z.record(key, whereCondition);
export type Where = z.infer<typeof whereSchema>;

// ─── Computed values ─────────────────────────────────────────────────────────
// Exactly one operator key per object. Recursive through `ValueRef`, which is
// how `delta` compares two other values and `streak` reads `$limit`.

export interface CountExpr {
  count: string;
  where?: Where | undefined;
  range?: string | undefined;
  by?: string | undefined;
  group?: (typeof GROUP_PERIODS)[number] | undefined;
}
type AggOp = 'sum' | 'avg' | 'min' | 'max';
export type AggExpr = {
  [K in AggOp]: { [P in K]: string } & {
    field: string;
    where?: Where | undefined;
    range?: string | undefined;
    by?: string | undefined;
    group?: (typeof GROUP_PERIODS)[number] | undefined;
  };
}[AggOp];
export type PickExpr =
  | { last: string; where?: Where | undefined; field?: string | undefined }
  | { first: string; where?: Where | undefined; field?: string | undefined };
export interface StreakExpr {
  streak: string;
  where?: Where | undefined;
  at_least?: ValueRef | undefined;
  at_most?: ValueRef | undefined;
}
export interface TaperExpr {
  taper: {
    from: ValueRef;
    down_by?: ValueRef | undefined;
    up_by?: ValueRef | undefined;
    every: (typeof GROUP_PERIODS)[number];
    min?: ValueRef | undefined;
    max?: ValueRef | undefined;
  };
}
export interface DeltaExpr {
  delta: [ValueRef, ValueRef];
}
export type ComputedExpr = CountExpr | AggExpr | PickExpr | StreakExpr | TaperExpr | DeltaExpr;
export type ValueRef = number | string | ComputedExpr;

const group = z.enum(GROUP_PERIODS);

export const valueRefSchema: z.ZodType<ValueRef> = z.lazy(() => z.union([z.number(), refString, computedSchema]));

const aggregate = <K extends AggOp>(op: K) =>
  z.strictObject({
    [op]: key,
    field: key,
    where: whereSchema.optional(),
    range: range.optional(),
    by: key.optional(),
    group: group.optional(),
  } as { [P in K]: typeof key } & {
    field: typeof key;
    where: z.ZodOptional<typeof whereSchema>;
    range: z.ZodOptional<typeof range>;
    by: z.ZodOptional<typeof key>;
    group: z.ZodOptional<typeof group>;
  });

/** Branch order matches COMPUTED_OPS, so an issue's branch index names its operator. */
export const computedSchema: z.ZodType<ComputedExpr> = z.lazy(() =>
  z.union([
    z.strictObject({
      count: key,
      where: whereSchema.optional(),
      range: range.optional(),
      by: key.optional(),
      group: group.optional(),
    }),
    aggregate('sum'),
    aggregate('avg'),
    aggregate('min'),
    aggregate('max'),
    z.strictObject({ last: key, where: whereSchema.optional(), field: key.optional() }),
    z.strictObject({ first: key, where: whereSchema.optional(), field: key.optional() }),
    z.strictObject({
      streak: key,
      where: whereSchema.optional(),
      at_least: valueRefSchema.optional(),
      at_most: valueRefSchema.optional(),
    }),
    z.strictObject({
      taper: z
        .strictObject({
          from: valueRefSchema,
          down_by: valueRefSchema.optional(),
          up_by: valueRefSchema.optional(),
          every: group,
          min: valueRefSchema.optional(),
          max: valueRefSchema.optional(),
        })
        .refine((t) => (t.down_by === undefined) !== (t.up_by === undefined), {
          message: 'needs exactly one of down_by or up_by',
        }),
    }),
    z.strictObject({ delta: z.tuple([valueRefSchema, valueRefSchema]) }),
  ]).meta({ id: 'ComputedValue', description: 'Exactly one operator: count, sum, avg, min, max, last, first, streak, taper or delta.' }),
);

// Compile-time guard: the union above must list one branch per operator.
const _opsCovered: Record<(typeof COMPUTED_OPS)[number], true> = {
  count: true, sum: true, avg: true, min: true, max: true, last: true, first: true, streak: true, taper: true, delta: true,
};
void _opsCovered;

// ─── Settings and fields ─────────────────────────────────────────────────────

const selectOption = z.union([
  key,
  z.strictObject({ value: key, label: label.optional(), color: hexColor.optional() }),
]);
export type SelectOption = z.infer<typeof selectOption>;

export const settingSchema = z
  .strictObject({
    key,
    type: z.enum(SETTING_TYPES),
    label,
    default: literal.optional(),
    options: z.array(selectOption).min(1).max(50).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .superRefine((s, ctx) => {
    if (s.type === 'select' && !s.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'a select setting needs options' });
    if (s.type !== 'select' && s.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'only select settings take options' });
  });
export type PluginSetting = z.infer<typeof settingSchema>;

const OPTION_TYPES = new Set(['select', 'multiselect']);
const RANGED_TYPES = new Set(['number', 'scale', 'rating', 'duration']);

export const fieldSchema = z
  .strictObject({
    key,
    type: z.enum(FIELD_TYPES),
    label: label.optional(),
    optional: z.boolean().optional(),
    default: z.union([literal, z.array(z.string())]).optional(),
    options: z.array(selectOption).min(1).max(50).optional(),
    user_editable: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    unit: z.string().max(20).optional(),
  })
  .superRefine((f, ctx) => {
    if (OPTION_TYPES.has(f.type) && !f.options) ctx.addIssue({ code: 'custom', path: ['options'], message: `a ${f.type} field needs options` });
    if (!OPTION_TYPES.has(f.type) && f.options) ctx.addIssue({ code: 'custom', path: ['options'], message: 'only select and multiselect fields take options' });
    if (f.user_editable && f.type !== 'select') ctx.addIssue({ code: 'custom', path: ['user_editable'], message: 'only select fields can be user_editable' });
    if ((f.min !== undefined || f.max !== undefined) && !RANGED_TYPES.has(f.type)) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min/max only apply to number, scale, rating and duration fields' });
    }
  });
export type PluginField = z.infer<typeof fieldSchema>;

export const collectionSchema = z.strictObject({
  key,
  kind: z.enum(COLLECTION_KINDS),
  title_field: key.optional(),
  fields: z.array(fieldSchema).min(1).max(50),
});
export type PluginCollection = z.infer<typeof collectionSchema>;

// ─── View blocks ─────────────────────────────────────────────────────────────

const statFormat = z.enum(STAT_FORMATS);
const sortField = z.strictObject({ field: key, order: z.enum(['asc', 'desc']).optional() });

const blockSchemas = {
  'counter-button': z.strictObject({
    type: z.literal('counter-button'),
    label,
    adds: key,
    details: z.enum(['none', 'form']).optional(),
    set: valueMap.optional(),
  }),
  'add-button': z.strictObject({ type: z.literal('add-button'), label, adds: key, prefill: valueMap.optional() }),
  form: z.strictObject({ type: z.literal('form'), collection: key }),
  stat: z.strictObject({ type: z.literal('stat'), label, value: valueRefSchema, format: statFormat.optional() }),
  'stat-row': z.strictObject({
    type: z.literal('stat-row'),
    items: z.array(z.strictObject({ label, value: valueRefSchema, format: statFormat.optional() })).min(1).max(4),
  }),
  progress: z.strictObject({
    type: z.literal('progress'),
    label: label.optional(),
    value: valueRefSchema,
    max: valueRefSchema,
    invert: z.boolean().optional(),
  }),
  chart: z.strictObject({
    type: z.literal('chart'),
    label: label.optional(),
    kind: z.enum(['bar', 'line']),
    series: computedSchema,
    reference: valueRefSchema.optional(),
  }),
  list: z.strictObject({
    type: z.literal('list'),
    collection: key,
    filter: whereSchema.optional(),
    primary: key,
    secondary: z.array(key).max(3).optional(),
    open: key.optional(),
    sort: sortField.optional(),
    swipe: z.strictObject({ label: label.optional(), set: valueMap }).optional(),
  }),
  'tag-filter': z.strictObject({ type: z.literal('tag-filter'), collection: key, field: key }),
  board: z.strictObject({
    type: z.literal('board'),
    collection: key,
    group_by: key,
    card: z.strictObject({ title: key, subtitle: key.optional(), image: key.optional(), badge: key.optional() }),
  }),
  'year-grid': z.strictObject({
    type: z.literal('year-grid'),
    collection: key,
    color_by: key.optional(),
    legend: z.boolean().optional(),
  }),
  'day-picker': z.strictObject({ type: z.literal('day-picker'), collection: key, field: key }),
  breakdown: z.strictObject({ type: z.literal('breakdown'), collection: key, field: key, range: range.optional() }),
  text: z.strictObject({ type: z.literal('text'), text: longText }),
} satisfies Record<(typeof BLOCK_TYPES)[number], z.ZodType>;

type BlockSchemas = typeof blockSchemas;
export type PluginBlock = { [K in keyof BlockSchemas]: z.infer<BlockSchemas[K]> }[keyof BlockSchemas];

const blockSchemaList = Object.values(blockSchemas) as unknown as [
  BlockSchemas[keyof BlockSchemas],
  ...BlockSchemas[keyof BlockSchemas][],
];
export const blockSchema = z.discriminatedUnion('type', blockSchemaList);

export const viewSchema = z.strictObject({
  id: key,
  label: label.optional(),
  blocks: z.array(blockSchema).min(1).max(30),
});
export type PluginView = z.infer<typeof viewSchema>;

// ─── Today ───────────────────────────────────────────────────────────────────

const widgetSchemas = {
  'mini-counter': z.strictObject({
    type: z.literal('mini-counter'),
    label,
    value: valueRefSchema,
    max: valueRefSchema.optional(),
    adds: key,
  }),
  'select-today': z.strictObject({ type: z.literal('select-today'), label, collection: key, field: key }),
  'count-badge': z.strictObject({ type: z.literal('count-badge'), label, value: valueRefSchema }),
  stat: z.strictObject({ type: z.literal('stat'), label, value: valueRefSchema, format: statFormat.optional() }),
} satisfies Record<(typeof TODAY_WIDGET_TYPES)[number], z.ZodType>;

type WidgetSchemas = typeof widgetSchemas;
export type TodayWidget = { [K in keyof WidgetSchemas]: z.infer<WidgetSchemas[K]> }[keyof WidgetSchemas];

const widgetSchemaList = Object.values(widgetSchemas) as unknown as [
  WidgetSchemas[keyof WidgetSchemas],
  ...WidgetSchemas[keyof WidgetSchemas][],
];

export const todaySchema = z.strictObject({
  default_on: z.boolean().optional(),
  widget: z.discriminatedUnion('type', widgetSchemaList),
});

// ─── Hooks and rules ─────────────────────────────────────────────────────────

const actionSchema = z.strictObject({ add: key, set: valueMap.optional() });

const promptHook = z
  .strictObject({
    on: z.enum(['pomodoro_end', 'day_end']),
    ask: label,
    yes: actionSchema.optional(),
    pick: z.strictObject({ collection: key, field: key }).optional(),
  })
  .refine((h) => (h.yes === undefined) !== (h.pick === undefined), { message: 'needs exactly one of yes or pick' });

const reportHook = z.strictObject({
  on: z.enum(['daily_report', 'weekly_report']),
  line: z.string().min(1).max(300),
});

export const hookSchema = z.union([promptHook, reportHook]);
export type PluginHook = z.infer<typeof hookSchema>;

// Compile-time guard: the two hook shapes cover every event.
const _hooksCovered: Record<(typeof HOOK_EVENTS)[number], true> = {
  pomodoro_end: true, day_end: true, daily_report: true, weekly_report: true,
};
void _hooksCovered;

export const ruleSchema = z.strictObject({
  collection: key,
  when: whereSchema,
  set: valueMap,
  only_if_empty: z.boolean().optional(),
});
export type PluginRule = z.infer<typeof ruleSchema>;

// ─── Migrations ──────────────────────────────────────────────────────────────
// How a breaking update carries existing records over. Steps run in order;
// collection names are the NEW ones (after any rename_collection).

export const migrateStepSchema = z.union([
  z.strictObject({ rename_collection: z.strictObject({ from: key, to: key }) }),
  z.strictObject({ rename_field: z.strictObject({ collection: key, from: key, to: key }) }),
  z.strictObject({ map_values: z.strictObject({ collection: key, field: key, map: z.record(key, key) }) }),
  z.strictObject({ drop_field: z.strictObject({ collection: key, field: key }) }),
]);
export type MigrateStep = z.infer<typeof migrateStepSchema>;

export const migrateSchema = z.strictObject({
  /** Major version this migration upgrades from, written `1.x`. */
  from: z.string().regex(/^(0|[1-9]\d*)\.x$/, 'must name the previous major version like 1.x'),
  steps: z.array(migrateStepSchema).min(1).max(30),
});
export type PluginMigrate = z.infer<typeof migrateSchema>;

// ─── The file ────────────────────────────────────────────────────────────────

export const manifestSchema = z.strictObject({
  schema_version: z.literal(PLUGIN_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,49}$/, 'must be lower-kebab-case: a-z, 0-9 and -, starting with a letter (2-50)'),
  name: label,
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'must be a semver version like 1.0.0'),
  icon: z.string().max(40).optional(),
  description: z.string().max(300).optional(),
  author: z.string().max(80).optional(),
  license: z.string().max(40).optional(),
  settings: z.array(settingSchema).max(30).optional(),
  collections: z.array(collectionSchema).min(1).max(20),
  computed: z.record(key, computedSchema).optional(),
  views: z.array(viewSchema).min(1).max(10),
  today: todaySchema.optional(),
  hooks: z.array(hookSchema).max(10).optional(),
  rules: z.array(ruleSchema).max(20).optional(),
  migrate: migrateSchema.optional(),
});
export type PluginManifest = z.infer<typeof manifestSchema>;
