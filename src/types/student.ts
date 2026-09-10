import type { Language } from './exam';

export interface StudentExamSummary {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  taskCount: number;
  totalPoints: number;
  // null = unlimited retakes.
  maxAttempts: number | null;
  // Finished (submitted) attempts so far.
  attemptsUsed: number;
  // The student has an attempt currently in progress.
  hasInProgress: boolean;
  // Can enter the exam right now — either to resume an in-progress attempt or
  // to start a fresh one within the retake limit.
  canStart: boolean;
  // Score of the latest submitted attempt, or null if never submitted.
  latestScore: number | null;
}

export interface StudentTaskSummary {
  id: string;
  order: number;
  title: string;
  points: number;
}

export interface StudentAttempt {
  id: string;
  attemptNumber: number;
  startedAt: string;
  // Fixed wall-clock deadline for this attempt (startedAt + time limit).
  deadline: string;
  // Tasks the student has saved a draft for in this attempt.
  draftedTaskIds: string[];
}

export interface StudentExamDetail {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  tasks: StudentTaskSummary[];
  maxAttempts: number | null;
  totalPoints: number;
}

// GET /api/student/exams/:examId — read-only, never leaks a prior attempt's
// evaluation.
export interface StudentExamState {
  exam: StudentExamDetail;
  attempt: StudentAttempt | null;
  attemptsUsed: number;
  canStartNew: boolean;
}

export interface StudentTestCase {
  id: string;
  input: string;
  order: number;
  isSample: boolean;
  // Only ever populated for sample test cases.
  expectedOutput?: string;
}

export interface StudentTask {
  id: string;
  examId: string;
  order: number;
  title: string;
  statementMarkdown: string;
  language: Language;
  starterCode: string | null;
  points: number;
  testCases: StudentTestCase[];
}

// Client-reported editor metrics, accumulated over the whole time the student
// spends on a task, saved with each draft.
export interface TaskDraftMetrics {
  keystrokeCount: number;
  pasteCount: number;
  pastedCharCount: number;
  timeSpentSeconds: number;
}

export interface StudentTaskDraft extends TaskDraftMetrics {
  code: string;
}

export interface StudentTaskResponse {
  task: StudentTask;
  // The current attempt's saved draft for this task, if any.
  draft: StudentTaskDraft | null;
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

export interface JudgeOutcome {
  testCaseId: string;
  stage: 'success' | 'runtime_error' | 'tle' | 'mle';
  stdout: string;
}

// ---- final submission / review ----

export interface SubmitPayloadTask {
  id: string;
  order: number;
  title: string;
  points: number;
  language: Language;
  serverExec: boolean;
  hasDraft: boolean;
  draftCode: string | null;
  testCases: { id: string; input: string }[];
}

// GET /api/student/exams/:examId/attempt — everything the review page needs to
// grade the in-progress attempt client-side.
export interface SubmitPayload {
  attempt: { id: string; attemptNumber: number; startedAt: string; deadline: string };
  exam: { id: string; title: string; totalPoints: number };
  tasks: SubmitPayloadTask[];
}

// Per-task client-exec result sent with the final submit (server-exec tasks
// are graded server-side from their stored draft and omitted here).
export interface SubmitTaskResult {
  taskId: string;
  compileFailed: boolean;
  outcomes: JudgeOutcome[];
}

export interface ExamResultPerTask {
  taskId: string;
  status: OverallStatus | null;
  score: number;
}

// GET /api/student/exams/:examId/result — the latest submitted attempt.
export interface StudentExamResult {
  exam: { id: string; title: string; tasks: StudentTaskSummary[]; totalPoints: number };
  attempt: {
    attemptNumber: number;
    score: number;
    submittedAt: string;
    startedAt: string;
  } | null;
  perTask: ExamResultPerTask[];
  attemptsUsed: number;
  maxAttempts: number | null;
  canRetake: boolean;
}
