import type { Language } from './exam';
import type { JudgeVerdict, OverallStatus, StudentTestCase } from './student';

// Practice mode (Exam.mode === 'PRACTICE'): untimed, unlimited-retry learning
// support — no attempt/draft concept, so these mirror only the attempt-free
// subset of src/types/student.ts. JudgeVerdict/PerTestCaseResult are reused
// as-is (the judge output shape doesn't depend on exam vs. practice).

export interface PracticeExamSummary {
  id: string;
  title: string;
  description: string | null;
  courseId: string | null;
  defaultLanguage: Language;
  taskCount: number;
  totalPoints: number;
  languages: Language[];
}

export interface PracticeTaskSummary {
  id: string;
  order: number;
  title: string;
  points: number;
  language: Language;
}

export interface PracticeExamDetail {
  id: string;
  title: string;
  description: string | null;
  tasks: PracticeTaskSummary[];
  totalPoints: number;
}

export interface PracticeTask {
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

export interface PracticeSubmissionSummary {
  id: string;
  language: Language;
  code: string;
  results: unknown;
  overallStatus: OverallStatus;
  score: number;
  submittedAt: string;
}

export interface PracticeSubmitResult {
  verdict: JudgeVerdict;
  compileStderr?: string;
  submittedAt: string;
}
