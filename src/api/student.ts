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

interface JudgeRequest {
  compileFailed: boolean;
  outcomes: JudgeOutcome[];
}

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

export function runTask(taskId: string, input: JudgeRequest) {
  return apiFetch<{ verdict: JudgeVerdict }>(`/api/student/tasks/${taskId}/run`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function submitTask(
  taskId: string,
  code: string,
  input: JudgeRequest,
  metrics: TaskSubmissionMetrics,
) {
  return apiFetch<{
    submission: {
      id: string;
      overallStatus: JudgeVerdict['overallStatus'];
      score: number;
      results: JudgeVerdict['results'];
      submittedAt: string;
    };
  }>('/api/student/submissions', {
    method: 'POST',
    body: JSON.stringify({ taskId, language: 'C', code, ...input, ...metrics }),
  });
}

export function getExamSubmissions(examId: string) {
  return apiFetch<{ submissions: SubmissionSummary[] }>(
    `/api/student/exams/${examId}/submissions`,
  );
}
