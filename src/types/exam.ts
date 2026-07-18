export type ExamStatus = 'DRAFT' | 'PUBLISHED';
export type Language = 'C' | 'JAVA';

export interface ExamSummary {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
  status: ExamStatus;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
}

export interface TaskSummary {
  id: string;
  order: number;
  title: string;
  points: number;
}

export interface ExamDetail {
  id: string;
  title: string;
  description: string | null;
  timeLimitMinutes: number;
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
  starterCodeC: string | null;
  starterCodeJava: string | null;
  points: number;
  createdAt: string;
  testCases: TestCase[];
  solutions: Solution[];
}

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
}

export interface StudentResultRow {
  id: string;
  studentNumber: string;
  displayName: string;
  results: StudentTaskCell[];
  totalScore: number;
  lastSubmittedAt: string | null;
}

export interface ExamResults {
  exam: { id: string; title: string };
  tasks: TaskResultColumn[];
  students: StudentResultRow[];
}
