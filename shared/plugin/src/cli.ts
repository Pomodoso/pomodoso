// pomodoso-plugin: validate a plugin file, and classify an update against
// the published version, with the same code Pomodoso runs on install and on
// publish. Built for people and for agents: readable output by default,
// `--json` for tools, exit code 1 when the file can't be used.
//
//   pomodoso-plugin validate my-plugin.yaml
//   pomodoso-plugin validate my-plugin.yaml --against previous.yaml
//   pomodoso-plugin validate my-plugin.yaml --against https://…/versions/1.2.0 --json

import { readFileSync } from 'node:fs';

import { checkUpdate, parsePluginFile, type PluginIssue, type PluginManifest, type UpdateReport } from '@pomodoso/types/plugins';

export interface ValidateResult {
  ok: boolean;
  issues: PluginIssue[];
  /** With --against: how this version differs from the other one. */
  update?: Pick<UpdateReport, 'kind' | 'changes' | 'issues' | 'migrates'> | undefined;
}

const USAGE = `Usage: pomodoso-plugin validate <file> [--against <file or URL>] [--json]

  validate     Check a plugin file the way Pomodoso does.
  --against    Compare with a previous version (a file, or a URL that serves
               the file as YAML or JSON) and say whether the update is
               additive or breaking, and what a breaking one still needs.
  --json       Print the result as JSON.

Exit code: 0 when the file is valid (and, with --against, publishable as an
update), 1 otherwise, 2 on a usage error.`;

async function readSource(source: string): Promise<string> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
    return res.text();
  }
  return readFileSync(source, 'utf8');
}

/** Validates `text` and, when `previous` is given, the update from it. */
export function validate(text: string, previous?: string): ValidateResult {
  const parsed = parsePluginFile(text);
  if (!parsed.ok) return { ok: false, issues: parsed.issues };
  if (previous === undefined) return { ok: true, issues: [] };
  const prev = parsePluginFile(previous);
  if (!prev.ok) {
    return { ok: false, issues: prev.issues.map((i) => ({ ...i, message: `the previous version is invalid: ${i.message}` })) };
  }
  const report = checkUpdate(prev.manifest, parsed.manifest as PluginManifest);
  const update = { kind: report.kind, changes: report.changes, issues: report.issues, migrates: report.migrates };
  return { ok: report.issues.length === 0, issues: [], update };
}

function where(i: PluginIssue): string {
  const at = i.path || '(file)';
  return i.line !== undefined ? `${at} (line ${i.line})` : at;
}

export function format(file: string, r: ValidateResult): string {
  const out: string[] = [];
  if (r.issues.length > 0) {
    out.push(`✗ ${file}: ${r.issues.length} problem${r.issues.length === 1 ? '' : 's'}`);
    for (const i of r.issues) out.push(`  ${where(i)}: ${i.message}`);
    return out.join('\n');
  }
  out.push(`✓ ${file} is a valid plugin file`);
  if (r.update) {
    out.push(`  update: ${r.update.kind}${r.update.migrates ? ' (runs its migrate block)' : ''}`);
    for (const c of r.update.changes) out.push(`  ${c.kind === 'breaking' ? '!' : '+'} ${c.path}: ${c.message}`);
    if (r.update.issues.length > 0) {
      out.push(`✗ not publishable as an update:`);
      for (const i of r.update.issues) out.push(`  ${i.path}: ${i.message}`);
    }
  }
  return out.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  const json = rest.includes('--json');
  const againstAt = rest.indexOf('--against');
  const against = againstAt === -1 ? undefined : rest[againstAt + 1];
  if (command !== 'validate' || !file || (againstAt !== -1 && !against)) {
    console.error(USAGE);
    return 2;
  }
  let result: ValidateResult;
  try {
    result = validate(await readSource(file), against === undefined ? undefined : await readSource(against));
  } catch (err) {
    result = { ok: false, issues: [{ path: '', message: (err as Error).message }] };
  }
  console.log(json ? JSON.stringify(result, null, 2) : format(file, result));
  return result.ok ? 0 : 1;
}

// Run when executed (bin or `node src/cli.ts`), not when imported by tests.
if (process.argv[1] && /cli\.(ts|cjs)$/.test(process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
