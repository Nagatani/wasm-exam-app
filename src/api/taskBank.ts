import { apiFetch } from './client';
import type { Language, TaskBankEntry, TaskBankScope } from '../types/exam';

export interface TaskBankQuery {
  q?: string;
  language?: Language;
  tags?: string[];
  scope?: TaskBankScope;
}

export function searchTaskBank(query: TaskBankQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.language) params.set('language', query.language);
  if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
  if (query.scope && query.scope !== 'all') params.set('scope', query.scope);
  const qs = params.toString();
  return apiFetch<{ tasks: TaskBankEntry[] }>(`/api/task-bank${qs ? `?${qs}` : ''}`);
}

export function getTaskBankTags() {
  return apiFetch<{ tags: string[] }>('/api/task-bank/tags');
}
