import { apiFetch } from './client';
import type {
  JudgeOutcome,
  JudgeVerdict,
  StudentAttempt,
  StudentExamResult,
  StudentExamState,
  StudentExamSummary,
  StudentTaskResponse,
  SubmitPayload,
  SubmitTaskResult,
  TaskDraftMetrics,
} from '../types/student';

// The answer language is fixed by the task, so run bodies carry no language
// field — only the per-mode payload differs.
//
// Client-executed languages (C/JS/TS/Python): the browser ran the program and
// reports what it printed per test case.
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
  return apiFetch<StudentExamState>(`/api/student/exams/${examId}`);
}

// Begin a new attempt, or resume the in-progress one. Explicit — visiting the
// exam never burns an attempt.
export function startAttempt(examId: string) {
  return apiFetch<{ attempt: StudentAttempt }>(`/api/student/exams/${examId}/attempts`, {
    method: 'POST',
  });
}

export function getStudentTask(taskId: string) {
  return apiFetch<StudentTaskResponse>(`/api/student/tasks/${taskId}`);
}

export function runTask(taskId: string, input: RunInput) {
  return apiFetch<{ verdict: JudgeVerdict; compileStderr?: string }>(
    `/api/student/tasks/${taskId}/run`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// Per-task "下書き保存". Overwrites the current attempt's draft for this task;
// never judged.
export function saveTaskDraft(taskId: string, code: string, metrics: TaskDraftMetrics) {
  return apiFetch<{ ok: true; updatedAt: string }>(`/api/student/tasks/${taskId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ code, ...metrics }),
  });
}

// Everything the review page needs to grade the in-progress attempt.
export function getSubmitPayload(examId: string) {
  return apiFetch<SubmitPayload>(`/api/student/exams/${examId}/attempt`);
}

// Finalize the current attempt. `tasks` carries per-task results only for
// client-executed languages; server-exec tasks are graded server-side.
export function submitExam(examId: string, tasks: SubmitTaskResult[]) {
  return apiFetch<{
    attempt: { attemptNumber: number; score: number; submittedAt: string };
    perTask: { taskId: string; status: 'AC' | 'WA' | 'CE'; score: number; compileStderr: string }[];
  }>(`/api/student/exams/${examId}/submit`, {
    method: 'POST',
    body: JSON.stringify({ tasks }),
  });
}

export function getStudentExamResult(examId: string) {
  return apiFetch<StudentExamResult>(`/api/student/exams/${examId}/result`);
}
