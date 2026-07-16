import { randomBytes, createHash } from 'node:crypto';
import { prisma } from './prisma';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const SESSION_COOKIE_NAME = 'session_token';
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a session row and returns the raw token to hand to the client.
 * Only the SHA-256 hash is persisted, so a database dump can't be replayed
 * as a valid session cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function getUserForSessionToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.revoked || session.expiresAt < new Date()) {
    return null;
  }

  return session.user;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token) },
    data: { revoked: true },
  });
}
