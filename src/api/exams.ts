import { apiFetch, ApiError } from './client';
import type { ExamDetail, ExamResults, ExamStatus, ExamSummary } from '../types/exam';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

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

export function getExamResults(examId: string) {
  return apiFetch<ExamResults>(`/api/exams/${examId}/results`);
}

// The results endpoint returns JSON but the CSV export is a separate route
// returning text/csv, so it can't go through apiFetch's JSON parsing — this
// fetches the blob directly and triggers a browser download.
export async function downloadExamResultsCsv(examId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/exams/${examId}/results/csv`, {
    credentials: 'include',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? 'CSVのダウンロードに失敗しました。', res.status);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const asciiMatch = disposition.match(/filename="([^"]+)"/);
  const filename = asciiMatch?.[1] ?? `exam-results-${examId}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
