import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@prisma/client';

const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    session: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

import {
  clearSessionCache,
  getUserForSessionToken,
  invalidateSessionCacheForUser,
  revokeAllUserSessions,
  revokeSessionByToken,
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_TTL_MS,
} from '../src/lib/session';

function makeUser(id: string): User {
  return {
    id,
    studentNumber: `s${id}`,
    passwordHash: 'hash',
    displayName: `Student ${id}`,
    role: 'STUDENT',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    mustChangePassword: false,
    initialPassword: null,
  };
}

describe('session short-lived LRU/TTL cache (P5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));
    clearSessionCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearSessionCache();
    vi.useRealTimers();
  });

  it('serves repeated lookups within TTL from cache without hitting the DB again', async () => {
    const user = makeUser('u1');
    mockFindUnique.mockResolvedValue({
      id: 'sess-1',
      userId: user.id,
      tokenHash: 'ignored',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
      user,
    });

    const first = await getUserForSessionToken('token-1');
    const second = await getUserForSessionToken('token-1');

    expect(first).toEqual(user);
    expect(second).toEqual(user);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it('re-queries DB once TTL expires', async () => {
    const user = makeUser('u1');
    mockFindUnique.mockResolvedValue({
      id: 'sess-1',
      userId: user.id,
      tokenHash: 'ignored',
      expiresAt: new Date(Date.now() + 60 * 60_000),
      revoked: false,
      user,
    });

    await getUserForSessionToken('token-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    // Just before TTL: still cached.
    vi.advanceTimersByTime(SESSION_CACHE_TTL_MS - 1);
    await getUserForSessionToken('token-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    // At/past TTL: must re-query DB.
    vi.advanceTimersByTime(2);
    await getUserForSessionToken('token-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('never serves a cached session past its own expiresAt even if shorter than TTL', async () => {
    const user = makeUser('u1');
    const expiresAt = new Date(Date.now() + 5_000);
    mockFindUnique.mockResolvedValue({
      id: 'sess-1',
      userId: user.id,
      tokenHash: 'ignored',
      expiresAt,
      revoked: false,
      user,
    });

    expect(await getUserForSessionToken('short-token')).toEqual(user);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_001);
    expect(await getUserForSessionToken('short-token')).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('immediately invalidates cache on revokeSessionByToken', async () => {
    const user = makeUser('u1');
    mockFindUnique.mockResolvedValueOnce({
      id: 'sess-1',
      userId: user.id,
      tokenHash: 'ignored',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: false,
      user,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    expect(await getUserForSessionToken('token-revoke')).toEqual(user);
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    await revokeSessionByToken('token-revoke');

    // Subsequent lookup must hit DB (not stale cache) and observe revoked=true.
    mockFindUnique.mockResolvedValueOnce({
      id: 'sess-1',
      userId: user.id,
      tokenHash: 'ignored',
      expiresAt: new Date(Date.now() + 60_000),
      revoked: true,
      user,
    });
    expect(await getUserForSessionToken('token-revoke')).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });

  it('immediately invalidates all sessions for a user on revokeAllUserSessions without affecting other users', async () => {
    const u1 = makeUser('u1');
    const u2 = makeUser('u2');
    const expiresAt = new Date(Date.now() + 60_000);

    mockFindUnique
      .mockResolvedValueOnce({ id: 's1a', userId: u1.id, tokenHash: 'h1a', expiresAt, revoked: false, user: u1 })
      .mockResolvedValueOnce({ id: 's1b', userId: u1.id, tokenHash: 'h1b', expiresAt, revoked: false, user: u1 })
      .mockResolvedValueOnce({ id: 's2a', userId: u2.id, tokenHash: 'h2a', expiresAt, revoked: false, user: u2 });
    mockUpdateMany.mockResolvedValue({ count: 2 });

    await getUserForSessionToken('u1-tok-a');
    await getUserForSessionToken('u1-tok-b');
    await getUserForSessionToken('u2-tok-a');
    expect(mockFindUnique).toHaveBeenCalledTimes(3);

    const revoked = await revokeAllUserSessions(u1.id);
    expect(revoked).toBe(2);

    // u2 remains cached (still 3 DB calls).
    expect(await getUserForSessionToken('u2-tok-a')).toEqual(u2);
    expect(mockFindUnique).toHaveBeenCalledTimes(3);

    // Both u1 tokens were purged and must re-query DB.
    mockFindUnique.mockResolvedValue({ id: 's1', userId: u1.id, tokenHash: 'h', expiresAt, revoked: true, user: u1 });
    expect(await getUserForSessionToken('u1-tok-a')).toBeNull();
    expect(await getUserForSessionToken('u1-tok-b')).toBeNull();
    expect(mockFindUnique).toHaveBeenCalledTimes(5);
  });

  it('invalidates user entries via invalidateSessionCacheForUser and clears all via clearSessionCache', async () => {
    const u1 = makeUser('u1');
    const expiresAt = new Date(Date.now() + 60_000);
    mockFindUnique.mockResolvedValue({
      id: 's1',
      userId: u1.id,
      tokenHash: 'h1',
      expiresAt,
      revoked: false,
      user: u1,
    });

    await getUserForSessionToken('tok-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(1);

    invalidateSessionCacheForUser(u1.id);
    await getUserForSessionToken('tok-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(2);

    clearSessionCache();
    await getUserForSessionToken('tok-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(3);
  });

  it('evicts least-recently-used entries when exceeding SESSION_CACHE_MAX_ENTRIES', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    mockFindUnique.mockImplementation(async () => ({
      id: 's',
      userId: 'u',
      tokenHash: 'h',
      expiresAt,
      revoked: false,
      user: makeUser('u'),
    }));

    // Fill cache to capacity: token-0 .. token-(MAX-1).
    for (let i = 0; i < SESSION_CACHE_MAX_ENTRIES; i++) {
      await getUserForSessionToken(`token-${i}`);
    }
    expect(mockFindUnique).toHaveBeenCalledTimes(SESSION_CACHE_MAX_ENTRIES);

    // Touch token-0 so it becomes most-recently-used; token-1 is now LRU.
    await getUserForSessionToken('token-0');
    expect(mockFindUnique).toHaveBeenCalledTimes(SESSION_CACHE_MAX_ENTRIES);

    // Insert one more entry -> evicts token-1 (not token-0).
    await getUserForSessionToken('token-overflow');
    expect(mockFindUnique).toHaveBeenCalledTimes(SESSION_CACHE_MAX_ENTRIES + 1);

    // token-0 is still cached (no new DB call).
    await getUserForSessionToken('token-0');
    expect(mockFindUnique).toHaveBeenCalledTimes(SESSION_CACHE_MAX_ENTRIES + 1);

    // token-1 was evicted (triggers a DB call).
    await getUserForSessionToken('token-1');
    expect(mockFindUnique).toHaveBeenCalledTimes(SESSION_CACHE_MAX_ENTRIES + 2);
  });
});
