// The plugin references for LLMs, generated: llms.txt (a short index) and
// llms-full.txt (everything needed to write a valid plugin in one go). The
// catalog lists, the descriptions in docs.ts and the JSON Schema (itself
// generated from the zod schema) are the only inputs, so the references
// can't drift from what the validator accepts. A test fails when the
// committed files are stale (run gen:llms).

import { BUILTIN_REFS, COLLECTION_KINDS, FIELD_TYPES, NAMED_RANGES, PLUGIN_FILE_MAX_BYTES, RANGE_PATTERN, STAT_FORMATS } from './catalog.ts';
import { BLOCK_DOCS, COLLECTION_DOCS, COMPUTED_DOCS, FIELD_DOCS, FORMAT_DOCS, HOOK_DOCS, WIDGET_DOCS } from './docs.ts';
import { PLUGIN_JSON_SCHEMA_URL, pluginJsonSchema } from './json-schema.ts';

type Schema = Record<string, unknown>;

const KEY_PATTERN = '^[a-z][a-z0-9_]{0,39}$';

/** What a top-level key is for. Checked against the schema by a test. */
export const TOP_LEVEL_DOCS: Record<string, string> = {
  schema_version: 'Always `1`.',
  id: 'The plugin id, lower-kebab-case (`quit-smoking`). It never changes between versions.',
  name: 'Shown in the app list.',
  version: 'Semver, `1.0.0`. A breaking change needs a new major and a `migrate` block.',
  icon: 'One word: book, film, grid, no-smoking, water, coffee, run, heart, mood, sleep, money, music, game, plant, pill, food, star, check, calendar, pen, link, code, brain, dumbbell. Anything else shows the initial.',
  description: 'One sentence.',
  author: 'Your name.',
  license: 'Default MIT.',
  settings: 'Values the user sets on install (a starting limit, a goal). Readable as `$key`.',
  collections: 'What the plugin stores. Each has a `key`, a `kind` and `fields`.',
  computed: 'Named values calculated from the records, readable as `$name`.',
  views: 'The screens of the plugin, each a list of blocks.',
  today: 'Optional widget for the Today tab; the user switches it on. `default_on` suggests a starting state.',
  hooks: 'Optional questions after pomodoros or at day end, and lines in reports.',
  rules: 'Fields set automatically when a record starts matching `when` (stamp a date when a book becomes read). `only_if_empty` keeps a value the user set.',
  migrate: 'How a breaking update carries existing records over: `from: "1.x"` and `steps` (rename_collection, rename_field, map_values, drop_field).',
};

function isKeyPattern(s: Schema): boolean {
  return s.type === 'string' && s.pattern === KEY_PATTERN;
}

/** A branch that only constrains (`{ required: [...] }` from a refinement), not a type. */
const isConstraint = (s: Schema) => !('type' in s || 'const' in s || 'enum' in s || 'pattern' in s || '$ref' in s || 'properties' in s || 'anyOf' in s || 'oneOf' in s);

/** A schema node as a short type: key, text, number, value, list of …, map, a | b. */
function typeOf(s: Schema | undefined): string {
  if (!s) return 'any';
  // The only $defs are the (recursive) computed value.
  if (typeof s.$ref === 'string') return 'computed value';
  if ('const' in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).join(' | ');
  if (typeof s.pattern === 'string' && !('type' in s)) return s.pattern === RANGE_PATTERN.source ? 'a rolling window like 14d or 12mo' : 'text';
  const union = ((s.anyOf ?? s.oneOf) as Schema[] | undefined)?.filter((b) => !isConstraint(b));
  if (union?.length) {
    const parts = union.map(typeOf);
    if (parts.includes('computed value') || (parts.includes('number') && parts.includes('$reference'))) return 'value (number, $reference or computed)';
    return [...new Set(parts)].join(' | ');
  }
  if (isKeyPattern(s)) return 'key';
  if (s.type === 'string' && typeof s.pattern === 'string' && s.pattern.startsWith('^\\$')) return '$reference';
  if (s.type === 'array' && Array.isArray(s.prefixItems)) return `[${(s.prefixItems as Schema[]).map(typeOf).join(', ')}]`;
  if (s.type === 'array') return `list of ${typeOf(s.items as Schema)}`;
  if (s.type === 'object' && s.properties) return 'object';
  if (s.type === 'object') return `map of key → ${typeOf(s.additionalProperties as Schema)}`;
  if (s.type === 'string') return 'text';
  if (s.type === 'boolean') return 'true | false';
  if (s.type === 'number' || s.type === 'integer') return 'number';
  return 'any';
}

