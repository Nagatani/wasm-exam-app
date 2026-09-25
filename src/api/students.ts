import { apiFetch } from './client';
import type { BulkCreateResult } from '../types/course';

// Bulk-provision student accounts from a roster; optionally enrolls them all
// into `courseId`. Returns the generated initial passwords once (also
// re-viewable via the course roster until the student changes theirs).
export function bulkCreateStudents(input: {
  students: { studentNumber: string; displayName: string }[];
  courseId?: string | null;
}) {
  return apiFetch<BulkCreateResult>('/api/students/bulk', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// Re-issue a forgotten password: the account gets a new initial password
// (shown in the course roster until changed) + mustChangePassword, and every
// existing session of that student is signed out.
// Sign a student out of every device without changing their password.
export function forceLogoutStudent(studentNumber: string) {
  return apiFetch<{ studentNumber: string; displayName: string; revoked: number }>(
    '/api/students/force-logout',
    { method: 'POST', body: JSON.stringify({ studentNumber }) },
  );
}

export function resetStudentPassword(studentNumber: string) {
  return apiFetch<{ studentNumber: string; displayName: string; initialPassword: string }>(
    '/api/students/reset-password',
    { method: 'POST', body: JSON.stringify({ studentNumber }) },
  );
}
