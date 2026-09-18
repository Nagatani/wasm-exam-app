import { apiFetch } from './client';
import type { JudgeOutcome, JudgeVerdict } from '../types/student';
import type {
  PracticeExamDetail,
  PracticeExamSummary,
  PracticeSubmissionSummary,
  PracticeSubmitResult,
  PracticeTask,
} from '../types/practice';

// Same shape as src/api/student.ts's run input — the task fixes the
// language, so only the per-mode payload differs. `code` is always included
// (even for /run, where the server ignores it) so callers can share one
// payload builder between the ephemeral preview and the recorded submit —
// see server/src/routes/practice.ts, which requires it on /submit.
interface ClientExecInput {
  compileFailed: boolean;
  outcomes: JudgeOutcome[];
  code: string;
}
interface ServerExecInput {
  code: string;
}
type RunInput = ClientExecInput | ServerExecInput;

export function listPracticeExams() {
  return apiFetch<{ exams: PracticeExamSummary[] }>('/api/student/practice/exams');
}

export function getPracticeExam(examId: string) {
  return apiFetch<{ exam: PracticeExamDetail }>(`/api/student/practice/exams/${examId}`);
}

export function getPracticeTask(taskId: string) {
  return apiFetch<{ task: PracticeTask }>(`/api/student/practice/tasks/${taskId}`);
}

// Ephemeral preview — judges but never persists.
export function runPracticeTask(taskId: string, input: RunInput) {
  return apiFetch<{ verdict: JudgeVerdict; compileStderr?: string }>(
    `/api/student/practice/tasks/${taskId}/run`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// Judges and records the result as a PracticeSubmission (unlimited history).
export function submitPracticeTask(taskId: string, input: RunInput) {
  return apiFetch<PracticeSubmitResult>(`/api/student/practice/tasks/${taskId}/submit`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getPracticeTaskSubmissions(taskId: string) {
  return apiFetch<{ submissions: PracticeSubmissionSummary[] }>(
    `/api/student/practice/tasks/${taskId}/submissions`,
  );
}
