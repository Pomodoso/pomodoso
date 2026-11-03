// Regenerates the LLM references served by the web app (web/public/llms.txt
// and llms-full.txt) from the catalog, docs.ts and the JSON Schema.
// Run: pnpm --filter @pomodoso/types gen:llms
import { readFileSync, writeFileSync } from 'node:fs';

import { LLM_EXAMPLES } from '../src/plugins/llms-examples.ts';
import { llmsFullTxt, llmsTxt } from '../src/plugins/llms.ts';

const examples = Object.fromEntries(LLM_EXAMPLES.map((n) => [n, readFileSync(new URL(`../src/plugins/examples/${n}.yaml`, import.meta.url), 'utf8')]));
const outputs: [string, string][] = [
  ['../../../web/public/llms.txt', llmsTxt()],
  ['../../../web/public/llms-full.txt', llmsFullTxt(examples)],
];
for (const [path, text] of outputs) {
  const out = new URL(path, import.meta.url);
  writeFileSync(out, text);
  console.log(`wrote ${out.pathname}`);
}
