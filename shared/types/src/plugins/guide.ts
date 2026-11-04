// Worked examples for the human docs (web /apps/docs). Every snippet runs on
// one small "playground" app, so the page can render each block, widget and
// hook live, with sample data. Typed as Record over the catalog lists like
// docs.ts: a new block, widget, hook or computed operator without an example
// here fails the typecheck, and guide.test.ts checks every example validates.

import { parse } from 'yaml';

import type { BlockType, ComputedOp, HookEvent, TodayWidgetType } from './catalog.ts';
import type { PluginRecord } from './compute.ts';
import { addDays } from './dates.ts';

/** The app every snippet runs on: water (event), books (item), mood (daily). */
export const GUIDE_PLAYGROUND = `schema_version: 1
id: docs-playground
name: Playground
version: 1.0.0
icon: star

settings:
  - { key: goal, type: number, label: Glasses a day, default: 8, min: 1 }

collections:
  - key: glass
    kind: event
    fields:
      - { key: size, type: number, unit: ml, default: 250, min: 0 }
      - { key: drink, type: select, options: [water, tea, coffee], default: water }
  - key: book
    kind: item
    title_field: title
    fields:
      - { key: title, type: text }
      - { key: author, type: text, optional: true }
      - { key: status, type: select, options: [to_read, reading, read], default: to_read }
      - { key: tags, type: tags, optional: true }
      - { key: rating, type: rating, optional: true }
      - { key: link, type: url, optional: true }
      - { key: cover, type: image_url, optional: true }
      - { key: finished_on, type: date, optional: true }
  - key: mood
    kind: daily
    fields:
      - key: mood
        type: select
        options:
          - { value: great, color: "#2D8A7A" }
          - { value: good, color: "#8CBF7A" }
          - { value: meh, color: "#E0B04A" }
          - { value: bad, color: "#C8553D" }

computed:
  today: { count: glass, range: today }
  week: { count: glass, range: this_week }
  last_week: { count: glass, range: last_week }
  week_change: { delta: [$week, $last_week] }
  last: { last: glass }
`;

export const GUIDE_BLOCK_EXAMPLES: Record<BlockType, string> = {
  'counter-button': `- type: counter-button
  label: Drank a glass
  adds: glass
  set: { drink: water }
  subtract: true            # a − button for a tap by mistake`,
  'add-button': `- type: add-button
  label: Save this page as a book
  adds: book
  prefill: { title: $tab.title, link: $tab.url, cover: $tab.image }`,
  form: `- type: form
  collection: book`,
  stat: `- type: stat
  label: Last glass
  value: $last
  format: time_ago`,
  'stat-row': `- type: stat-row
  items:
    - { label: Today, value: $today }
    - { label: This week, value: $week }
    - { label: vs last week, value: $week_change, format: percent }`,
  progress: `- type: progress
  label: Daily goal
  value: $today
  max: $goal
- type: progress
  label: Glasses today
  value: $today
  max: $goal
  style: dots               # bar (default), ring or dots; or a $setting`,
  chart: `- type: chart
  label: Last 14 days
  kind: bar
  series: { count: glass, group: day, range: 14d }
  reference: $goal`,
  list: `- type: list
  collection: book
  primary: title
  secondary: [author, status]
  sort: { field: created_at, order: desc }
  open: link
  swipe: { label: Mark read, set: { status: read } }`,
  'tag-filter': `- type: tag-filter
  collection: book
  field: tags
- type: list
  collection: book
  primary: title
  secondary: [tags]`,
  board: `- type: board
  collection: book
  group_by: status
  card: { title: title, subtitle: author, badge: rating }`,
  'year-grid': `- type: year-grid
  collection: mood
  color_by: mood
  legend: true`,
  'day-picker': `- type: day-picker
  collection: mood
  field: mood`,
  breakdown: `- type: breakdown
  collection: glass
  field: drink
  range: this_month`,
  text: `- type: text
  text: "{$today} of {$goal} glasses today. Keep going."`,
};

export const GUIDE_WIDGET_EXAMPLES: Record<TodayWidgetType, string> = {
  'mini-counter': `today:
  default_on: true
  widget: { type: mini-counter, label: Water, value: $today, max: $goal, adds: glass, subtract: true }`,
  'select-today': `today:
  widget: { type: select-today, label: Mood, collection: mood, field: mood, after: year-grid }`,
  'count-badge': `today:
  widget: { type: count-badge, label: This week, value: $week }`,
  stat: `today:
  widget: { type: stat, label: Last glass, value: $last, format: time_ago }`,
  progress: `computed:
  year_done: { calendar: year }
  days_left: { calendar: year, show: left }
today:
  widget:
    type: progress
    label: Year
    value: $year_done
    format: share
    caption: "{$days_left} days left"
    style: ring`,
  stats: `today:
  widget:
    type: stats
    label: Water
    items:
      - { label: Today, value: $today }
      - { label: This week, value: $week }
      - { label: vs last week, value: $week_change, format: percent }`,
};

export const GUIDE_HOOK_EXAMPLES: Record<HookEvent, string> = {
  pomodoro_end: `hooks:
  - on: pomodoro_end
    ask: Did you drink water during this break?
    yes: { add: glass }`,
  day_end: `hooks:
  - on: day_end
    ask: How was yesterday?
    pick: { collection: mood, field: mood }`,
  daily_report: `hooks:
  - on: daily_report
    line: "Water: {$today} of {$goal} glasses"`,
  weekly_report: `hooks:
  - on: weekly_report
    line: "{$week} glasses this week ({$week_change} vs last week)"`,
};

