import { apiFetch, ApiError } from './client';
import type {
  ExamDetail,
  ExamResults,
  ExamStatus,
  ExamSummary,
  SubmissionDetail,
} from '../types/exam';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

interface ExamInput {
  title: string;
  description?: string | null;
  timeLimitMinutes: number;
  // null = unlimited retakes; omit to keep the current value (default 1).
  maxAttempts?: number | null;
  // ISO datetime strings or null (clear). Omit to keep.
  opensAt?: string | null;
  closesAt?: string | null;
  // Course id or null (unscope). Omit to keep.
  courseId?: string | null;
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

export interface PublishIssue {
  level: 'error' | 'warn';
  message: string;
}

// Advisory pre-publish sanity check for a teacher.
export function getPublishCheck(examId: string) {
  return apiFetch<{ issues: PublishIssue[] }>(`/api/exams/${examId}/publish-check`);
}

// Per-student time accommodation (minutes; 0 removes it).
export function setTimeExtension(examId: string, studentId: string, extraMinutes: number) {
  return apiFetch<{ extraMinutes: number }>(
    `/api/exams/${examId}/students/${studentId}/time-extension`,
    { method: 'PUT', body: JSON.stringify({ extraMinutes }) },
  );
}

// A student's submitted code + per-test-case outcomes for their latest
// submitted attempt (teacher review).
export function getSubmissionDetail(examId: string, studentId: string) {
  return apiFetch<SubmissionDetail>(
    `/api/exams/${examId}/students/${studentId}/submission-detail`,
  );
}

// Deletes every submission + the exam-attempt record for one student on this
// exam — irreversible. Used to "差し戻し" (revert) a student back to
// never-having-taken the exam.
export function deleteStudentExamResults(examId: string, studentId: string) {
  return apiFetch<void>(`/api/exams/${examId}/students/${studentId}/results`, {
    method: 'DELETE',
  });
}

// The results endpoint returns JSON but the CSV export is a separate route
// returning text/csv, so it can't go through apiFetch's JSON parsing — this
// fetches the blob directly and triggers a browser download.
export async function downloadExamResultsCsv(examId: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/exams/${examId}/results/csv`, {
      credentials: 'include',
    });
  } catch {
    // Same reasoning as apiFetch's own network-failure handling (this fetch
    // bypasses apiFetch, being a blob download, so it needs its own copy).
    throw new ApiError(
      'サーバーに接続できませんでした。ネットワーク環境を確認し、しばらくしてから再度お試しください。',
      0,
    );
  }

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
