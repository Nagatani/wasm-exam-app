export type UserRole = 'STUDENT' | 'TEACHER';

export interface UserProfile {
  id: string;
  studentNumber: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  // Bulk-provisioned account that must set its own password before doing
  // anything else.
  mustChangePassword: boolean;
}
