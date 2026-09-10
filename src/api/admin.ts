import { apiFetch } from './client';
import type { UserProfile } from '../types/user';

export interface ServiceHealth {
  db: 'ok' | 'error';
  judge: 'ok' | 'error' | 'disabled';
}

export function getServiceHealth() {
  return apiFetch<ServiceHealth>('/api/admin/service-health');
}

export function promoteToTeacher(targetStudentNumber: string) {
  return apiFetch<{ user: UserProfile }>('/api/admin/promote-to-teacher', {
    method: 'POST',
    body: JSON.stringify({ targetStudentNumber }),
  });
}
