import { apiFetch } from './client';
import type { ExamDetail, ExamStatus, ExamSummary } from '../types/exam';

interface ExamInput {
  title: string;
  description?: string | null;
  timeLimitMinutes: number;
  status?: ExamStatus;
}

export function listExams() {
  return apiFetch<{ exams: ExamSummary[] }>('/api/exams');
}

export function getExam(examId: string) {
  return apiFetch<{ exam: ExamDetail }>(`/api/exams/${examId}`);
}

export function createExam(input: ExamInput) {
  return apiFetch<{ exam: ExamDetail }>('/api/exams', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateExam(examId: string, input: Partial<ExamInput>) {
  return apiFetch<{ exam: ExamDetail }>(`/api/exams/${examId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteExam(examId: string) {
  return apiFetch<void>(`/api/exams/${examId}`, { method: 'DELETE' });
}
