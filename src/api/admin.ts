import { apiFetch } from './client';
import type { UserProfile } from '../types/user';

export interface ExecutionQueueMetrics {
  active: number;
  interactiveWaiting: number;
  backgroundWaiting: number;
  concurrency: number;
}

export interface GradingQueueMetrics {
  running: number;
  queued: number;
  retrying: number;
  concurrency: number;
}

export interface JudgePoolNodeMetrics {
  url: string;
  inFlight: number;
  healthy: boolean;
}

export interface ServiceHealth {
  db: 'ok' | 'error';
  judge: 'ok' | 'error' | 'disabled';
  judgePool?: {
    healthy: number;
    total: number;
  };
  metrics?: {
    execution: ExecutionQueueMetrics;
    grading: GradingQueueMetrics;
    judgePool: JudgePoolNodeMetrics[];
  };
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

export function clearIpLockout(ip?: string) {
  return apiFetch<{ cleared: number }>('/api/admin/clear-ip-lockout', {
    method: 'POST',
    body: JSON.stringify(ip ? { ip } : {}),
  });
}
