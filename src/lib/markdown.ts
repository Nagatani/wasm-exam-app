export type TableAlign = 'left' | 'center' | 'right' | null;

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export interface ListItem {
  children: BlockNode[];
}

export type BlockNode =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code'; lang?: string; value: string }
  | { type: 'list'; ordered: boolean; start?: number; items: ListItem[] }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'hr' }
  | { type: 'table'; align: TableAlign[]; header: InlineNode[][]; rows: InlineNode[][][] };

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const ESCAPABLE_PUNCTUATION = new Set('\\`*_{}[]()#+-.!|~<>');

/**
 * Validates link/image URLs. Allows only:
 * - http: and https: URLs
 * - single-leading-slash relative paths (e.g. /uploads/foo.png), excluding
 *   protocol-relative //host and /\host paths.
 * Blocks javascript:, data:, vbscript:, file:, mailto:, etc.
 */
export function sanitizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return null;

  if (trimmed.startsWith('/')) {
    if (trimmed.length > 1 && (trimmed[1] === '/' || trimmed[1] === '\\')) {
      return null;
    }
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseMarkdown(input: string): BlockNode[] {
  const normalized = input.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  return parseBlocks(lines);
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`~]*)[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR_RE = /^ {0,3}(?:(-[ \t]*){3,}|(\*[ \t]*){3,}|(_[ \t]*){3,})$/;
const BLOCKQUOTE_RE = /^ {0,3}> ?(.*)$/;
const UL_ITEM_RE = /^( *)([-*+])[ \t]+(.*)$/;
const OL_ITEM_RE = /^( *)(\d{1,9})[.)][ \t]+(.*)$/;

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function isFenceClose(line: string, fenceChar: string, fenceLen: number): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (!match) return false;
  return match[1][0] === fenceChar && match[1].length >= fenceLen;
}

function stripTrailingHeadingHashes(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(/[ \t]+#+$/, '');
  return /^#+$/.test(stripped) ? '' : stripped;
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let inCode = false;
  let codeTicks = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inCode && ch === '\\' && i + 1 < s.length && s[i + 1] === '|') {
      current += '|';
      i++;
      continue;
    }
    if (ch === '`') {
      let count = 1;
      while (i + count < s.length && s[i + count] === '`') count++;
      current += s.slice(i, i + count);
      if (!inCode) {
        inCode = true;
        codeTicks = count;
      } else if (count === codeTicks) {
        inCode = false;
        codeTicks = 0;
      }
      i += count - 1;
      continue;
    }
    if (!inCode && ch === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseTableSeparator(line: string): TableAlign[] | null {
  if (!line.includes('|') && !/^\s*:?-+:?\s*$/.test(line)) return null;
  const rawCells = splitTableRow(line);
  if (rawCells.length === 0) return null;

  const aligns: TableAlign[] = [];
  for (const cell of rawCells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) aligns.push('center');
    else if (left) aligns.push('left');
    else if (right) aligns.push('right');
    else aligns.push(null);
  }
  return aligns;
}

function isTableStart(lines: string[], index: number): TableAlign[] | null {
  if (index + 1 >= lines.length) return null;
  const headerLine = lines[index];
  const sepLine = lines[index + 1];
  if (!headerLine.includes('|')) return null;
  const aligns = parseTableSeparator(sepLine);
  if (!aligns) return null;
  const headerCells = splitTableRow(headerLine);
  if (headerCells.length !== aligns.length) return null;
  return aligns;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  if (isBlank(line)) return true;
  if (FENCE_OPEN_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (BLOCKQUOTE_RE.test(line)) return true;
  if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) return true;
  if (isTableStart(lines, index) !== null) return true;
  return false;
}

function parseBlocks(lines: string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const lang = fenceMatch[2] || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !isFenceClose(lines[i], fenceChar, fenceLen)) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push({
        type: 'code',
        ...(lang ? { lang } : {}),
        value: codeLines.join('\n'),
      });
      continue;
    }

    // ATX heading
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const depth = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const text = stripTrailingHeadingHashes(headingMatch[2] ?? '');
      blocks.push({
        type: 'heading',
        depth,
        children: parseInline(text),
      });
      i++;
      continue;
    }

    // Horizontal rule (check before unordered list so `- - -` / `---` is hr)
    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (BLOCKQUOTE_RE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const bq = BLOCKQUOTE_RE.exec(lines[i]);
        if (!bq) break;
        quoteLines.push(bq[1]);
        i++;
      }
      blocks.push({
        type: 'blockquote',
        children: parseBlocks(quoteLines),
      });
      continue;
    }

    // GFM Table
    const tableAlign = isTableStart(lines, i);
    if (tableAlign) {
      const header = splitTableRow(lines[i]).map((cell) => parseInline(cell));
      const colCount = header.length;
      i += 2; // skip header + separator
      const rows: InlineNode[][][] = [];
      while (i < lines.length) {
        const rowLine = lines[i];
        if (
          isBlank(rowLine) ||
          !rowLine.includes('|') ||
          FENCE_OPEN_RE.test(rowLine) ||
          HEADING_RE.test(rowLine) ||
          HR_RE.test(rowLine) ||
          BLOCKQUOTE_RE.test(rowLine)
        ) {
          break;
        }
        const cells = splitTableRow(rowLine);
        const normalizedCells: InlineNode[][] = [];
        for (let c = 0; c < colCount; c++) {
          normalizedCells.push(parseInline(cells[c] ?? ''));
        }
        rows.push(normalizedCells);
        i++;
      }
      blocks.push({ type: 'table', align: tableAlign, header, rows });
      continue;
    }

    // Unordered / Ordered list
    const ulMatch = UL_ITEM_RE.exec(line);
    const olMatch = ulMatch ? null : OL_ITEM_RE.exec(line);
    if (ulMatch || olMatch) {
      const ordered = olMatch !== null;
      const baseIndent = (ulMatch ?? olMatch)![1].length;
      const start = olMatch ? Number(olMatch[2]) : undefined;
      const items: ListItem[] = [];

      while (i < lines.length) {
        const cur = lines[i];
        if (HR_RE.test(cur)) break;

        const m = ordered ? OL_ITEM_RE.exec(cur) : UL_ITEM_RE.exec(cur);
        if (!m || m[1].length !== baseIndent) break;

        const itemLines: string[] = [m[3]];
        const contentIndent = m[0].length - m[3].length;
        i++;

        while (i < lines.length) {
          const next = lines[i];
          if (isBlank(next)) {
            // Peek ahead: include blank line only if followed by indented continuation
            let look = i + 1;
            while (look < lines.length && isBlank(lines[look])) look++;
            if (look < lines.length) {
              const leadingSpaces = /^ */.exec(lines[look])![0].length;
              if (leadingSpaces >= contentIndent || leadingSpaces > baseIndent) {
                itemLines.push('');
                i++;
                continue;
              }
            }
            break;
          }
          if (HR_RE.test(next)) break;
          const leadingSpaces = /^ */.exec(next)![0].length;
          if (leadingSpaces > baseIndent) {
            const strip = Math.min(leadingSpaces, contentIndent);
            itemLines.push(next.slice(strip));
            i++;
            continue;
          }
          // Same-level list item or different block ends this item
          break;
        }

        items.push({ children: parseBlocks(itemLines) });
      }

      blocks.push({
        type: 'list',
        ordered,
        ...(ordered && start !== undefined && start !== 1 ? { start } : {}),
        items,
      });
      continue;
    }

    // Paragraph
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !startsBlock(lines, i)) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      children: parseInline(paraLines.join('\n')),
    });
  }

  return blocks;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9]/.test(ch);
}

