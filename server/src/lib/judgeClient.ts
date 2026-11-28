// HTTP client for the sandboxed `judge` container (docker-compose `judge`
// service). Only the server talks to it — never the browser — and it lives on
// loopback / an internal network. See judge/Judge.java for the protocol.

const JUDGE_URL = (process.env.JUDGE_URL ?? '').replace(/\/$/, '');
const envRequestTimeoutMs = Number(process.env.JUDGE_REQUEST_TIMEOUT_MS);
const REQUEST_TIMEOUT_MS =
  Number.isFinite(envRequestTimeoutMs) && envRequestTimeoutMs > 0 ? envRequestTimeoutMs : 60_000;

// Mirrors judge/runner/shared/limits.js (RUN_TIME_LIMIT_MS) and Judge.java.
const PER_TEST_LIMIT_MS: Record<'C' | 'JS' | 'TS' | 'PYTHON', number> = {
  C: 10_000,
  JS: 10_000,
  TS: 10_000,
  PYTHON: 15_000,
};
const JAVA_DEFAULT_TEST_LIMIT_MS = 2_000;
const JAVA_MAX_TEST_LIMIT_MS = 15_000;
const COMPILE_AND_STARTUP_MARGIN_MS = 30_000;
const PER_TEST_OVERHEAD_MS = 2_000;

// Compute an HTTP request timeout that never cuts short a legitimate multi-test
// TLE (e.g. 5 × 15s Python = 75s) while honoring `minTimeoutMs` (default
// JUDGE_REQUEST_TIMEOUT_MS) as a floor.
export function computeJudgeTimeoutMs(
  req: Pick<JudgeRunRequest, 'language' | 'tests'>,
  minTimeoutMs = REQUEST_TIMEOUT_MS,
): number {
  const lang = req.language ?? 'JAVA';
  let testsBudgetMs: number;
  if (lang === 'JAVA') {
    testsBudgetMs = req.tests.reduce((sum, t) => {
      const limit =
        Number.isFinite(t.timeLimitMs) && t.timeLimitMs > 0
          ? Math.min(JAVA_MAX_TEST_LIMIT_MS, t.timeLimitMs)
          : JAVA_DEFAULT_TEST_LIMIT_MS;
      return sum + limit + PER_TEST_OVERHEAD_MS;
    }, 0);
  } else {
    testsBudgetMs = req.tests.length * (PER_TEST_LIMIT_MS[lang] + PER_TEST_OVERHEAD_MS);
  }
  return Math.max(minTimeoutMs, COMPILE_AND_STARTUP_MARGIN_MS + testsBudgetMs);
}

export function isJudgeConfigured(): boolean {
  return JUDGE_URL.length > 0;
}

export interface JudgeTestSpec {
  id: string;
  stdin: string;
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface JudgeRunRequest {
  // Omitted = Java (the historical default). Since 2026-09-26 the judge also
  // runs C / JS / TS / Python with the browser's runtimes (judge/Judge.java).
  language?: 'JAVA' | 'C' | 'JS' | 'TS' | 'PYTHON';
  code: string;
  tests: JudgeTestSpec[];
}

export interface JudgeTestOutcome {
  id: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  oom: boolean;
  // Wall-clock run time; absent from a judge image built before 2026-09-26.
  timeMs?: number;
}

export interface JudgeRunResponse {
  compile: { ok: boolean; stderr: string };
  results: JudgeTestOutcome[];
}

export class JudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeError';
  }
}

export async function runOnJudge(req: JudgeRunRequest): Promise<JudgeRunResponse> {
  if (!isJudgeConfigured()) {
    throw new JudgeError('judge_not_configured');
  }

  let res: Response;
  try {
    res = await fetch(`${JUDGE_URL}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(computeJudgeTimeoutMs(req)),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new JudgeError(`judge_unreachable: ${reason}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new JudgeError(`judge_status_${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as JudgeRunResponse;
}

export async function judgeHealthy(): Promise<boolean> {
  if (!isJudgeConfigured()) return false;
  try {
    const res = await fetch(`${JUDGE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
