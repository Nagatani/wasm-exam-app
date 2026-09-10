import { apiFetch, ApiError } from './client';
import type { UserProfile } from '../types/user';

interface UserResponse {
  user: UserProfile;
}

export function signUp(studentNumber: string, password: string) {
  return apiFetch<UserResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ studentNumber, password }),
  });
}

export function logIn(studentNumber: string, password: string) {
  return apiFetch<UserResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ studentNumber, password }),
  });
}

export function logOut() {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiFetch<{ ok: true }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function fetchMe(): Promise<UserProfile | null> {
  try {
    const { user } = await apiFetch<UserResponse>('/api/auth/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}
