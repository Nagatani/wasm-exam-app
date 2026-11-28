import { apiFetch } from './client';
import type { Language, TaskBankEntry, TaskBankScope, TaskBankSort } from '../types/exam';

export interface TaskBankQuery {
  q?: string;
  language?: Language;
  tags?: string[];
  scope?: TaskBankScope;
  sort?: TaskBankSort;
}

export function searchTaskBank(query: TaskBankQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.language) params.set('language', query.language);
  if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','));
  if (query.scope && query.scope !== 'all') params.set('scope', query.scope);
  if (query.sort && query.sort !== 'newest') params.set('sort', query.sort);
  const qs = params.toString();
  return apiFetch<{ tasks: TaskBankEntry[] }>(`/api/task-bank${qs ? `?${qs}` : ''}`);
}

export function getTaskBankTags() {
  return apiFetch<{ tags: string[] }>('/api/task-bank/tags');
}
