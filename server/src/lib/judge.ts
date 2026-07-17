export interface ClientTestCaseOutcome {
  testCaseId: string;
  stage: 'success' | 'runtime_error';
  stdout: string;
}

export interface JudgeInput {
  compileFailed: boolean;
  outcomes: ClientTestCaseOutcome[];
}

export type PerTestCaseStatus = 'AC' | 'WA' | 'RE';

export interface PerTestCaseResult {
  testCaseId: string;
  isSample: boolean;
  status: PerTestCaseStatus;
  actualOutput: string;
}

export type OverallStatus = 'AC' | 'WA' | 'CE';

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

// The client reports what its compiled program printed for each test case's
// input, but never the verdict itself — this function is the only place an
// AC/WA/CE determination is made, specifically so a student can't tamper with
// the client to submit a fabricated "AC" without the code actually producing
// the right output.
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
    if (outcome.stage === 'runtime_error') {
      return {
        testCaseId: tc.id,
        isSample: tc.isSample,
        status: 'RE',
        actualOutput: outcome.stdout,
      };
    }
    const status: PerTestCaseStatus =
      outcome.stdout.trim() === tc.expectedOutput.trim() ? 'AC' : 'WA';
    return { testCaseId: tc.id, isSample: tc.isSample, status, actualOutput: outcome.stdout };
  });

  const overallStatus: OverallStatus = results.every((r) => r.status === 'AC') ? 'AC' : 'WA';
  const score = overallStatus === 'AC' ? points : 0;

  return { overallStatus, results, score };
}
