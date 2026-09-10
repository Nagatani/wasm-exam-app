export interface ClientTestCaseOutcome {
  testCaseId: string;
  // 'success'      — program exited cleanly; stdout is compared to expected
  // 'runtime_error'— non-zero exit / exception / crash
  // 'tle'          — hit the wall-clock time limit
  // 'mle'          — hit the memory limit (server-exec only for now)
  stage: 'success' | 'runtime_error' | 'tle' | 'mle';
  stdout: string;
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

export type ComparisonMode = 'EXACT' | 'TRIM_TRAILING_WS' | 'IGNORE_BLANK_LINES' | 'FLOAT';

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
): JudgeVerdict {
  if (input.compileFailed) {
    return { overallStatus: 'CE', results: [], score: 0 };
  }

  const results: PerTestCaseResult[] = testCases.map((tc) => {
    const outcome = input.outcomes.find((o) => o.testCaseId === tc.id);
    if (!outcome) {
      return { testCaseId: tc.id, isSample: tc.isSample, status: 'WA', actualOutput: '' };
    }
    if (outcome.stage !== 'success') {
      return {
        testCaseId: tc.id,
        isSample: tc.isSample,
        status: STAGE_TO_STATUS[outcome.stage],
        actualOutput: outcome.stdout,
      };
    }
    const status: PerTestCaseStatus = compareOutput(tc.expectedOutput, outcome.stdout, comparison)
      ? 'AC'
      : 'WA';
    return { testCaseId: tc.id, isSample: tc.isSample, status, actualOutput: outcome.stdout };
  });

  const overallStatus = computeOverall(results);
  const score = overallStatus === 'AC' ? points : 0;

  return { overallStatus, results, score };
}
