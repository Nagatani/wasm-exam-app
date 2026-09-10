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
    const status: PerTestCaseStatus =
      outcome.stdout.trim() === tc.expectedOutput.trim() ? 'AC' : 'WA';
    return { testCaseId: tc.id, isSample: tc.isSample, status, actualOutput: outcome.stdout };
  });

  const overallStatus = computeOverall(results);
  const score = overallStatus === 'AC' ? points : 0;

  return { overallStatus, results, score };
}
