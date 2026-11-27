import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('password hashing (scrypt)', () => {
  it('hashes and verifies a password with a unique random salt per call', async () => {
    const h1 = await hashPassword('correct-horse-battery');
    const h2 = await hashPassword('correct-horse-battery');

    expect(h1).toMatch(/^\$scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(h1).not.toBe(h2);
    expect(await verifyPassword('correct-horse-battery', h1)).toBe(true);
    expect(await verifyPassword('correct-horse-battery', h2)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('password123');
    expect(await verifyPassword('password124', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false for malformed or unsupported hash strings', async () => {
    expect(await verifyPassword('password123', '')).toBe(false);
    expect(await verifyPassword('password123', '$2a$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234')).toBe(false);
    expect(await verifyPassword('password123', '$scrypt$16384$8$1$not-hex$abcd')).toBe(false);
    expect(await verifyPassword('password123', '$scrypt$16384$8$1$abc$abcd')).toBe(false);
    expect(await verifyPassword('password123', '$scrypt$100$8$1$aabb$ccdd')).toBe(false);
    expect(await verifyPassword('password123', '$scrypt$16384$0$1$aabb$ccdd')).toBe(false);
    expect(await verifyPassword('password123', '$scrypt$16384$8$1$aabb')).toBe(false);
  });
});
