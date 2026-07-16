import { apiFetch } from './client';
import type { Language, Solution, TaskDetail, TestCase } from '../types/exam';

interface TaskInput {
  order: number;
  title: string;
  statementMarkdown?: string;
  starterCodeC?: string | null;
  starterCodeJava?: string | null;
  points?: number;
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
