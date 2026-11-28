export interface BulkTestCase {
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

// Bulk import format: cases separated by a line that is exactly `===`; within
// a case, input and expected are separated by a line that is exactly `---`; a
// first line of exactly `@sample` marks the case as a sample.
export function parseBulkCases(text: string): BulkTestCase[] {
  return text
    .split(/\r?\n===\r?\n/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => {
      let body = block;
      let isSample = false;
      const nl = body.indexOf('\n');
      const firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === '@sample') {
        isSample = true;
        body = nl === -1 ? '' : body.slice(nl + 1);
      }
      const parts = body.split(/\r?\n---\r?\n/);
      return {
        input: parts[0] ?? '',
        expectedOutput: parts.slice(1).join('\n---\n'),
        isSample,
      };
    });
}

function detectDelimiter(text: string): ',' | '\t' {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (ch === '\t') return '\t';
      if (ch === '\n' || ch === '\r') break;
    }
  }
  return ',';
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (ch === '\r' && text[i + 1] === '\n') {
        field += '\n';
        i++;
      } else {
        field += ch;
      }
      continue;
    }

    if (!fieldStarted && ch === '"') {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }

  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseSampleFlag(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'sample' || v === 'サンプル';
}

// Parses CSV or TSV (auto-detected by whether the first row contains an
// unquoted tab). Supports RFC 4180 double-quoted multiline fields and optional
// header rows (e.g. `input,expectedOutput,isSample`).
export function parseCsvTsvCases(text: string): BulkTestCase[] {
  const cleaned = text.replace(/^\uFEFF/, '');
  if (cleaned.trim() === '') return [];

  const delimiter = detectDelimiter(cleaned);
  const rawRows = parseDelimitedRows(cleaned, delimiter).filter((r) =>
    r.some((cell) => cell.trim() !== ''),
  );
  if (rawRows.length === 0) return [];

  let inputIdx = 0;
  let expectedIdx = 1;
  let sampleIdx = 2;
  let startRow = 0;

  const firstRowNormalized = rawRows[0].map((cell) => cell.trim().toLowerCase());
  if (
    firstRowNormalized[0] === 'input' ||
    firstRowNormalized[0] === 'stdin' ||
    firstRowNormalized.includes('expectedoutput') ||
    firstRowNormalized.includes('expected_output')
  ) {
    startRow = 1;
    const foundInput = firstRowNormalized.findIndex((h) => h === 'input' || h === 'stdin');
    const foundExpected = firstRowNormalized.findIndex(
      (h) => h === 'expectedoutput' || h === 'expected_output' || h === 'expected' || h === 'stdout',
    );
    const foundSample = firstRowNormalized.findIndex(
      (h) => h === 'issample' || h === 'is_sample' || h === 'sample',
    );
    if (foundInput !== -1) inputIdx = foundInput;
    if (foundExpected !== -1) expectedIdx = foundExpected;
    if (foundSample !== -1) sampleIdx = foundSample;
  }

  const cases: BulkTestCase[] = [];
  for (let i = startRow; i < rawRows.length; i++) {
    const r = rawRows[i];
    cases.push({
      input: r[inputIdx] ?? '',
      expectedOutput: r[expectedIdx] ?? '',
      isSample: parseSampleFlag(r[sampleIdx]),
    });
  }
  return cases;
}

// Parses a JSON array of `{ input, expectedOutput?, isSample? }` objects (or an
// object containing a `testCases` / `cases` array). Throws on malformed JSON or
// invalid item shapes so the caller can show an inline parse error.
export function parseJsonCases(text: string): BulkTestCase[] {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (trimmed === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('JSONの構文が正しくありません。');
  }

  let items: unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.testCases)) items = obj.testCases;
    else if (Array.isArray(obj.cases)) items = obj.cases;
  }

  if (!Array.isArray(items)) {
    throw new Error('JSONは配列（または testCases / cases 配列を含むオブジェクト）である必要があります。');
  }

  return items.map((item, idx) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${idx + 1}件目がオブジェクトではありません。`);
    }
    const rec = item as Record<string, unknown>;
    if (rec.input !== undefined && typeof rec.input !== 'string') {
      throw new Error(`${idx + 1}件目の input は文字列である必要があります。`);
    }
    if (rec.expectedOutput !== undefined && typeof rec.expectedOutput !== 'string') {
      throw new Error(`${idx + 1}件目の expectedOutput は文字列である必要があります。`);
    }
    if (rec.isSample !== undefined && typeof rec.isSample !== 'boolean') {
      throw new Error(`${idx + 1}件目の isSample は真偽値（true / false）である必要があります。`);
    }
    return {
      input: (rec.input as string | undefined) ?? '',
      expectedOutput: (rec.expectedOutput as string | undefined) ?? '',
      isSample: (rec.isSample as boolean | undefined) ?? false,
    };
  });
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportCasesToCsv(cases: readonly BulkTestCase[]): string {
  const lines = ['input,expectedOutput,isSample'];
  for (const tc of cases) {
    lines.push(
      [
        escapeCsvCell(tc.input),
        escapeCsvCell(tc.expectedOutput),
        tc.isSample ? 'true' : 'false',
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function exportCasesToJson(cases: readonly BulkTestCase[]): string {
  return JSON.stringify(
    cases.map(({ input, expectedOutput, isSample }) => ({
      input,
      expectedOutput,
      isSample,
    })),
    null,
    2,
  );
}
