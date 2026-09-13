export type ExamStatus = 'DRAFT' | 'PUBLISHED';
export type Language = 'C' | 'JAVA' | 'JS' | 'TS' | 'PYTHON';

export interface ExamSummary {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  status: ExamStatus;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  courseId: string | null;
  courseName: string | null;
}

export interface TaskSummary {
  id: string;
  order: number;
  title: string;
  points: number;
}

export type ComparisonMode = 'EXACT' | 'TRIM_TRAILING_WS' | 'IGNORE_BLANK_LINES' | 'FLOAT';

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  // How many times a student may take this exam. null = unlimited.
  maxAttempts: number | null;
  // ISO datetimes or null. Before opensAt the exam is visible but not
  // startable; after closesAt no new attempt may start.
  opensAt: string | null;
  closesAt: string | null;
  // Class scoping. null → visible to every student.
  courseId: string | null;
  status: ExamStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  tasks: TaskSummary[];
}

export interface TestCase {
  id: string;
  taskId: string;
  input: string;
  expectedOutput: string;
  isSample: boolean;
  order: number;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface Solution {
  id: string;
  taskId: string;
  language: Language;
  code: string;
}

export interface TaskDetail {
  id: string;
  examId: string;
  order: number;
  title: string;
  statementMarkdown: string;
  // The single language this task must be answered in.
  language: Language;
  starterCode: string | null;
  points: number;
  // How this task's test-case outputs are compared.
  comparisonMode: ComparisonMode;
  floatTolerance: number;
  // When true, the score is proportional to the fraction of test cases
  // (sample + hidden) that passed, rounded to the nearest point — instead of
  // all-or-nothing on a clean AC. Still 0 on a compile error.
  allowPartialCredit: boolean;
  // Task-bank fields: free-form labels + whether other teachers can find this
  // task via the shared bank search (a discovery flag, not access control —
  // see CLAUDE.md).
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  testCases: TestCase[];
  solutions: Solution[];
}

// One row in a GET /api/task-bank search result.
export interface TaskBankEntry {
  id: string;
  title: string;
  language: Language;
  points: number;
  tags: string[];
  isPublic: boolean;
  testCaseCount: number;
  examId: string;
  examTitle: string;
  ownerName: string;
  // Whether the caller owns this task's exam (vs. seeing it because it's
  // someone else's public task).
  mine: boolean;
  createdAt: string;
}

export type TaskBankScope = 'all' | 'mine' | 'public';

export type SubmissionOverallStatus = 'AC' | 'WA' | 'CE' | 'TLE' | 'MLE';

export interface TaskResultColumn {
  id: string;
  title: string;
  order: number;
  points: number;
}

export interface StudentTaskCell {
  taskId: string;
  status: SubmissionOverallStatus | null;
  score: number;
  submittedAt: string | null;
  keystrokeCount: number | null;
  pasteCount: number | null;
  pastedCharCount: number | null;
  timeSpentSeconds: number | null;
}

export interface StudentResultRow {
  id: string;
  studentNumber: string;
  displayName: string;
  results: StudentTaskCell[];
  totalScore: number;
  lastSubmittedAt: string | null;
  startedAt: string | null;
  elapsedSeconds: number | null;
  // Number of finished (submitted) attempts. The row's status/score reflect
  // the latest one.
  attemptCount: number;
  // Per-student time accommodation for this exam, in minutes (0 if none).
  extraMinutes: number;
}

export interface ExamResults {
  exam: { id: string; title: string };
  tasks: TaskResultColumn[];
  students: StudentResultRow[];
}

export type PerTestCaseStatus = 'AC' | 'WA' | 'RE' | 'TLE' | 'MLE';

export interface SubmissionDetailTestCase {
  id: string;
  order: number;
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

export interface SubmissionDetailResult {
  testCaseId: string;
  isSample: boolean;
  status: PerTestCaseStatus;
  actualOutput: string;
}

export interface SubmissionDetailTask {
  taskId: string;
  title: string;
  order: number;
  points: number;
  language: Language;
  submitted: boolean;
  overallStatus: SubmissionOverallStatus | null;
  score: number;
  code: string | null;
  results: SubmissionDetailResult[];
  testCases: SubmissionDetailTestCase[];
}

// GET /api/exams/:examId/students/:studentId/submission-detail — the student's
// latest submitted attempt, with code + per-test-case outcomes.
export interface SubmissionDetail {
  attemptNumber: number | null;
  tasks: SubmissionDetailTask[];
}
