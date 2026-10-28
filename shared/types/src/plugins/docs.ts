// One-line meaning of every catalog entry, for the generated references
// (llms.txt, llms-full.txt). Typed as Record over the catalog lists, so a
// new block, field type, operator or hook that isn't described here fails
// the typecheck — the docs can't fall behind the format.

import type {
  BlockType,
  CollectionKind,
  ComputedOp,
  FieldType,
  HookEvent,
  StatFormat,
  TodayWidgetType,
} from './catalog.ts';

export const COLLECTION_DOCS: Record<CollectionKind, string> = {
  event: 'Things that happen at a moment: a cigarette, a glass of water. Each record gets `occurred_at`.',
  item: 'Things you keep and update: a book, a link. Records have no date of their own beyond `created_at`.',
  daily: 'One record per day: a mood, a day state. Records have a `day`; saving the same day again updates it.',
};

export const FIELD_DOCS: Record<FieldType, string> = {
  text: 'One line of text.',
  longtext: 'Multi-line text (notes).',
  number: 'A number; `min`, `max` and `unit` are optional.',
  scale: 'A number picked from a short range (default 1–5), shown as buttons.',
  boolean: 'Yes / no, shown as a checkbox.',
  date: 'A calendar day, YYYY-MM-DD.',
  url: 'A link.',
  select: 'One option from `options`. Add `user_editable: true` to let the user rename, recolor and add options.',
  multiselect: 'Several options from `options`.',
  tags: 'Free-form tags, typed comma-separated. No `options`.',
  rating: 'Stars (default 1–5).',
  duration: 'Minutes.',
  image_url: 'An image link (https), shown as a cover in boards.',
};

export const COMPUTED_DOCS: Record<ComputedOp, string> = {
  count: 'How many records match. Optional `where`, `range`, `by` (the date field the range applies to) and `group` (day | week | month, which makes it a series for charts).',
  sum: 'Sum of a numeric `field` over the matching records. Same options as count.',
  avg: 'Average of a numeric `field`. Same options as count.',
  min: 'Smallest value of a numeric `field`. Same options as count.',
  max: 'Largest value of a numeric `field`. Same options as count.',
  last: 'The most recent record (or its `field`). Optional `where`.',
  first: 'The oldest record (or its `field`). Optional `where`.',
  streak: 'Consecutive days, ending today, with a count within `at_least` / `at_most`. Optional `where`.',
  taper: 'A value that changes by a step every period since install: `from`, `down_by` or `up_by`, `every` (day | week | month), optional `min` / `max`. For limits that tighten over time.',
  delta: 'Relative change between two values, `[a, b]` → (a − b) / b. Reads as a percent in templates.',
};

export const BLOCK_DOCS: Record<BlockType, string> = {
  'counter-button': 'A big button that adds a record to an event collection in one tap. `set` fills fields; `details: form` opens a form instead.',
  'add-button': 'A button that opens a form to add an item. `prefill` can use `$tab.url` / `$tab.title` (the current page).',
  form: 'An inline form for a collection. On a daily collection it edits today.',
  stat: 'One number or value with a label. `format` says how it reads.',
  'stat-row': 'Up to four stats side by side.',
  progress: 'A bar of `value` against `max`. `invert: true` for limits (going over is bad).',
  chart: 'A bar or line chart of a grouped series (`count` / `sum` / … with `group`). Optional dashed `reference` line.',
  list: 'Records as rows: `primary` field, up to three `secondary` ones, optional `filter`, `sort`, `open` (a url field) and a `swipe` action that sets fields.',
  'tag-filter': 'Chips that filter the lists and boards of the same view by a tags, multiselect or select field.',
  board: 'Items grouped in columns by a select field (`group_by`), as cards with title, subtitle, image and badge.',
  'year-grid': 'Every day of the year as a colored cell (like a contribution graph), colored by a select field.',
  'day-picker': 'Pick a select value for today, or move to other days.',
  breakdown: 'How many records have each option of a select, multiselect or tags field, as bars.',
  text: 'A paragraph; `{$name}` inside it is replaced by the value.',
};

export const WIDGET_DOCS: Record<TodayWidgetType, string> = {
  'mini-counter': 'A number with a + button that adds to an event collection (`adds`). Optional `max`.',
  'select-today': "Option chips that set today's value of a daily collection's select field.",
  'count-badge': 'A single number.',
  stat: 'A single value with a `format`.',
};

export const HOOK_DOCS: Record<HookEvent, string> = {
  pomodoro_end: 'After a pomodoro, during the break: `ask` a question; `yes` adds a record, or `pick` sets a select on today. At most one plugin question per break.',
  day_end: 'The next day: `ask` about yesterday, with `yes` or `pick`.',
  daily_report: "A `line` added to the daily report, with `{$name}` values.",
  weekly_report: 'A `line` added to the weekly report.',
};

export const FORMAT_DOCS: Record<StatFormat, string> = {
  number: '12, 2.5',
  time_ago: '3h 20m ago (for timestamps such as `last`)',
  days: '8 days',
  percent: '+20%, −34% (for fractions such as `delta`)',
  duration: '1h 35m (minutes)',
  date: 'Oct 21, 2026',
};
