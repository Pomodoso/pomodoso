// From the text of a plugin file to a validated manifest, or to issues that
// say exactly what to fix. Same function on every client and in the
// directory, so "valid" means one thing everywhere.

import { parseDocument } from 'yaml';
import type { z } from './zod.ts';

import { COMPUTED_OPS, PLUGIN_FILE_MAX_BYTES } from './catalog.ts';
import { checkManifest } from './check.ts';
import { didYouMean, formatPath, type PluginIssue } from './issues.ts';
import { manifestSchema, type PluginManifest } from './manifest.ts';

export type PluginParseResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; issues: PluginIssue[] };

type ZodIssue = z.core.$ZodIssue;

export function parsePluginFile(text: string): PluginParseResult {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > PLUGIN_FILE_MAX_BYTES) {
    return { ok: false, issues: [{ path: '', message: `file is ${bytes} bytes; the limit is ${PLUGIN_FILE_MAX_BYTES}` }] };
  }

  // Aliases are capped against "billion laughs" files. Unknown tags (`!!js/…`)
  // come back as warnings and are treated as errors: a plugin is plain data.
  const doc = parseDocument(text, { uniqueKeys: true });
  const yamlProblems = [...doc.errors, ...doc.warnings];
  if (yamlProblems.length > 0) {
    return {
      ok: false,
      issues: yamlProblems.map((e) => {
        const line = e.linePos?.[0]?.line;
        return { path: '', message: `YAML: ${e.message.split('\n')[0]}`, ...(line !== undefined ? { line } : {}) };
      }),
    };
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 50 });
  } catch (err) {
    return { ok: false, issues: [{ path: '', message: `YAML: ${(err as Error).message}` }] };
  }
  return validatePluginData(data);
}

/** Validates already-parsed data (e.g. a manifest stored as JSON after install). */
export function validatePluginData(data: unknown): PluginParseResult {
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) return { ok: false, issues: describeIssues(parsed.error.issues, data) };
  const issues = checkManifest(parsed.data);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, manifest: parsed.data };
}

// ─── Turning zod issues into fixable messages ───────────────────────────────

function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let cur = data;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<PropertyKey, unknown>)[p];
  }
  return cur;
}

const pathKey = (path: readonly PropertyKey[]) => formatPath(path);

function describeIssues(issues: readonly ZodIssue[], data: unknown): PluginIssue[] {
  const out: PluginIssue[] = [];

  // A misspelled key shows up twice: the typo as unrecognized, the real key
  // as missing. Pair them into one "did you mean" and drop the missing one.
  const missingByParent = new Map<string, string[]>();
  for (const i of issues) {
    if (i.code === 'invalid_type' && valueAt(data, i.path) === undefined && i.path.length > 0) {
      const parent = pathKey(i.path.slice(0, -1));
      missingByParent.set(parent, [...(missingByParent.get(parent) ?? []), String(i.path[i.path.length - 1])]);
    }
  }
  const pairedMissing = new Set<string>();

  for (const i of issues) {
    if (i.code === 'unrecognized_keys') {
      const parent = pathKey(i.path);
      for (const k of i.keys) {
        const guess = didYouMean(k, missingByParent.get(parent) ?? []);
        if (guess !== undefined) pairedMissing.add(pathKey([...i.path, guess]));
        out.push({
          path: pathKey([...i.path, k]),
          message: guess !== undefined ? `unknown key "${k}"; did you mean "${guess}"?` : `unknown key "${k}"`,
        });
      }
    }
  }

  for (const i of issues) {
    if (i.code === 'unrecognized_keys') continue;
    const at = pathKey(i.path);
    if (pairedMissing.has(at)) continue;
    out.push(...describeIssue(i, data));
  }
  return out;
}

