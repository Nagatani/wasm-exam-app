import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_LEN = 64;

const HEX_RE = /^[0-9a-f]+$/i;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 7 || parts[0] !== '' || parts[1] !== 'scrypt') {
    return false;
  }

  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const saltHex = parts[5];
  const hashHex = parts[6];

  if (
    !Number.isSafeInteger(N) ||
    N <= 1 ||
    (N & (N - 1)) !== 0 ||
    N > 1 << 20 ||
    !Number.isSafeInteger(r) ||
    r < 1 ||
    r > 64 ||
    !Number.isSafeInteger(p) ||
    p < 1 ||
    p > 16
  ) {
    return false;
  }

  if (
    !saltHex ||
    !hashHex ||
    saltHex.length % 2 !== 0 ||
    hashHex.length % 2 !== 0 ||
    !HEX_RE.test(saltHex) ||
    !HEX_RE.test(hashHex)
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;

  try {
    const derived = await scryptAsync(password, salt, expected.length, { N, r, p });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