/**
 * `- name (required): type` for each property, `type` itself left out. An
 * object property lists its own properties one level deeper.
 */
function props(s: Schema, skip: string[] = ['type'], indent = '  '): string[] {
  const required = new Set((s.required as string[] | undefined) ?? []);
  return Object.entries((s.properties ?? {}) as Record<string, Schema>)
    .filter(([k]) => !skip.includes(k))
    .flatMap(([k, v]) => [
      `${indent}- \`${k}\`${required.has(k) ? ' (required)' : ''}: ${typeOf(v)}`,
      ...(v.type === 'object' && v.properties ? props(v, [], `${indent}  `) : []),
    ]);
}

function branches(s: Schema): Schema[] {
  return ((s.oneOf ?? s.anyOf) as Schema[] | undefined) ?? [];
}

function constType(s: Schema): string {
  return String(((s.properties as Record<string, Schema>).type as Schema).const);
}

export function llmsTxt(): string {
  return `# Pomodoso plugins

> A Pomodoso plugin is one YAML file that becomes a small app inside Pomodoso: its own screen, the records it keeps, and optionally a widget on Today, a question after pomodoros and a line in reports. Plugins are configuration, never code: they combine a closed set of blocks and computed values.

- Write the whole file at once, then validate it against the JSON Schema.
- Every key is lower_snake_case except the plugin \`id\` (lower-kebab-case).
- Read a value with \`$name\`; put one in text with \`{$name}\`.
- Only use the blocks, field types and operators listed in the full reference.

## Reference

- [Full reference with every block, field type, computed value, hook and five complete examples](/llms-full.txt)
- [JSON Schema](${PLUGIN_JSON_SCHEMA_URL})

## Blocks

${Object.keys(BLOCK_DOCS).map((b) => `- \`${b}\``).join('\n')}
`;
}

export function llmsFullTxt(examples: Record<string, string>): string {
  const schema = pluginJsonSchema() as Schema;
  const top = schema.properties as Record<string, Schema>;
  const required = new Set(schema.required as string[]);
  const views = top.views as Schema;
  const blockSchemas = branches(((((views.items as Schema).properties as Record<string, Schema>).blocks as Schema).items as Schema));
  const widgetSchemas = branches(((top.today as Schema).properties as Record<string, Schema>).widget as Schema);
  const computedSchemas = branches(((schema.$defs as Record<string, Schema>).ComputedValue) as Schema);
  const field = ((((top.collections as Schema).items as Schema).properties as Record<string, Schema>).fields as Schema).items as Schema;
  const setting = (top.settings as Schema).items as Schema;

  const out: string[] = [];
  out.push(`# Pomodoso plugins — full reference

A plugin is one YAML file. Pomodoso validates it, stores it, and renders it with built-in components: the file can't run code, load scripts or call other services. Anything the format can't express doesn't exist yet — don't invent keys or block types.

## Rules that matter

