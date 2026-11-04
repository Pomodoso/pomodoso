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
  ref: 'A record of another item collection (`collection`) this one belongs to: a card of an issue, a note of a book. Picked from a list; shows its title. Deleting that record deletes the ones that point to it.',
  task: "A task from the user's Pomodoso task list, picked from them. The app stores only its id and shows its title; the task shows the record back, to open it. Apps can't read or change tasks.",
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
  ratio: 'One value divided by another, `[a, b]` → a / b: pages per day, cost per item. Empty when b is 0.',
  calendar: 'How far the current `week`, `month` or `year` has gone, from the date alone (no collection). `show`: `progress` (default, a fraction: 0.43 on day 158 of 365), `passed` (days so far, today included), `left` (days after today) or `total` (days in the period).',
};

export const BLOCK_DOCS: Record<BlockType, string> = {
  'counter-button': 'A big button that adds a record to an event collection in one tap. `set` fills fields; `details: form` opens a form instead. `subtract: true` adds a − button that deletes the latest one from today (a tap by mistake).',
  'add-button': 'A button that opens a form to add an item. `prefill` can use `$tab.url`, `$tab.title` and `$tab.image` (the current page and its preview image), so one tap saves the page you are on.',
  form: 'An inline form for a collection. On a daily collection it edits today. On an event collection it also asks "When" (now by default), to log one you forgot.',
  stat: 'One number or value with a label. `format` says how it reads.',
  'stat-row': 'Up to four stats side by side.',
  progress: 'A bar of `value` against `max`. `invert: true` for limits (going over is bad). `format` says how the numbers read (`share` shows only the percent). `style`: `bar` (default), `ring` (a ring of dots) or `dots` (one dot per unit when `max` is a whole number up to 400, like the days of a year); it can be a `$setting` so the user picks.',
  chart: 'A bar or line chart of a grouped series (`count` / `sum` / … with `group`). Optional dashed `reference` line.',
  list: 'Records as rows: `primary` field, up to three `secondary` ones, optional `filter`, `sort`, `open` (a url field), a `swipe` action that sets fields, and `opens` (a view with `of` this collection: tapping a row opens that record\'s screen).',
  'tag-filter': 'Chips that filter the lists and boards of the same view by a tags, multiselect or select field.',
  board: 'Items grouped in columns by a select field (`group_by`), as cards with title, subtitle, image and badge; optional `filter` (in a record\'s screen, `{ issue: $record }` shows its cards) and `opens`. Full width (`layout: wide`) the columns sit side by side, cards drag between them and each column has its own add.',
  'year-grid': 'Every day of the year as a colored cell (like a contribution graph), colored by a select field.',
  'day-picker': 'Pick a select value for today, or move to other days.',
  breakdown: 'How many records have each option of a select, multiselect or tags field, as bars.',
  text: 'A paragraph; `{$name}` inside it is replaced by the value.',
};

export const WIDGET_DOCS: Record<TodayWidgetType, string> = {
  'mini-counter': 'A number with a + button that adds to an event collection (`adds`). Optional `max`; `subtract: true` adds a − button that deletes the latest one from today.',
  'select-today': "Option chips that set today's value of a daily collection's select field. `after: year-grid` shows the year in pixels (colored by that field) once today is set, with a Change link to pick again.",
  'count-badge': 'A single number.',
  stat: 'A single value with a `format`.',
  progress: 'A bar of `value` against `max` (default 1), with an optional `format`, a `caption` line under it (`{$name}` works) and a `style` (`bar`, `ring` or `dots`, or a `$setting`). Ring and dots take the whole row.',
  record: 'The latest item of a collection matching `where` (the book you are reading), by its `title` field, with a number `field` you edit right on the card (the page you are on), against an optional `max` field (its pages, as a bar). Optional `caption` line with `{$name}` values.',
  list: 'The records of a collection matching `where` as rows (the open issues), each opening its screen (`opens`, a view with `of`), with an optional `badge` per row (a value that reads the row as `$record`: its open cards) and one `more` row opening a view of the app (the cards with no issue). Takes the whole row on Today.',
  stats: 'Up to four values, two per row, each with its `label` and optional `format` (`items`). Fits half a row on Today, like the other widgets.',
};

export const HOOK_DOCS: Record<HookEvent, string> = {
  pomodoro_end: 'After a pomodoro, during the break: `ask` a question; `yes` adds a record to an event collection, or `pick` sets a select on today. At most one plugin question per break.',
  day_end: 'The next day: `ask` about yesterday, with `yes` (adds a record to an event collection, dated yesterday) or `pick` (sets a select on yesterday\'s daily record).',
  daily_report: "A `line` added to the daily report, with `{$name}` values.",
  weekly_report: 'A `line` added to the weekly report.',
};

export const FORMAT_DOCS: Record<StatFormat, string> = {
  number: '12, 2.5',
  time_ago: '3h 20m ago (for timestamps such as `last`)',
  days: '8 days',
  percent: '+20%, −34% (for fractions such as `delta`)',
  share: '43.3%: a fraction as a plain percent (`calendar` progress). In a progress block or widget, the value as a share of `max` (158 of 365 reads 43.3%).',
  duration: '1h 35m (minutes)',
  date: 'Oct 21, 2026',
};
