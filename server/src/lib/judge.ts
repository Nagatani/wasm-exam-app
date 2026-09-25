export interface ClientTestCaseOutcome {
  testCaseId: string;
  // 'success'      — program exited cleanly; stdout is compared to expected
  // 'runtime_error'— non-zero exit / exception / crash
  // 'tle'          — hit the wall-clock time limit
  // 'mle'          — hit the memory limit (server-exec only for now)
  stage: 'success' | 'runtime_error' | 'tle' | 'mle';
  stdout: string;
  // Wall-clock run time of this test case (ms). Informational only — never
  // affects the verdict (limits are enforced by the runners themselves). For
  // client-exec languages it's self-reported by the browser, same trust level
  // as stdout.
  timeMs?: number;
}

export interface JudgeInput {
  compileFailed: boolean;
  outcomes: ClientTestCaseOutcome[];
}

export type PerTestCaseStatus = 'AC' | 'WA' | 'RE' | 'TLE' | 'MLE';

export interface PerTestCaseResult {
  testCaseId: string;
  isSample: boolean;
  status: PerTestCaseStatus;
  actualOutput: string;
  // Copied from the outcome (see ClientTestCaseOutcome.timeMs).
  timeMs?: number;
  // A coarse, non-revealing category for *why* a WA happened (e.g. "the
  // output would match under looser whitespace rules") — never the expected
  // content itself, so it's safe to show even for a hidden test case. Only
  // ever set on a WA that came from an actual output mismatch (not on a
  // missing/RE/TLE/MLE result, which already says why on its own). See
  // `computeWaHint` below.
  hint?: string;
}

export type OverallStatus = 'AC' | 'WA' | 'CE' | 'TLE' | 'MLE';

export interface JudgeVerdict {
  overallStatus: OverallStatus;
  results: PerTestCaseResult[];
  score: number;
}

interface JudgeableTestCase {
  id: string;
  expectedOutput: string;
  isSample: boolean;
}

export type ComparisonMode =
  | 'EXACT'
  | 'TRIM_TRAILING_WS'
  | 'IGNORE_BLANK_LINES'
  | 'FLOAT'
  | 'IGNORE_CASE';

export interface Comparison {
  mode: ComparisonMode;
  floatTolerance: number;
}

const DEFAULT_COMPARISON: Comparison = { mode: 'EXACT', floatTolerance: 1e-6 };

// Strip each line's trailing whitespace and drop trailing blank lines.
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

// The one place output equivalence is decided. `EXACT` is the historical rule
// (trim the whole string, exact match); the others relax it in the ways
// numeric / free-form problems usually need.
export function compareOutput(expected: string, actual: string, cmp: Comparison): boolean {
  switch (cmp.mode) {
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
    case 'IGNORE_CASE':
      return normalizeLines(expected).toLowerCase() === normalizeLines(actual).toLowerCase();
    case 'FLOAT': {
      const e = expected.trim().split(/\s+/).filter(Boolean);
      const a = actual.trim().split(/\s+/).filter(Boolean);
      if (e.length !== a.length) return false;
      for (let i = 0; i < e.length; i++) {
        const en = Number(e[i]);
        const an = Number(a[i]);
        if (Number.isFinite(en) && Number.isFinite(an)) {
          if (!numbersClose(en, an, cmp.floatTolerance)) return false;
        } else if (e[i] !== a[i]) {
          return false;
        }
      }
      return true;
    }
  }
}

