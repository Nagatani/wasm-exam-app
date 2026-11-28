import { randomBytes, createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import { prisma } from './prisma';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export const SESSION_COOKIE_NAME = 'session_token';
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;

// Short-lived in-memory LRU/TTL cache for authenticated session lookups.
// Single-instance server assumption (same as loginRateLimit.ts): every
// revocation or user-profile mutation immediately invalidates matching entries
// so force-logout / password-reset / role-change semantics remain immediate.
export const SESSION_CACHE_TTL_MS = 15_000;
export const SESSION_CACHE_MAX_ENTRIES = 2_000;

interface SessionCacheEntry {
  user: User;
  sessionExpiresAtMs: number;
  cachedUntilMs: number;
}

const sessionCache = new Map<string, SessionCacheEntry>();

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getCachedSessionUser(tokenHash: string, now: number): User | undefined {
  const entry = sessionCache.get(tokenHash);
  if (!entry) return undefined;
  if (now >= entry.cachedUntilMs || now >= entry.sessionExpiresAtMs) {
    sessionCache.delete(tokenHash);
    return undefined;
  }
  // Refresh LRU recency by moving key to the end of the Map.
  sessionCache.delete(tokenHash);
  sessionCache.set(tokenHash, entry);
  return entry.user;
}

function setCachedSessionUser(
  tokenHash: string,
  user: User,
  sessionExpiresAtMs: number,
  now: number,
): void {
  const cachedUntilMs = Math.min(now + SESSION_CACHE_TTL_MS, sessionExpiresAtMs);
  if (cachedUntilMs <= now) return;

  if (sessionCache.has(tokenHash)) {
    sessionCache.delete(tokenHash);
  } else if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = sessionCache.keys().next().value;
    if (oldestKey !== undefined) {
      sessionCache.delete(oldestKey);
    }
  }
  sessionCache.set(tokenHash, { user, sessionExpiresAtMs, cachedUntilMs });
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

export function invalidateSessionCacheForUser(userId: string): void {
  for (const [key, entry] of sessionCache) {
    if (entry.user.id === userId) {
      sessionCache.delete(key);
    }
  }
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
  const tokenHash = hashToken(token);
  const now = Date.now();
  const cached = getCachedSessionUser(tokenHash, now);
  if (cached) {
    return cached;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session || session.revoked || session.expiresAt.getTime() < Date.now()) {
    sessionCache.delete(tokenHash);
    return null;
  }

  setCachedSessionUser(tokenHash, session.user, session.expiresAt.getTime(), Date.now());
  return session.user;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  sessionCache.delete(tokenHash);
  await prisma.session.updateMany({
    where: { tokenHash },
    data: { revoked: true },
  });
  sessionCache.delete(tokenHash);
}

/**
 * Revokes all active sessions for a user and immediately purges any cached
 * session entries for that user.
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  invalidateSessionCacheForUser(userId);
  const { count } = await prisma.session.updateMany({
    where: { userId, revoked: false, expiresAt: { gt: new Date() } },
    data: { revoked: true },
  });
  invalidateSessionCacheForUser(userId);
  return count;
}

/**
 * Deletes session rows that can never authenticate again — expired or
 * revoked. Nothing else ever removes them, so without this the `sessions`
 * table grows by one row per login forever. Safe to run at any time: a
 * deleted row and a revoked/expired row are treated identically by
 * getUserForSessionToken (both → not signed in). Returns the deleted count.
 */
export async function purgeStaleSessions(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  for (const [key, entry] of sessionCache) {
    if (entry.sessionExpiresAtMs < nowMs) {
      sessionCache.delete(key);
    }
  }
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
