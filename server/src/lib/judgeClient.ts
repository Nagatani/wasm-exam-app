// HTTP client for the sandboxed `judge` container(s) (docker-compose `judge`
// service). Only the server talks to them — never the browser — and they live
// on loopback / an internal network. See judge/Judge.java for the protocol.

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

// Temporary cooldown applied to a judge endpoint after a network/5xx error so
// traffic shifts to healthy judges while allowing automatic recovery.
const JUDGE_UNHEALTHY_COOLDOWN_MS = 10_000;

interface JudgeNodeState {
  inFlight: number;
  unhealthyUntil: number;
}

const nodeStates = new Map<string, JudgeNodeState>();
let roundRobinCursor = 0;

function normalizeUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * Parse configured judge base URLs. `JUDGE_URLS` (comma-separated) takes
 * precedence when non-empty; otherwise falls back to single `JUDGE_URL`.
 */
export function parseJudgeUrls(
  judgeUrlsRaw = process.env.JUDGE_URLS,
  judgeUrlRaw = process.env.JUDGE_URL,
): string[] {
  const fromMulti = (judgeUrlsRaw ?? '')
    .split(',')
    .map(normalizeUrl)
    .filter((u) => u.length > 0);
  if (fromMulti.length > 0) {
    return Array.from(new Set(fromMulti));
  }
  const single = normalizeUrl(judgeUrlRaw ?? '');
  return single.length > 0 ? [single] : [];
}

export function getJudgeUrls(): string[] {
  return parseJudgeUrls();
}

export function isJudgeConfigured(): boolean {
  return getJudgeUrls().length > 0;
}

function getNodeState(url: string): JudgeNodeState {
  let state = nodeStates.get(url);
  if (!state) {
    state = { inFlight: 0, unhealthyUntil: 0 };
    nodeStates.set(url, state);
  }
  return state;
}

function isNodeHealthy(url: string, now: number): boolean {
  return getNodeState(url).unhealthyUntil <= now;
}

function markNodeUnhealthy(url: string, now: number): void {
  getNodeState(url).unhealthyUntil = now + JUDGE_UNHEALTHY_COOLDOWN_MS;
}

function markNodeHealthy(url: string): void {
  getNodeState(url).unhealthyUntil = 0;
}

export function resetJudgePoolState(): void {
  nodeStates.clear();
  roundRobinCursor = 0;
}

export function getJudgePoolSnapshot(): Array<{
  url: string;
  inFlight: number;
  healthy: boolean;
  unhealthyUntil: number;
}> {
  const now = Date.now();
  return getJudgeUrls().map((url) => {
    const state = getNodeState(url);
    return {
      url,
      inFlight: state.inFlight,
      healthy: state.unhealthyUntil <= now,
      unhealthyUntil: state.unhealthyUntil,
    };
  });
}

function selectJudgeUrl(
  urls: string[],
  exclude?: Set<string>,
  healthyOnly = false,
): string | null {
  const now = Date.now();
  const candidates: number[] = [];
  for (let i = 0; i < urls.length; i++) {
    if (!exclude?.has(urls[i])) {
      candidates.push(i);
    }
  }
  if (candidates.length === 0) return null;

  const healthyCandidates = candidates.filter((i) => isNodeHealthy(urls[i], now));
  if (healthyOnly && healthyCandidates.length === 0) {
    return null;
  }
  // If every judge is currently in cooldown, fall back to all candidates so
  // grading still attempts recovery rather than failing immediately.
  const pool = healthyCandidates.length > 0 ? healthyCandidates : candidates;

  const start = roundRobinCursor % urls.length;
  let bestIdx = pool[0];
  let bestInFlight = getNodeState(urls[bestIdx]).inFlight;
  let bestDist = (bestIdx - start + urls.length) % urls.length;

  for (let k = 1; k < pool.length; k++) {
    const idx = pool[k];
    const inFlight = getNodeState(urls[idx]).inFlight;
    const dist = (idx - start + urls.length) % urls.length;
    if (inFlight < bestInFlight || (inFlight === bestInFlight && dist < bestDist)) {
      bestIdx = idx;
      bestInFlight = inFlight;
      bestDist = dist;
    }
  }

  roundRobinCursor = (bestIdx + 1) % urls.length;
  return urls[bestIdx];
}

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

export interface JudgeHealthEndpoint {
  url: string;
  ok: boolean;
}

export interface JudgeHealthReport {
  ok: boolean;
  configured: boolean;
  healthyCount: number;
  totalCount: number;
  judges: JudgeHealthEndpoint[];
}

export class JudgeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeError';
  }
}

interface AttemptResult {
  response?: JudgeRunResponse;
  error?: JudgeError;
  retryable?: boolean;
}

async function executeOnJudge(url: string, req: JudgeRunRequest): Promise<AttemptResult> {
  const state = getNodeState(url);
  state.inFlight += 1;
  try {
    let res: Response;
    try {
      res = await fetch(`${url}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
        signal: AbortSignal.timeout(computeJudgeTimeoutMs(req)),
      });
    } catch (err) {
      markNodeUnhealthy(url, Date.now());
      const reason = err instanceof Error ? err.message : String(err);
      return {
        error: new JudgeError(`judge_unreachable: ${reason}`),
        retryable: true,
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const isServerError = res.status >= 500;
      if (isServerError) {
        markNodeUnhealthy(url, Date.now());
      }
      return {
        error: new JudgeError(`judge_status_${res.status}: ${text.slice(0, 200)}`),
        retryable: isServerError,
      };
    }

    markNodeHealthy(url);
    return { response: (await res.json()) as JudgeRunResponse };
  } finally {
    state.inFlight = Math.max(0, state.inFlight - 1);
  }
}

export async function runOnJudge(req: JudgeRunRequest): Promise<JudgeRunResponse> {
  const urls = getJudgeUrls();
  if (urls.length === 0) {
    throw new JudgeError('judge_not_configured');
  }

  const primaryUrl = selectJudgeUrl(urls)!;
  const first = await executeOnJudge(primaryUrl, req);
  if (first.response) {
    return first.response;
  }

  // On connection/5xx failure when multiple judges are configured, fail over
  // once to another currently healthy judge.
  if (first.retryable && urls.length > 1) {
    const fallbackUrl = selectJudgeUrl(urls, new Set([primaryUrl]), true);
    if (fallbackUrl) {
      const second = await executeOnJudge(fallbackUrl, req);
      if (second.response) {
        return second.response;
      }
      throw second.error!;
    }
  }

  throw first.error!;
}

export async function checkJudgeHealth(): Promise<JudgeHealthReport> {
  const urls = getJudgeUrls();
  if (urls.length === 0) {
    return {
      ok: false,
      configured: false,
      healthyCount: 0,
      totalCount: 0,
      judges: [],
    };
  }

  const judges = await Promise.all(
    urls.map(async (url): Promise<JudgeHealthEndpoint> => {
      try {
        const res = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          markNodeHealthy(url);
          return { url, ok: true };
        }
        if (res.status >= 500) {
          markNodeUnhealthy(url, Date.now());
        }
        return { url, ok: false };
      } catch {
        markNodeUnhealthy(url, Date.now());
        return { url, ok: false };
      }
    }),
  );

  const healthyCount = judges.filter((j) => j.ok).length;
  return {
    ok: healthyCount > 0,
    configured: true,
    healthyCount,
    totalCount: judges.length,
    judges,
  };
}

export async function judgeHealthy(): Promise<boolean> {
  return (await checkJudgeHealth()).ok;
}