function pushText(nodes: InlineNode[], value: string): void {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last && last.type === 'text') {
    last.value += value;
  } else {
    nodes.push({ type: 'text', value });
  }
}

/**
 * Finds the matching closing `]` for an opening `[` at `start`, respecting
 * backslash escapes, inline code spans, and nested brackets.
 */
function findClosingBracket(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      i++;
      continue;
    }
    if (ch === '`') {
      let ticks = 1;
      while (i + ticks < text.length && text[i + ticks] === '`') ticks++;
      const close = findClosingBackticks(text, i + ticks, ticks);
      if (close !== -1) {
        i = close + ticks - 1;
        continue;
      }
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findClosingBackticks(text: string, from: number, count: number): number {
  let i = from;
  while (i < text.length) {
    if (text[i] === '`') {
      let run = 1;
      while (i + run < text.length && text[i + run] === '`') run++;
      if (run === count) return i;
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Parses the `(url "optional title")` destination starting at `openParenIndex`.
 * Returns `{ rawUrl, endIndex }` (index of closing `)`) or `null` if malformed.
 */
function parseLinkDestination(
  text: string,
  openParenIndex: number,
): { rawUrl: string; endIndex: number } | null {
  if (text[openParenIndex] !== '(') return null;
  let i = openParenIndex + 1;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;

  let rawUrl = '';
  if (text[i] === '<') {
    const closeAngle = text.indexOf('>', i + 1);
    if (closeAngle === -1) return null;
    rawUrl = text.slice(i + 1, closeAngle);
    i = closeAngle + 1;
  } else {
    let parenDepth = 0;
    const urlStart = i;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === '(') {
        parenDepth++;
      } else if (ch === ')') {
        if (parenDepth === 0) break;
        parenDepth--;
      } else if (ch === ' ' || ch === '\t' || ch === '\n') {
        break;
      }
      i++;
    }
    rawUrl = text.slice(urlStart, i);
  }

  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;

  // Optional title in "..." or '...'
  if (i < text.length && (text[i] === '"' || text[i] === "'")) {
    const quote = text[i];
    i++;
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\' && i + 1 < text.length) i++;
      i++;
    }
    if (i >= text.length) return null;
    i++; // consume closing quote
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  }

  if (text[i] !== ')') return null;
  return { rawUrl, endIndex: i };
}

function findClosingDelimiter(text: string, from: number, delim: string): number {
  const len = delim.length;
  const ch = delim[0];
  for (let i = from; i <= text.length - len; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i++;
      continue;
    }
    if (text[i] === '`') {
      let ticks = 1;
      while (i + ticks < text.length && text[i + ticks] === '`') ticks++;
      const close = findClosingBackticks(text, i + ticks, ticks);
      if (close !== -1) {
        i = close + ticks - 1;
        continue;
      }
    }
    if (text.startsWith(delim, i)) {
      const prev = text[i - 1];
      const next = text[i + len];
      // Cannot close right after whitespace
      if (prev === ' ' || prev === '\t' || prev === '\n') continue;
      // For underscores, disallow intra-word closing
      if (ch === '_' && isWordChar(next)) continue;
      // Avoid matching a longer run when looking for a single `*`/`_` (e.g. `**` inside `*`)
      if (len === 1 && next === ch) {
        // Skip over double delimiter pair if it's an opener inside italic
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Backslash escape or hard line break `\\\n`
    if (ch === '\\' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '\n') {
        nodes.push({ type: 'break' });
        i += 2;
        continue;
      }
      if (ESCAPABLE_PUNCTUATION.has(next)) {
        pushText(nodes, next);
        i += 2;
        continue;
      }
    }

    // Hard line break: 2+ spaces followed by \n
    if (ch === ' ') {
      let spaces = 0;
      while (i + spaces < text.length && text[i + spaces] === ' ') spaces++;
      if (spaces >= 2 && text[i + spaces] === '\n') {
        nodes.push({ type: 'break' });
        i += spaces + 1;
        continue;
      }
    }

    // Inline code span
    if (ch === '`') {
      let ticks = 1;
      while (i + ticks < text.length && text[i + ticks] === '`') ticks++;
      const close = findClosingBackticks(text, i + ticks, ticks);
      if (close !== -1) {
        let content = text.slice(i + ticks, close);
        if (
          content.length >= 2 &&
          content.startsWith(' ') &&
          content.endsWith(' ') &&
          !/^ +$/.test(content)
        ) {
          content = content.slice(1, -1);
        }
        nodes.push({ type: 'code', value: content });
        i = close + ticks;
        continue;
      }
      pushText(nodes, text.slice(i, i + ticks));
      i += ticks;
      continue;
    }

    // Image: ![alt](url)
    if (ch === '!' && text[i + 1] === '[') {
      const closeBracket = findClosingBracket(text, i + 1);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const dest = parseLinkDestination(text, closeBracket + 1);
        if (dest) {
          const alt = text.slice(i + 2, closeBracket);
          const safeSrc = sanitizeUrl(dest.rawUrl);
          if (safeSrc) {
            nodes.push({ type: 'image', src: safeSrc, alt });
          } else if (alt) {
            pushText(nodes, alt);
          }
          i = dest.endIndex + 1;
          continue;
        }
      }
    }

    // Link: [label](url)
    if (ch === '[') {
      const closeBracket = findClosingBracket(text, i);
      if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
        const dest = parseLinkDestination(text, closeBracket + 1);
        if (dest) {
          const label = text.slice(i + 1, closeBracket);
          const children = parseInline(label);
          const safeHref = sanitizeUrl(dest.rawUrl);
          if (safeHref) {
            nodes.push({ type: 'link', href: safeHref, children });
          } else {
            for (const child of children) {
              if (child.type === 'text') pushText(nodes, child.value);
              else nodes.push(child);
            }
          }
          i = dest.endIndex + 1;
          continue;
        }
      }
    }

    // Strong / Emphasis: ***, ___, **, __, *, _
    if (ch === '*' || ch === '_') {
      const prev = text[i - 1];
      const intraWordUnderscore = ch === '_' && isWordChar(prev);
      if (!intraWordUnderscore) {
        const triple = ch + ch + ch;
        const double = ch + ch;

        if (
          text.startsWith(triple, i) &&
          text[i + 3] !== ' ' &&
          text[i + 3] !== '\t' &&
          text[i + 3] !== '\n' &&
          text[i + 3] !== undefined
        ) {
          const close = findClosingDelimiter(text, i + 3, triple);
          if (close !== -1 && close > i + 3) {
            nodes.push({
              type: 'strong',
              children: [{ type: 'em', children: parseInline(text.slice(i + 3, close)) }],
            });
            i = close + 3;
            continue;
          }
        }

        if (
          text.startsWith(double, i) &&
          text[i + 2] !== ' ' &&
          text[i + 2] !== '\t' &&
          text[i + 2] !== '\n' &&
          text[i + 2] !== undefined
        ) {
          const close = findClosingDelimiter(text, i + 2, double);
          if (close !== -1 && close > i + 2) {
            nodes.push({
              type: 'strong',
              children: parseInline(text.slice(i + 2, close)),
            });
            i = close + 2;
            continue;
          }
        }

        if (
          text[i + 1] !== ch &&
          text[i + 1] !== ' ' &&
          text[i + 1] !== '\t' &&
          text[i + 1] !== '\n' &&
          text[i + 1] !== undefined
        ) {
          const close = findClosingDelimiter(text, i + 1, ch);
          if (close !== -1 && close > i + 1) {
            nodes.push({
              type: 'em',
              children: parseInline(text.slice(i + 1, close)),
            });
            i = close + 1;
            continue;
          }
        }
      }
    }

    // Plain text (including raw HTML characters like `<` and `>`, never parsed as HTML)
    pushText(nodes, ch);
    i++;
  }

  return nodes;
}
