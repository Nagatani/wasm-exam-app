import type { ComparisonMode } from '../../src/lib/judge';

// One shared table of (expected, actual, mode) → match cases. Both the
// server's authoritative `compareOutput` (server/src/lib/judge.ts) and the
// client mirror used by the teacher's "解答例でテストケースを検証" panel
// (src/lib/compareOutput.ts) are run against every row, so the two
// hand-synced implementations can't silently drift apart.
export interface CompareCase {
  name: string;
  mode: ComparisonMode;
  expected: string;
  actual: string;
  floatTolerance?: number;
  match: boolean;
}

export const COMPARE_CASES: CompareCase[] = [
  // EXACT — trims the whole string, nothing else.
  { name: 'EXACT identical', mode: 'EXACT', expected: '3\n', actual: '3\n', match: true },
  { name: 'EXACT ignores leading/trailing whitespace of whole output', mode: 'EXACT', expected: '3', actual: '  3\n\n', match: true },
  { name: 'EXACT rejects inner trailing space', mode: 'EXACT', expected: 'a\nb', actual: 'a \nb', match: false },
  { name: 'EXACT rejects inner blank line', mode: 'EXACT', expected: 'a\nb', actual: 'a\n\nb', match: false },
  { name: 'EXACT is case-sensitive', mode: 'EXACT', expected: 'Yes', actual: 'yes', match: false },
  { name: 'EXACT rejects different value', mode: 'EXACT', expected: '3', actual: '4', match: false },

  // TRIM_TRAILING_WS — per-line trailing spaces/tabs and trailing blank lines.
  { name: 'TRIM_TRAILING_WS ignores per-line trailing space', mode: 'TRIM_TRAILING_WS', expected: 'a\nb', actual: 'a  \nb\t', match: true },
  { name: 'TRIM_TRAILING_WS ignores trailing blank lines', mode: 'TRIM_TRAILING_WS', expected: 'a\nb', actual: 'a\nb\n\n\n', match: true },
  { name: 'TRIM_TRAILING_WS keeps leading space significant', mode: 'TRIM_TRAILING_WS', expected: 'a', actual: ' a', match: false },
  { name: 'TRIM_TRAILING_WS keeps inner blank line significant', mode: 'TRIM_TRAILING_WS', expected: 'a\nb', actual: 'a\n\nb', match: false },

  // IGNORE_BLANK_LINES — drops every blank line (and trailing whitespace).
  { name: 'IGNORE_BLANK_LINES ignores inner blank lines', mode: 'IGNORE_BLANK_LINES', expected: 'a\nb', actual: 'a\n\n  \nb', match: true },
  { name: 'IGNORE_BLANK_LINES ignores leading blank lines', mode: 'IGNORE_BLANK_LINES', expected: 'a', actual: '\n\na', match: true },
  { name: 'IGNORE_BLANK_LINES ignores per-line trailing space', mode: 'IGNORE_BLANK_LINES', expected: 'a\nb', actual: 'a \n\nb\t', match: true },
  { name: 'IGNORE_BLANK_LINES still compares content', mode: 'IGNORE_BLANK_LINES', expected: 'a\nb', actual: 'a\nc', match: false },
  { name: 'IGNORE_BLANK_LINES does not merge lines', mode: 'IGNORE_BLANK_LINES', expected: 'a\nb', actual: 'a b', match: false },

  // IGNORE_CASE — case-insensitive plus TRIM_TRAILING_WS normalization.
  { name: 'IGNORE_CASE ignores case', mode: 'IGNORE_CASE', expected: 'Yes\nNO', actual: 'yes\nno', match: true },
  { name: 'IGNORE_CASE also ignores trailing whitespace', mode: 'IGNORE_CASE', expected: 'YES', actual: 'yes  \n\n', match: true },
  { name: 'IGNORE_CASE ignores per-line trailing space mid-output', mode: 'IGNORE_CASE', expected: 'Yes\nNo', actual: 'yes  \nno', match: true },
  { name: 'IGNORE_CASE keeps inner blank line significant', mode: 'IGNORE_CASE', expected: 'a\nb', actual: 'A\n\nB', match: false },
  { name: 'IGNORE_CASE still compares content', mode: 'IGNORE_CASE', expected: 'yes', actual: 'no', match: false },

  // FLOAT — whitespace-tokenised, numeric tokens within tolerance.
  { name: 'FLOAT within absolute tolerance', mode: 'FLOAT', expected: '3.1415926', actual: '3.1415929', match: true },
  { name: 'FLOAT outside tolerance', mode: 'FLOAT', expected: '3.14', actual: '3.15', match: false },
  { name: 'FLOAT uses relative tolerance for large values', mode: 'FLOAT', expected: '1000000000', actual: '1000000500', match: true },
  { name: 'FLOAT custom tolerance', mode: 'FLOAT', expected: '1.0', actual: '1.05', floatTolerance: 0.1, match: true },
  { name: 'FLOAT tokenises any whitespace', mode: 'FLOAT', expected: '1 2\n3', actual: '1\n2 3\n', match: true },
  { name: 'FLOAT token count must match', mode: 'FLOAT', expected: '1 2', actual: '1 2 3', match: false },
  { name: 'FLOAT compares non-numeric tokens exactly', mode: 'FLOAT', expected: 'ans 1.0', actual: 'ans 1.0000001', match: true },
  { name: 'FLOAT non-numeric token mismatch', mode: 'FLOAT', expected: 'Yes 1', actual: 'yes 1', match: false },
  { name: 'FLOAT equal integer notation', mode: 'FLOAT', expected: '2', actual: '2.000', match: true },
];
