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
