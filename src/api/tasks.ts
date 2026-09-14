import { apiFetch, ApiError } from './client';
import type { ComparisonMode, Language, Solution, TaskDetail, TestCase } from '../types/exam';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface TaskInput {
  order: number;
  title: string;
  statementMarkdown?: string;
  language?: Language;
  starterCode?: string | null;
  points?: number;
  comparisonMode?: ComparisonMode;
  floatTolerance?: number;
  allowPartialCredit?: boolean;
  tags?: string[];
  isPublic?: boolean;
}

interface TestCaseInput {
  input: string;
  expectedOutput: string;
  isSample?: boolean;
  order: number;
  timeLimitMs?: number;
  memoryLimitMb?: number;
}

export function createTask(examId: string, input: TaskInput) {
  return apiFetch<{ task: TaskDetail }>(`/api/exams/${examId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getTask(taskId: string) {
  return apiFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}`);
}

export function updateTask(taskId: string, input: Partial<TaskInput>) {
  return apiFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTask(taskId: string) {
  return apiFetch<void>(`/api/tasks/${taskId}`, { method: 'DELETE' });
}

export function createTestCase(taskId: string, input: TestCaseInput) {
  return apiFetch<{ testCase: TestCase }>(`/api/tasks/${taskId}/test-cases`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function bulkCreateTestCases(
  taskId: string,
  cases: { input: string; expectedOutput: string; isSample: boolean }[],
) {
  return apiFetch<{ testCases: TestCase[] }>(`/api/tasks/${taskId}/test-cases/bulk`, {
    method: 'POST',
    body: JSON.stringify({ cases }),
  });
}

// Copies the task (with test cases + solutions) into the same exam, or into
// `examId` when given. Returns the new task.
export function duplicateTask(taskId: string, examId?: string) {
  return apiFetch<{ task: TaskDetail }>(`/api/tasks/${taskId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify(examId ? { examId } : {}),
  });
}

// Re-run every existing submission for this task through the judge (Java only).
export function regradeTask(taskId: string) {
  return apiFetch<{ regraded: number; changed: number; failed: number }>(
    `/api/tasks/${taskId}/regrade`,
    { method: 'POST' },
  );
}

export function updateTestCase(testCaseId: string, input: Partial<TestCaseInput>) {
  return apiFetch<{ testCase: TestCase }>(`/api/test-cases/${testCaseId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTestCase(testCaseId: string) {
  return apiFetch<void>(`/api/test-cases/${testCaseId}`, { method: 'DELETE' });
}

export function upsertSolution(taskId: string, language: Language, code: string) {
  return apiFetch<{ solution: Solution }>(`/api/tasks/${taskId}/solutions/${language}`, {
    method: 'PUT',
    body: JSON.stringify({ code }),
  });
}

export function deleteSolution(taskId: string, language: Language) {
  return apiFetch<void>(`/api/tasks/${taskId}/solutions/${language}`, { method: 'DELETE' });
}

// Server-side dry run of a candidate solution against a task's test cases
// (Java only — C/JS/TS/Python are run in the browser). Returns the same shape
// `runClientSide` does so both paths feed one comparison UI.
export interface SolutionCheckResponse {
  compileFailed: boolean;
  compileStderr: string;
  outcomes: { testCaseId: string; stage: 'success' | 'runtime_error'; stdout: string }[];
}

export function checkSolution(taskId: string, code: string) {
  return apiFetch<SolutionCheckResponse>(`/api/tasks/${taskId}/check-solution`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

// Downloads the task (statement, test cases, solutions) as a portable JSON
// file — same content `duplicateTask` copies, but as a file a teacher can
// move between separate server instances or hand to a colleague, which the
// shared task bank (below) can't do on its own. Mirrors
// `downloadExamResultsCsv`'s raw-fetch pattern since this isn't JSON-in/out.
export async function exportTask(taskId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}/export`, { credentials: 'include' });
  } catch {
    throw new ApiError(
      'サーバーに接続できませんでした。ネットワーク環境を確認し、しばらくしてから再度お試しください。',
      0,
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? '問題のエクスポートに失敗しました。', res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const asciiMatch = disposition.match(/filename="([^"]+)"/);
  const filename = utf8Match
    ? decodeURIComponent(utf8Match[1])
    : (asciiMatch?.[1] ?? `task-${taskId}.json`);

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Counterpart to `exportTask` — imports a previously exported file (or one
// containing multiple tasks) into `examId`, appended last.
export function importTasksIntoExam(examId: string, payload: unknown) {
  return apiFetch<{ tasks: TaskDetail[] }>(`/api/exams/${examId}/tasks/import`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
