import { apiFetch } from './client';
import type { CourseDetail, CourseSummary, EnrollResult } from '../types/course';

export function listCourses() {
  return apiFetch<{ courses: CourseSummary[] }>('/api/courses');
}

export function createCourse(input: { name: string; term?: string | null }) {
  return apiFetch<{ course: { id: string } }>('/api/courses', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCourse(courseId: string) {
  return apiFetch<{ course: CourseDetail }>(`/api/courses/${courseId}`);
}

export function updateCourse(courseId: string, input: { name?: string; term?: string | null }) {
  return apiFetch<{ course: { id: string } }>(`/api/courses/${courseId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCourse(courseId: string) {
  return apiFetch<void>(`/api/courses/${courseId}`, { method: 'DELETE' });
}

// Bulk-add students by 学籍番号 (roster CSV import feeds this).
export function enrollStudents(courseId: string, studentNumbers: string[]) {
  return apiFetch<EnrollResult>(`/api/courses/${courseId}/enrollments`, {
    method: 'POST',
    body: JSON.stringify({ studentNumbers }),
  });
}

export function unenrollStudent(courseId: string, userId: string) {
  return apiFetch<void>(`/api/courses/${courseId}/enrollments/${userId}`, { method: 'DELETE' });
}
