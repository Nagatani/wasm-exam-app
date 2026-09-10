// Client-side mirror of the server's output comparison (server/src/lib/judge.ts
// `compareOutput`). Used only by the teacher's "解答例でテストケースを検証"
// panel so its 一致/不一致 matches what the real judge will decide. The server
// remains the sole authority for actual submissions.

export type ComparisonMode = 'EXACT' | 'TRIM_TRAILING_WS' | 'IGNORE_BLANK_LINES' | 'FLOAT';

export const COMPARISON_MODE_LABEL: Record<ComparisonMode, string> = {
  EXACT: '完全一致（前後の空白のみ無視）',
  TRIM_TRAILING_WS: '行末の空白と末尾の空行を無視',
  IGNORE_BLANK_LINES: '空行をすべて無視（行末空白も無視）',
  FLOAT: '数値を許容誤差付きで比較（空白区切り）',
};

function normalizeLines(s: string): string {
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function numbersClose(a: number, b: number, tol: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= tol || diff <= tol * Math.max(Math.abs(a), Math.abs(b));
}

export function compareOutput(
  expected: string,
  actual: string,
  mode: ComparisonMode,
  floatTolerance: number,
): boolean {
  switch (mode) {
    case 'EXACT':
      return expected.trim() === actual.trim();
    case 'TRIM_TRAILING_WS':
      return normalizeLines(expected) === normalizeLines(actual);
    case 'IGNORE_BLANK_LINES': {
      const strip = (s: string) =>
        normalizeLines(s)
          .split('\n')
          .filter((line) => line.trim() !== '')
          .join('\n');
      return strip(expected) === strip(actual);
    }
    case 'FLOAT': {
      const e = expected.trim().split(/\s+/).filter(Boolean);
      const a = actual.trim().split(/\s+/).filter(Boolean);
      if (e.length !== a.length) return false;
      for (let i = 0; i < e.length; i++) {
        const en = Number(e[i]);
        const an = Number(a[i]);
        if (Number.isFinite(en) && Number.isFinite(an)) {
          if (!numbersClose(en, an, floatTolerance)) return false;
        } else if (e[i] !== a[i]) {
          return false;
        }
      }
      return true;
    }
  }
}
