// Regenerates schema/plugin.v1.json from the zod schema.
// Run: pnpm --filter @pomodoso/types gen:plugin-schema
import { writeFileSync } from 'node:fs';

import { pluginJsonSchema } from '../src/plugins/json-schema.ts';

const out = new URL('../schema/plugin.v1.json', import.meta.url);
writeFileSync(out, JSON.stringify(pluginJsonSchema(), null, 2) + '\n');
console.log(`wrote ${out.pathname}`);
