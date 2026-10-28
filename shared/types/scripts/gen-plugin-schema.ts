// Regenerates schema/plugin.v1.json from the zod schema, plus the copy the
// backend embeds (backend/schema/; its Docker build only sees backend/).
// Run: pnpm --filter @pomodoso/types gen:plugin-schema
import { mkdirSync, writeFileSync } from 'node:fs';

import { pluginJsonSchema } from '../src/plugins/json-schema.ts';

const text = JSON.stringify(pluginJsonSchema(), null, 2) + '\n';
for (const path of ['../schema/plugin.v1.json', '../../../backend/schema/plugin.v1.json']) {
  const out = new URL(path, import.meta.url);
  mkdirSync(new URL('.', out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${out.pathname}`);
}