export const GUIDE_COMPUTED_EXAMPLES: Record<ComputedOp, string> = {
  count: `computed:
  tea_this_week: { count: glass, where: { drink: tea }, range: this_week }`,
  sum: `computed:
  ml_today: { sum: glass, field: size, range: today }`,
  avg: `computed:
  avg_size: { avg: glass, field: size, range: 30d }`,
  min: `computed:
  smallest: { min: glass, field: size }`,
  max: `computed:
  largest: { max: glass, field: size, range: this_month }`,
  last: `computed:
  last_read: { last: book, where: { status: read }, field: title }`,
  first: `computed:
  first_glass: { first: glass }`,
  streak: `computed:
  goal_streak: { streak: glass, at_least: $goal }`,
  taper: `computed:
  # 3 glasses the first week, one more every week, never above the goal
  ramp_up: { taper: { from: 3, up_by: 1, every: week, max: $goal } }`,
  delta: `computed:
  vs_last_week: { delta: [$week, $last_week] }`,
  calendar: `computed:
  year_done: { calendar: year }                  # 0.43 on day 158 of 365
  days_left: { calendar: year, show: left }`,
};

/** The walkthrough's finished file: a small water tracker, end to end. */
export const GUIDE_FIRST_APP = `schema_version: 1
id: my-water
name: Water
version: 1.0.0
icon: water
description: Count glasses of water against a daily goal.
author: You

settings:
  - { key: goal, type: number, label: Glasses a day, default: 8, min: 1 }

collections:
  - key: glass
    kind: event
    fields:
      - { key: size, type: number, unit: ml, default: 250, min: 0 }

computed:
  today: { count: glass, range: today }
  streak: { streak: glass, at_least: $goal }

views:
  - id: main
    blocks:
      - { type: counter-button, label: Drank a glass, adds: glass }
      - { type: progress, label: Today, value: $today, max: $goal }
      - { type: stat, label: Days on goal, value: $streak, format: days }
      - type: chart
        label: Last 14 days
        kind: bar
        series: { count: glass, group: day, range: 14d }
        reference: $goal

today:
  default_on: true
  widget: { type: mini-counter, label: Water, value: $today, max: $goal, adds: glass }

hooks:
  - on: pomodoro_end
    ask: Did you drink water during this break?
    yes: { add: glass }
  - on: daily_report
    line: "Water: {$today} of {$goal} glasses"
`;

const DEFAULT_VIEW = [{ type: 'stat', label: 'Glasses today', value: '$today' }];

/**
 * The playground with one example plugged in: `blocks` becomes its only view,
 * `today` / `hooks` are added, `computed` entries join the playground's.
 */
export function guideManifestData(part: { blocks?: string; today?: string; hooks?: string; computed?: string }): Record<string, unknown> {
  const data = parse(GUIDE_PLAYGROUND) as Record<string, unknown>;
  data.views = [{ id: 'main', blocks: part.blocks ? parse(part.blocks) : DEFAULT_VIEW }];
  // A snippet may bring computed values of its own: they join the playground's.
  const merge = (snippet: string) => {
    const { computed, ...rest } = parse(snippet) as Record<string, unknown>;
    Object.assign(data, rest);
    if (computed) data.computed = { ...(data.computed as Record<string, unknown>), ...(computed as Record<string, unknown>) };
  };
  if (part.today) merge(part.today);
  if (part.hooks) merge(part.hooks);
  if (part.computed) {
    const extra = (parse(part.computed) as { computed: Record<string, unknown> }).computed;
    data.computed = { ...(data.computed as Record<string, unknown>), ...extra };
    // Show the new values, so the preview has something to say.
    data.views = [{ id: 'main', blocks: Object.keys(extra).map((k) => ({ type: 'stat', label: k, value: `$${k}` })) }];
  }
  return data;
}

/** Sample records for the playground, ending on `today` (YYYY-MM-DD). Deterministic. */
export function guideSeedRecords(today: string): PluginRecord[] {
  const out: PluginRecord[] = [];
  const drinks = ['water', 'water', 'tea', 'water', 'coffee'];
  for (let back = 20; back >= 0; back--) {
    const day = addDays(today, -back);
    const n = back === 0 ? 3 : 4 + ((back * 7) % 6);
    for (let i = 0; i < n; i++) {
      const at = `${day}T${String(8 + i).padStart(2, '0')}:15:00.000Z`;
      out.push({ id: `seed-glass-${back}-${i}`, collection: 'glass', occurred_at: at, created_at: at, updated_at: at, data: { size: i % 3 === 0 ? 330 : 250, drink: drinks[(back + i) % drinks.length] } });
    }
  }
  const books = [
    { title: 'The Pragmatic Programmer', author: 'Hunt & Thomas', status: 'read', tags: ['tech'], rating: 5 },
    { title: 'Deep Work', author: 'Cal Newport', status: 'read', tags: ['focus'], rating: 4 },
    { title: 'Piranesi', author: 'Susanna Clarke', status: 'reading', tags: ['fiction'] },
    { title: 'Four Thousand Weeks', author: 'Oliver Burkeman', status: 'to_read', tags: ['focus'] },
    { title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', status: 'to_read', tags: ['tech'] },
  ];
  books.forEach((b, i) => {
    const at = `${addDays(today, -30 + i * 5)}T10:00:00.000Z`;
    out.push({ id: `seed-book-${i}`, collection: 'book', created_at: at, updated_at: at, data: b });
  });
  const moods = ['great', 'good', 'good', 'meh', 'good', 'great', 'bad', 'good'];
  for (let back = 120; back >= 1; back--) {
    if (back % 9 === 4) continue; // a few days left blank
    const day = addDays(today, -back);
    const at = `${day}T21:00:00.000Z`;
    out.push({ id: `seed-mood-${back}`, collection: 'mood', day, created_at: at, updated_at: at, data: { mood: moods[(back * 5) % moods.length] } });
  }
  return out;
}
