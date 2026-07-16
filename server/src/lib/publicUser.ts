import type { User } from '@prisma/client';

export function toPublicUser(user: User) {
  return {
    id: user.id,
    studentNumber: user.studentNumber,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}
