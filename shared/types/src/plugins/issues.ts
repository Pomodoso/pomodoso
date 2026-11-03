// Validation issues, written to be read by whoever fixes the file — very
// often an LLM. Each one names the exact location (`views[0].blocks[2].type`),
// what was expected, and the closest valid spelling when there is one.

export interface PluginIssue {
  /** Location in the file, e.g. `views[0].blocks[2].type`. Empty for the whole file. */
  path: string;
  message: string;
  /** 1-based line, when known (YAML syntax errors). */
  line?: number;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The closest candidate, if it is plausibly a typo of `word`. */
export function didYouMean(word: string, candidates: Iterable<string>): string | undefined {
  const w = word.toLowerCase();
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const d = levenshtein(w, c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  const limit = Math.max(2, Math.floor(word.length / 3));
  return best !== undefined && bestDistance <= limit ? best : undefined;
}

/** `unknown collection "boks"; did you mean "books"? available: books, notes` */
export function unknownMessage(what: string, value: string, available: Iterable<string>): string {
  const list = [...available];
  const guess = didYouMean(value, list);
  const hint = guess !== undefined ? `; did you mean "${guess}"?` : '';
  const options = list.length > 0 ? ` available: ${list.join(', ')}` : ` there are none declared`;
  return `unknown ${what} "${value}"${hint}${options}`;
}
