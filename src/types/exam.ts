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
