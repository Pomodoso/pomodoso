// The closed catalog of everything a plugin file can name.
//
// A plugin is configuration, never code: it picks from these lists and the
// clients render it with built-in components. This is what keeps plugins
// inside the Chrome Web Store's MV3 policy ("all logic contained within the
// extension package") — so the format must never grow loops, user-defined
// functions or free-form expressions. Something missing becomes a new entry
// here, with its schema in manifest.ts and its renderer in each client.
//
// Everything else — the zod schema, the JSON Schema, the LLM reference — is
// derived from these lists, so adding an entry here is the only place a new
// capability starts.

export const PLUGIN_SCHEMA_VERSION = 1;

/** Upper bound on a plugin file, checked before parsing. */
export const PLUGIN_FILE_MAX_BYTES = 256 * 1024;

export const COLLECTION_KINDS = ['event', 'item', 'daily'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export const FIELD_TYPES = [
  'text',
  'longtext',
  'number',
  'scale',
  'boolean',
  'date',
  'url',
  'select',
  'multiselect',
  'tags',
  'rating',
  'duration',
  'image_url',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const SETTING_TYPES = ['number', 'text', 'boolean', 'select'] as const;
export type SettingType = (typeof SETTING_TYPES)[number];

export const BLOCK_TYPES = [
  'counter-button',
  'add-button',
  'form',
  'stat',
  'stat-row',
  'progress',
  'chart',
  'list',
  'tag-filter',
  'board',
  'year-grid',
  'day-picker',
  'breakdown',
  'text',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const TODAY_WIDGET_TYPES = ['mini-counter', 'select-today', 'count-badge', 'stat'] as const;
export type TodayWidgetType = (typeof TODAY_WIDGET_TYPES)[number];

export const COMPUTED_OPS = ['count', 'sum', 'avg', 'min', 'max', 'last', 'first', 'streak', 'taper', 'delta'] as const;
export type ComputedOp = (typeof COMPUTED_OPS)[number];

export const HOOK_EVENTS = ['pomodoro_end', 'day_end', 'daily_report', 'weekly_report'] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const STAT_FORMATS = ['number', 'time_ago', 'days', 'percent', 'duration', 'date'] as const;
export type StatFormat = (typeof STAT_FORMATS)[number];

export const GROUP_PERIODS = ['day', 'week', 'month'] as const;
export type GroupPeriod = (typeof GROUP_PERIODS)[number];

/** Named ranges. A rolling window is written `14d` or `12mo` (RANGE_PATTERN). */
export const NAMED_RANGES = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_year',
  'all',
] as const;
export type NamedRange = (typeof NAMED_RANGES)[number];
export const RANGE_PATTERN = /^[1-9][0-9]{0,2}(d|mo)$/;

/**
 * Values a plugin can read without declaring them. `$tab.*` comes from the
 * active tab's DOM (extension only); it never triggers a network call.
 */
export const BUILTIN_REFS = ['today_date', 'now', 'tab.url', 'tab.title'] as const;
export type BuiltinRef = (typeof BUILTIN_REFS)[number];
