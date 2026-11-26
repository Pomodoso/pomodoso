// Formatting for a task's description: the four buttons both clients offer
// (bold, italic, bullet list, inline code) and the subset of Markdown they
// produce. Shared so a toggle behaves the same in the extension's textarea
// and mobile's TextInput, and so mobile can preview it without a Markdown
// library. The extension previews with `marked`, which reads the same syntax.

export interface FormatResult {
  value: string;
  /** Where the selection goes after the edit. */
  start: number;
  end: number;
}

export type FormatKind = 'bold' | 'italic' | 'bullet' | 'code';

const MARKERS: Record<FormatKind, { prefix: string; suffix: string; lineMode: boolean }> = {
  bold: { prefix: '**', suffix: '**', lineMode: false },
  italic: { prefix: '_', suffix: '_', lineMode: false },
  code: { prefix: '`', suffix: '`', lineMode: false },
  bullet: { prefix: '- ', suffix: '', lineMode: true },
};

/**
 * Applies a format to the selection [start, end) of `value`.
 *
 * Inline formats wrap the selection, or unwrap it when it is already wrapped;
 * with nothing selected they insert an empty pair and put the cursor inside.
 * The bullet format toggles `- ` on every line the selection touches (or the
 * cursor's line).
 */
export function applyFormat(value: string, start: number, end: number, kind: FormatKind): FormatResult {
  const { prefix, suffix, lineMode } = MARKERS[kind];
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));

  if (lineMode) {
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const blockEnd = s === e
      ? (value.indexOf('\n', s) >= 0 ? value.indexOf('\n', s) : value.length)
      : e;
    const block = value.slice(lineStart, blockEnd);
    const lines = block.split('\n');
    const toggling = lines.every(l => l.startsWith(prefix));
    const newBlock = toggling
      ? lines.map(l => l.slice(prefix.length)).join('\n')
      : lines.map(l => prefix + l).join('\n');
    const delta = newBlock.length - block.length;
    return {
      value: value.slice(0, lineStart) + newBlock + value.slice(blockEnd),
      start: s + (toggling ? -Math.min(prefix.length, s - lineStart) : prefix.length),
      end: blockEnd + delta,
    };
  }

  const sel = value.slice(s, e);
  // Markdown emphasis doesn't cross line breaks, so a multi-line selection is
  // formatted line by line (blank lines left alone). Toggles off when every
  // non-blank line is already wrapped.
  if (sel.includes('\n')) {
    const lines = sel.split('\n');
    const filled = lines.filter(l => l.trim() !== '');
    const wrapped = (l: string) => l.startsWith(prefix) && l.endsWith(suffix) && l.length > prefix.length + suffix.length;
    const unwrapping = filled.length > 0 && filled.every(wrapped);
    const out = lines
      .map(l => (l.trim() === '' ? l : unwrapping ? l.slice(prefix.length, l.length - suffix.length) : prefix + l + suffix))
      .join('\n');
    return { value: value.slice(0, s) + out + value.slice(e), start: s, end: s + out.length };
  }
  if (sel) {
    if (sel.startsWith(prefix) && sel.endsWith(suffix) && sel.length > prefix.length + suffix.length) {
      const inner = sel.slice(prefix.length, sel.length - suffix.length);
      return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length };
    }
    const wrapped = prefix + sel + suffix;
    return { value: value.slice(0, s) + wrapped + value.slice(e), start: s, end: s + wrapped.length };
  }

  return {
    value: value.slice(0, s) + prefix + suffix + value.slice(e),
    start: s + prefix.length,
    end: s + prefix.length,
  };
}

export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface TextBlock {
  /** A `- ` or `* ` list item. */
  bullet: boolean;
  spans: TextSpan[];
}

/**
 * Parses the Markdown the format buttons produce, one block per line, for
 * clients that render it natively. Anything else reads as plain text:
 * headings, links and tables show their source, which is what the user typed.
 */
export function parseFormattedText(text: string): TextBlock[] {
  return text.split('\n').map(line => {
    const bullet = /^\s*[-*] /.test(line);
    return { bullet, spans: parseInline(bullet ? line.replace(/^\s*[-*] /, '') : line) };
  });
}

// Code spans are taken out first (swapped for placeholders) so their content
// stays literal and a `**` inside one can't close the bold around it. Then
// **bold**, then _italic_ or *italic*. Underscores inside a word (snake_case)
// don't open italics. No lookbehind: the character before an italic marker is
// captured instead (group 2 / 4) and kept as plain text, so Hermes on older
// React Native versions parses it too.
const CODE = /`([^`]+)`/g;
const EMPHASIS = /\*\*(.+?)\*\*|(^|[^\w])_(.+?)_(?!\w)|(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g;
// Private-use characters: never typed, so they can't collide with text.
const OPEN = '\uE000';
const CLOSE = '\uE001';
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

function parseInline(line: string): TextSpan[] {
  const codes: string[] = [];
  const masked = line.replace(CODE, (_m, code: string) => `${OPEN}${codes.push(code) - 1}${CLOSE}`);
  return parseEmphasis(masked, codes, {});
}

function parseEmphasis(line: string, codes: string[], inherited: Omit<TextSpan, 'text'>): TextSpan[] {
  const spans: TextSpan[] = [];
  let last = 0;
  for (const m of line.matchAll(EMPHASIS)) {
    const lead = m[2] ?? m[4] ?? '';
    const index = (m.index ?? 0) + lead.length;
    if (index > last) spans.push(...plain(line.slice(last, index), codes, inherited));
    if (m[1] !== undefined) spans.push(...parseEmphasis(m[1], codes, { ...inherited, bold: true }));
    else spans.push(...parseEmphasis(m[3] ?? m[5] ?? '', codes, { ...inherited, italic: true }));
    last = (m.index ?? 0) + m[0].length;
  }
  if (last < line.length) spans.push(...plain(line.slice(last), codes, inherited));
  return spans;
}

/** Text with code placeholders put back as code spans. */
function plain(text: string, codes: string[], inherited: Omit<TextSpan, 'text'>): TextSpan[] {
  const spans: TextSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const index = m.index ?? 0;
    if (index > last) spans.push({ ...inherited, text: text.slice(last, index) });
    spans.push({ ...inherited, code: true, text: codes[Number(m[1])] ?? '' });
    last = index + m[0].length;
  }
  if (last < text.length) spans.push({ ...inherited, text: text.slice(last) });
  return spans;
}
