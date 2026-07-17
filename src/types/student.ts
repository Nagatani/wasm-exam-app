export interface StudentExamSummary {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  taskCount: number;
}

export interface StudentTaskSummary {
  id: string;
  order: number;
  title: string;
  points: number;
}

export interface StudentExamDetail {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  tasks: StudentTaskSummary[];
}

export interface StudentTestCase {
  id: string;
  input: string;
  order: number;
  isSample: boolean;
  // Only ever populated for sample test cases — hidden test cases never send
  // their expected output to the client.
  expectedOutput?: string;
}

export interface StudentTask {
  id: string;
  examId: string;
  order: number;
  title: string;
  statementMarkdown: string;
  starterCodeC: string | null;
  points: number;
  testCases: StudentTestCase[];
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

export interface JudgeOutcome {
  testCaseId: string;
  stage: 'success' | 'runtime_error';
  stdout: string;
}

export interface SubmissionSummary {
  taskId: string;
  overallStatus: OverallStatus;
  score: number;
  submittedAt: string;
}
