export type UserRole = 'STUDENT' | 'TEACHER';

export interface UserProfile {
  id: string;
  studentNumber: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}
