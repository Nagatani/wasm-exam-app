// Brute-force protection for POST /api/auth/login. In-memory, fixed-window
// failure counters — fine because the server runs as a single instance (the
// judge queue in executionQueue.ts makes the same assumption).
//
// Two independent counters are bumped on every failed login:
//   - per (studentNumber, IP): a low cap, so guessing one account's password
//     from one machine is stopped quickly. Keyed by IP too so someone who only
//     knows a classmate's 学籍番号 can't lock that classmate out from their own
//     machine... except from the same IP, which in a NAT'd classroom is
//     unavoidable and accepted.
//   - per IP: a much higher cap (a whole classroom may share one NAT address
//     and legitimately mistype), to stop spraying many accounts from one host.
// A successful login clears the per-account counter only.
//
// Behind a reverse proxy, set TRUST_PROXY (see app.ts) or every request looks
// like it comes from the proxy's address and the per-IP cap becomes global.

interface Bucket {
  failures: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
}

function limits() {
  return {
    perAccount: intEnv('LOGIN_MAX_FAILURES', 10),
    perIp: intEnv('LOGIN_MAX_FAILURES_PER_IP', 100),
    windowMs: intEnv('LOGIN_LOCKOUT_MINUTES', 15) * 60_000,
  };
}

const accountKey = (studentNumber: string, ip: string) => `acct:${studentNumber.toLowerCase()}|${ip}`;
const ipKey = (ip: string) => `ip:${ip}`;

function live(key: string, now: number): Bucket | undefined {
  const b = buckets.get(key);
  if (b && b.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return b;
}

// Returns the milliseconds until the caller may try again, or 0 if allowed.
export function loginBlockedForMs(studentNumber: string, ip: string, now = Date.now()): number {
  const { perAccount, perIp } = limits();
  let wait = 0;
  const a = live(accountKey(studentNumber, ip), now);
  if (a && a.failures >= perAccount) wait = Math.max(wait, a.resetAt - now);
  const i = live(ipKey(ip), now);
  if (i && i.failures >= perIp) wait = Math.max(wait, i.resetAt - now);
  return wait;
}

export function recordLoginFailure(studentNumber: string, ip: string, now = Date.now()): void {
  const { windowMs } = limits();
  for (const key of [accountKey(studentNumber, ip), ipKey(ip)]) {
    const b = live(key, now);
    if (b) b.failures += 1;
    else buckets.set(key, { failures: 1, resetAt: now + windowMs });
  }
  if (buckets.size > 10_000) sweep(now);
}

export function recordLoginSuccess(studentNumber: string, ip: string): void {
  buckets.delete(accountKey(studentNumber, ip));
}

// A teacher's password reset should also lift any lockout on that account,
// from every IP.
export function clearLoginFailuresFor(studentNumber: string): void {
  const prefix = `acct:${studentNumber.toLowerCase()}|`;
  for (const key of buckets.keys()) {
    if (key.startsWith(prefix)) buckets.delete(key);
  }
}

function sweep(now: number): void {
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

// Tests only: the integration suite shares one app process across tests.
export function resetLoginRateLimit(): void {
  buckets.clear();
}