- Keys (collections, fields, settings, computed, views) are lower_snake_case, up to 40 characters, starting with a letter. The plugin \`id\` is lower-kebab-case.
- Read a value anywhere a value goes with \`$name\`: a setting, a computed value or a built-in (${BUILTIN_REFS.map((r) => `\`$${r}\``).join(', ')}). \`$tab.*\` only works in an add-button's \`prefill\`.
- Put a value inside a label or text with \`{$name}\`.
- A one-tap action (counter-button, mini-counter, hook \`yes\`, day picks) has no form, so every required field of its collection must be optional, have a \`default\`, or be set by the action.
- Literal values must fit their field: numbers within min/max, select values from \`options\`.
- The file is at most ${PLUGIN_FILE_MAX_BYTES / 1024} KB.
- Validate against ${PLUGIN_JSON_SCHEMA_URL}; Pomodoso also checks that every collection, field and \`$reference\` you name exists, and says what's available when one doesn't.

## The file`);
  for (const [k, v] of Object.entries(top)) {
    out.push(`- \`${k}\`${required.has(k) ? ' (required)' : ''}: ${typeOf(v)}. ${TOP_LEVEL_DOCS[k] ?? ''}`.trimEnd());
  }

  out.push('\n## Settings\n\nEach setting:');
  out.push(...props(setting, []));

  out.push('\n## Collections\n');
  for (const k of COLLECTION_KINDS) out.push(`- \`${k}\`: ${COLLECTION_DOCS[k]}`);
  out.push('\nEach field:');
  out.push(...props(field, []));
  out.push('\nField types:\n');
  for (const t of FIELD_TYPES) out.push(`- \`${t}\`: ${FIELD_DOCS[t]}`);

  out.push(`\n## Computed values

Each entry under \`computed\` has exactly one operator key, which names the collection (or holds the operator's settings). They can reference each other with \`$name\`, without cycles.

Ranges: ${NAMED_RANGES.map((r) => `\`${r}\``).join(', ')}, or a rolling window like \`14d\` or \`12mo\`.
`);
  for (const s of computedSchemas) {
    const op = Object.keys((s.properties ?? {}) as Schema)[0] as keyof typeof COMPUTED_DOCS;
    out.push(`### \`${op}\`\n\n${COMPUTED_DOCS[op]}\n`);
    out.push(...props(s, []));
    out.push('');
  }

  out.push('## Views and blocks\n\nEach view has an `id`, an optional `label` (the tab name) and `blocks`, shown top to bottom.\n');
  for (const s of blockSchemas) {
    const type = constType(s) as keyof typeof BLOCK_DOCS;
    out.push(`### \`${type}\`\n\n${BLOCK_DOCS[type]}\n`);
    out.push(...props(s));
    out.push('');
  }

  out.push('## Today widget\n\n`today: { default_on: true | false, widget: … }`\n');
  for (const s of widgetSchemas) {
    const type = constType(s) as keyof typeof WIDGET_DOCS;
    out.push(`### \`${type}\`\n\n${WIDGET_DOCS[type]}\n`);
    out.push(...props(s));
    out.push('');
  }

  out.push('## Hooks\n');
  for (const [k, v] of Object.entries(HOOK_DOCS)) out.push(`- \`${k}\`: ${v}`);
  for (const h of branches((top.hooks as Schema).items as Schema)) {
    const on = (((h.properties as Record<string, Schema>).on as Schema).enum as string[]).join(' / ');
    out.push(`\nA ${on} hook:`);
    out.push(...props(h, []));
  }
  out.push('\nA prompt hook takes exactly one of `yes` or `pick`.');

  out.push('\n## Stat formats\n');
  for (const f of STAT_FORMATS) out.push(`- \`${f}\`: ${FORMAT_DOCS[f]}`);

  out.push(`
## Common mistakes

- Inventing a block type (\`kanban\`, \`calendar\`): use \`board\` or \`year-grid\`. The error lists what's available.
- A counter-button on a collection with a required field and no \`set\` or \`default\` for it.
- Writing a reference without \`$\` (\`value: today\` instead of \`value: $today\`).
- A chart series without \`group\`: charts need \`count\` / \`sum\` / \`avg\` / \`min\` / \`max\` with \`group: day | week | month\`.
- \`options\` on a field that isn't select or multiselect (tags take no options).
- Naming a setting or computed value \`now\` or \`today_date\` (built in).
- A breaking change (renaming or removing a field, collection or option, changing a type) without a new major version and a \`migrate\` block.

## Complete examples
`);
  for (const [name, text] of Object.entries(examples)) {
    out.push(`### ${name}\n\n\`\`\`yaml\n${text.trimEnd()}\n\`\`\`\n`);
  }
  return out.join('\n');
}

// ─── Prompts ─────────────────────────────────────────────────────────────────
// Copy buttons in the docs and on each directory page. Both point the model
// at the full reference and the validator, which is what makes the first
// answer valid.

/** For "Build a plugin": the user fills in the idea. */
export const STARTER_PROMPT = `Write a Pomodoso plugin: one YAML file that becomes a small app inside Pomodoso.

What I want it to do: <describe what you want to track or keep>

Before writing, read https://pomodoso.com/llms-full.txt and use only the blocks, field types and computed values it lists. Start from the closest of its examples. Write the whole file, then check it with \`npx @pomodoso/plugin validate <file>\` (or against https://pomodoso.com/schema/plugin.v1.json) and fix every problem it reports. Give me the final file and a short summary of what it shows and stores.`;

/** For a directory page: change an existing plugin into the user's own. */
export function remixPrompt(file: string): string {
  return `Here is a Pomodoso plugin. I want to adapt it.

What I want to change: <describe the change>

Keep the format: read https://pomodoso.com/llms-full.txt and use only what it lists. Give the result a new \`id\` and \`name\` (it's a new plugin, not an update), keep \`license\` and credit the original author in \`description\`. Validate the result with \`npx @pomodoso/plugin validate <file>\` and fix every problem before giving me the file.

\`\`\`yaml
${file.trimEnd()}
\`\`\`
`;
}
