import { apiFetch } from './client';
import type {
  TaskSubmissionMetrics,
  JudgeOutcome,
  JudgeVerdict,
  StudentExamDetail,
  StudentExamSummary,
  StudentTask,
  SubmissionSummary,
} from '../types/student';

// The answer language is fixed by the task, so run/submit bodies carry no
// language field — only the per-mode payload differs.
//
// Client-executed languages (C): the browser ran the program and reports what
// it printed per test case.
interface ClientExecInput {
  compileFailed: boolean;
  outcomes: JudgeOutcome[];
}

// Server-executed languages (Java): the browser sends the source; the judge
// container compiles + runs it.
interface ServerExecInput {
  code: string;
}

type RunInput = ClientExecInput | ServerExecInput;

export function listStudentExams() {
  return apiFetch<{ exams: StudentExamSummary[] }>('/api/student/exams');
}

export function getStudentExam(examId: string) {
  return apiFetch<{ exam: StudentExamDetail; submittedTaskIds: string[] }>(
    `/api/student/exams/${examId}`,
  );
}

export function getStudentTask(taskId: string) {
  return apiFetch<{ task: StudentTask }>(`/api/student/tasks/${taskId}`);
}

export function runTask(taskId: string, input: RunInput) {
  return apiFetch<{ verdict: JudgeVerdict; compileStderr?: string }>(
    `/api/student/tasks/${taskId}/run`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function submitTask(
  taskId: string,
  code: string,
  metrics: TaskSubmissionMetrics,
  // Only for client-executed languages (C). Server-exec languages (Java)
  // re-run everything server-side and ignore these.
  clientOutcomes?: { compileFailed: boolean; outcomes: JudgeOutcome[] },
) {
  return apiFetch<{
    submission: {
      id: string;
      overallStatus: JudgeVerdict['overallStatus'];
      score: number;
      results: JudgeVerdict['results'];
      submittedAt: string;
    };
    compileStderr?: string;
  }>('/api/student/submissions', {
    method: 'POST',
    body: JSON.stringify({ taskId, code, ...metrics, ...(clientOutcomes ?? {}) }),
  });
}

export function getExamSubmissions(examId: string) {
  return apiFetch<{ submissions: SubmissionSummary[] }>(
    `/api/student/exams/${examId}/submissions`,
  );
}
