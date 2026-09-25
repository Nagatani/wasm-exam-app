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

/**
 * Deletes session rows that can never authenticate again — expired or
 * revoked. Nothing else ever removes them, so without this the `sessions`
 * table grows by one row per login forever. Safe to run at any time: a
 * deleted row and a revoked/expired row are treated identically by
 * getUserForSessionToken (both → not signed in). Returns the deleted count.
 */
export async function purgeStaleSessions(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: now } }, { revoked: true }] },
  });
  return count;
}

const DEFAULT_CLEANUP_INTERVAL_HOURS = 6;

/**
 * Runs purgeStaleSessions once at startup and then every
 * SESSION_CLEANUP_INTERVAL_HOURS (default 6; 0 disables). Called from
 * index.ts only — not createApp() — so tests never start a timer. The timer
 * is unref()'d so it never keeps the process alive on its own.
 */
export function startSessionCleanup(): void {
  const raw = process.env.SESSION_CLEANUP_INTERVAL_HOURS;
  const hours = raw === undefined || raw === '' ? DEFAULT_CLEANUP_INTERVAL_HOURS : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return;

  const run = () =>
    purgeStaleSessions()
      .then((n) => {
        if (n > 0) console.log(`session cleanup: deleted ${n} expired/revoked session(s)`);
      })
      .catch((err) => console.error('session cleanup failed:', err));

  void run();
  setInterval(run, hours * 60 * 60 * 1000).unref();
}