function describeIssue(i: ZodIssue, data: unknown): PluginIssue[] {
  const path = pathKey(i.path);
  const actual = valueAt(data, i.path);

  switch (i.code) {
    case 'invalid_type':
      if (actual === undefined) return [{ path, message: `missing required key "${String(i.path[i.path.length - 1] ?? '')}"` }];
      return [{ path, message: `expected ${i.expected}, got ${Array.isArray(actual) ? 'array' : typeof actual}` }];

    case 'invalid_value': {
      const options = i.values.map(String);
      const guess = typeof actual === 'string' ? didYouMean(actual, options) : undefined;
      const hint = guess !== undefined ? `; did you mean "${guess}"?` : '';
      return [{ path, message: `invalid value ${JSON.stringify(actual)}${hint} expected one of: ${options.join(', ')}` }];
    }

    case 'invalid_union': {
      // Unknown discriminator (block `type`, widget `type`).
      if ('discriminator' in i && i.discriminator !== undefined) {
        const options = (i as { options?: unknown[] }).options?.map(String) ?? [];
        const guess = typeof actual === 'string' ? didYouMean(actual, options) : undefined;
        const hint = guess !== undefined ? `; did you mean "${guess}"?` : '';
        const what = actual === undefined ? `missing "${i.discriminator}"` : `unknown ${i.discriminator} ${JSON.stringify(actual)}${hint}`;
        return [{ path, message: `${what} available: ${options.join(', ')}` }];
      }
      return describeUnion(i, data, actual);
    }

    default:
      return [{ path, message: i.message }];
  }
}

/**
 * A plain union failed: a computed value, a value reference or a hook. Pick
 * the branch the author was evidently aiming at and report only its issues —
 * listing every branch's complaints would bury the one that matters.
 */
function describeUnion(i: Extract<ZodIssue, { code: 'invalid_union' }>, data: unknown, actual: unknown): PluginIssue[] {
  const path = pathKey(i.path);
  // Branch issues carry paths relative to the union; anchor them to the file.
  const branches = i.errors.map((b) => b.map((x) => ({ ...x, path: [...i.path, ...x.path] }) as ZodIssue));

  if (actual !== null && typeof actual === 'object' && !Array.isArray(actual)) {
    const keys = Object.keys(actual);

    // Computed value: the branch is named by its operator key.
    const op = COMPUTED_OPS.find((o) => keys.includes(o));
    const looksComputed = op !== undefined || branches.length >= COMPUTED_OPS.length;
    if (looksComputed && op === undefined) {
      const guess = keys.map((k) => didYouMean(k, COMPUTED_OPS)).find((g) => g !== undefined);
      const hint = guess !== undefined ? `; did you mean "${guess}"?` : '';
      return [{ path, message: `a computed value needs exactly one operator${hint} available: ${COMPUTED_OPS.join(', ')}` }];
    }
    if (op !== undefined) {
      const issues = operatorBranch(branches, op, path);
      if (issues) return describeIssues(issues, data);
    }

    // Otherwise (a hook): the branch with the fewest issues is the closest match.
    const best = [...branches].sort((a, b) => a.length - b.length)[0];
    if (best && best.length > 0) return describeIssues(best, data);
  }

  if (typeof actual === 'string' && !actual.startsWith('$') && branches.length > 0) {
    return [{ path, message: `expected a number, a $reference or a computed value, got "${actual}" (references start with $)` }];
  }
  return [{ path, message: i.message }];
}

/**
 * The issues of the branch for `op`. Every other operator's branch rejects
 * `op` as an unknown key, and the number and $reference branches reject the
 * whole value; a value reference nests the computed union, so unwrap it.
 */
function operatorBranch(branches: ZodIssue[][], op: string, path: string): ZodIssue[] | undefined {
  for (const b of branches) {
    const nested = b.length === 1 && b[0]!.code === 'invalid_union' && pathKey(b[0]!.path) === path ? b[0] : undefined;
    if (nested?.code === 'invalid_union') {
      const inner = operatorBranch(nested.errors.map((x) => x.map((y) => ({ ...y, path: [...nested.path, ...y.path] }) as ZodIssue)), op, path);
      if (inner) return inner;
      continue;
    }
    const rejectsOp = b.some((x) => x.code === 'unrecognized_keys' && x.keys.includes(op));
    const rejectsWhole = b.some((x) => x.code === 'invalid_type' && pathKey(x.path) === path);
    if (!rejectsOp && !rejectsWhole) return b;
  }
  return undefined;
}