// Non-revealing WA diagnosis: try each looser comparison mode (skipping
// whichever one `judgeSubmission` was already using — that one just failed)
// and report only the *category* of the closest one that would have passed,
// never the expected content. Checked in order of specificity — whitespace
// and case differences are checked before falling back to a generic
// "line count differs" structural signal, since e.g. IGNORE_BLANK_LINES can
// itself change the effective line count, so a raw line-count check alone
// would misdiagnose a blank-line difference as something else.
function computeWaHint(expected: string, actual: string, cmp: Comparison): string | undefined {
  const tryMode = (mode: ComparisonMode) =>
    mode !== cmp.mode && compareOutput(expected, actual, { mode, floatTolerance: cmp.floatTolerance });

  if (tryMode('TRIM_TRAILING_WS')) return '行末の空白や改行の違いの可能性があります。';
  if (tryMode('IGNORE_BLANK_LINES')) return '空行の有無や位置の違いの可能性があります。';
  if (tryMode('IGNORE_CASE')) return '大文字・小文字の違いの可能性があります。';
  if (expected.split('\n').length !== actual.split('\n').length) {
    return '出力の行数が期待と異なります。';
  }
  return undefined;
}

const STAGE_TO_STATUS: Record<'runtime_error' | 'tle' | 'mle', PerTestCaseStatus> = {
  runtime_error: 'RE',
  tle: 'TLE',
  mle: 'MLE',
};

// Overall status when the submission isn't a clean AC. `RE` isn't a
// `SubmissionStatus` value, so it rolls into `WA`; `TLE`/`MLE` are only
// reported when *every* failing test case agrees, otherwise the mix is `WA`.
function computeOverall(results: PerTestCaseResult[]): OverallStatus {
  if (results.every((r) => r.status === 'AC')) return 'AC';
  const failing = results.filter((r) => r.status !== 'AC');
  if (failing.length > 0 && failing.every((r) => r.status === 'TLE')) return 'TLE';
  if (failing.length > 0 && failing.every((r) => r.status === 'MLE')) return 'MLE';
  return 'WA';
}

// The client reports what its compiled program printed for each test case's
// input, but never the verdict itself — this function is the only place an
// AC/WA/CE/TLE/MLE determination is made, specifically so a student can't
// tamper with the client to submit a fabricated "AC" without the code
// actually producing the right output.
export function judgeSubmission(
  testCases: JudgeableTestCase[],
  points: number,
  input: JudgeInput,
  comparison: Comparison = DEFAULT_COMPARISON,
  allowPartialCredit = false,
): JudgeVerdict {
  if (input.compileFailed) {
    return { overallStatus: 'CE', results: [], score: 0 };
  }

  const results: PerTestCaseResult[] = testCases.map((tc) => {
    const outcome = input.outcomes.find((o) => o.testCaseId === tc.id);
    if (!outcome) {
      return { testCaseId: tc.id, isSample: tc.isSample, status: 'WA', actualOutput: '' };
    }
    const timing = outcome.timeMs === undefined ? {} : { timeMs: outcome.timeMs };
    if (outcome.stage !== 'success') {
      return {
        testCaseId: tc.id,
        isSample: tc.isSample,
        status: STAGE_TO_STATUS[outcome.stage],
        actualOutput: outcome.stdout,
        ...timing,
      };
    }
    const matched = compareOutput(tc.expectedOutput, outcome.stdout, comparison);
    const status: PerTestCaseStatus = matched ? 'AC' : 'WA';
    const hint = matched
      ? undefined
      : computeWaHint(tc.expectedOutput, outcome.stdout, comparison);
    return { testCaseId: tc.id, isSample: tc.isSample, status, actualOutput: outcome.stdout, hint, ...timing };
  });

  const overallStatus = computeOverall(results);
  const score = computeScore(results, points, overallStatus, allowPartialCredit);

  return { overallStatus, results, score };
}

// All-or-nothing on a clean AC by default (the historical rule); with
// `allowPartialCredit` the score is proportional to the fraction of test
// cases (sample + hidden alike) that individually passed, rounded to the
// nearest whole point — e.g. 3/4 passing on a 10-point task scores 8, not 0.
// A compile failure never earns partial credit (nothing ran at all — handled
// by judgeSubmission's early return before this is called).
function computeScore(
  results: PerTestCaseResult[],
  points: number,
  overallStatus: OverallStatus,
  allowPartialCredit: boolean,
): number {
  if (!allowPartialCredit) {
    return overallStatus === 'AC' ? points : 0;
  }
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.status === 'AC').length;
  return Math.round((points * passed) / results.length);
}
