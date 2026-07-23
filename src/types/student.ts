export interface StudentExamSummary {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  taskCount: number;
  // Distinct tasks this student has submitted for this exam. Fully
  // submitted (>= taskCount, and taskCount > 0) means the exam is done.
  submittedTaskCount: number;
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
  // When this student first opened this exam — the fixed reference point the
  // countdown displayed while taking it is computed from.
  startedAt: string;
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

// Captured client-side from the Monaco editor while a student works on a
// task, to help a teacher spot answers that were mostly pasted in rather
// than typed.
export interface EditorIntegrityStats {
  keystrokeCount: number;
  pasteCount: number;
  pastedCharCount: number;
}

export interface SubmissionSummary {
  taskId: string;
  overallStatus: OverallStatus;
  score: number;
  submittedAt: string;
}
