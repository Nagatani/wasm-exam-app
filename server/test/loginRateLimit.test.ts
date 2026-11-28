import { afterEach, describe, expect, it } from 'vitest';
import {
  clearIpRateLimit,
  loginBlockedForMs,
  recordLoginFailure,
  resetLoginRateLimit,
} from '../src/lib/loginRateLimit';

describe('loginRateLimit', () => {
  const originalPerIp = process.env.LOGIN_MAX_FAILURES_PER_IP;

  afterEach(() => {
    resetLoginRateLimit();
    if (originalPerIp === undefined) {
      delete process.env.LOGIN_MAX_FAILURES_PER_IP;
    } else {
      process.env.LOGIN_MAX_FAILURES_PER_IP = originalPerIp;
    }
  });

  it('defaults LOGIN_MAX_FAILURES_PER_IP to 300 for shared classroom NATs', () => {
    delete process.env.LOGIN_MAX_FAILURES_PER_IP;
    const now = 1_000_000;
    const classroomIp = '203.0.113.10';

    // 299 distinct students each mistyping once must still be allowed.
    for (let i = 0; i < 299; i++) {
      recordLoginFailure(`s${i}`, classroomIp, now);
    }
    expect(loginBlockedForMs('s999', classroomIp, now)).toBe(0);

    // The 300th failure trips the per-IP cap.
    recordLoginFailure('s299', classroomIp, now);
    expect(loginBlockedForMs('s999', classroomIp, now)).toBeGreaterThan(0);
  });

  it('clearIpRateLimit(ip) clears only that IP and preserves other IPs and per-account locks', () => {
    process.env.LOGIN_MAX_FAILURES_PER_IP = '5';
    const now = 1_000_000;
    const ipA = '203.0.113.1';
    const ipB = '203.0.113.2';

    // Trip per-IP lockout on ipA and ipB, and also trip per-account lockout for s001 on ipA.
    for (let i = 0; i < 10; i++) {
      recordLoginFailure('s001', ipA, now);
    }
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(`b${i}`, ipB, now);
    }

    expect(loginBlockedForMs('other', ipA, now)).toBeGreaterThan(0);
    expect(loginBlockedForMs('other', ipB, now)).toBeGreaterThan(0);

    expect(clearIpRateLimit(ipA)).toBe(1);
    expect(clearIpRateLimit(ipA)).toBe(0);

    // Other students on ipA are unblocked; s001's own account lock remains; ipB remains locked.
    expect(loginBlockedForMs('other', ipA, now)).toBe(0);
    expect(loginBlockedForMs('s001', ipA, now)).toBeGreaterThan(0);
    expect(loginBlockedForMs('other', ipB, now)).toBeGreaterThan(0);
  });

  it('clearIpRateLimit() with no argument clears all IP entries while keeping per-account locks', () => {
    process.env.LOGIN_MAX_FAILURES_PER_IP = '5';
    const now = 1_000_000;
    const ipA = '203.0.113.1';
    const ipB = '203.0.113.2';

    for (let i = 0; i < 10; i++) {
      recordLoginFailure('s001', ipA, now);
    }
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(`b${i}`, ipB, now);
    }

    expect(clearIpRateLimit()).toBe(2);
    expect(clearIpRateLimit()).toBe(0);

    expect(loginBlockedForMs('other', ipA, now)).toBe(0);
    expect(loginBlockedForMs('other', ipB, now)).toBe(0);
    // Per-account lock for s001 is still intact.
    expect(loginBlockedForMs('s001', ipA, now)).toBeGreaterThan(0);
  });
});
