// The plugin file format as JSON Schema, generated from the zod schema so the
// two can't drift. Editors use it for autocompletion, LLMs to check their own
// output, and the Rust backend to validate on publish.
//
// It covers shape only: cross-references (does `adds: book` exist?) live in
// check.ts, so a file can pass the JSON Schema and still fail
// parsePluginFile. parsePluginFile is the real validator.

import { PLUGIN_SCHEMA_VERSION } from './catalog.ts';
import { manifestSchema } from './manifest.ts';
import { z } from './zod.ts';

export const PLUGIN_JSON_SCHEMA_URL = `https://pomodoso.com/schema/plugin.v${PLUGIN_SCHEMA_VERSION}.json`;

export function pluginJsonSchema(): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(manifestSchema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  return {
    $schema,
    $id: PLUGIN_JSON_SCHEMA_URL,
    title: 'Pomodoso plugin',
    description:
      'A Pomodoso plugin file (YAML). Shape only: references between collections, fields and $values are checked by Pomodoso on load.',
    ...rest,
  };
}
