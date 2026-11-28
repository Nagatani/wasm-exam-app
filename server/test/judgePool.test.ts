import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkJudgeHealth,
  getJudgePoolSnapshot,
  getJudgeUrls,
  isJudgeConfigured,
  JudgeError,
  judgeHealthy,
  parseJudgeUrls,
  resetJudgePoolState,
  runOnJudge,
  type JudgeRunRequest,
  type JudgeRunResponse,
} from '../src/lib/judgeClient';

const SAMPLE_REQ: JudgeRunRequest = {
  language: 'PYTHON',
  code: 'print(1)',
  tests: [{ id: 'tc-1', stdin: '', timeLimitMs: 2000, memoryLimitMb: 256 }],
};

const OK_BODY: JudgeRunResponse = {
  compile: { ok: true, stderr: '' },
  results: [{ id: 'tc-1', stdout: '1\n', stderr: '', exitCode: 0, timedOut: false, oom: false }],
};

function okJsonResponse(body: unknown = OK_BODY): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('judgeClient multi-judge pool (P4)', () => {
  const origJudgeUrl = process.env.JUDGE_URL;
  const origJudgeUrls = process.env.JUDGE_URLS;

  beforeEach(() => {
    delete process.env.JUDGE_URL;
    delete process.env.JUDGE_URLS;
    resetJudgePoolState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (origJudgeUrl === undefined) delete process.env.JUDGE_URL;
    else process.env.JUDGE_URL = origJudgeUrl;
    if (origJudgeUrls === undefined) delete process.env.JUDGE_URLS;
    else process.env.JUDGE_URLS = origJudgeUrls;
    resetJudgePoolState();
  });

  it('supports single JUDGE_URL backwards compatibility and unconfigured state', () => {
    expect(isJudgeConfigured()).toBe(false);
    expect(getJudgeUrls()).toEqual([]);

    process.env.JUDGE_URL = 'http://localhost:4001/';
    expect(isJudgeConfigured()).toBe(true);
    expect(getJudgeUrls()).toEqual(['http://localhost:4001']);
  });

  it('parses comma-separated JUDGE_URLS, trims/normalizes, deduplicates, and prefers JUDGE_URLS over JUDGE_URL', () => {
    process.env.JUDGE_URL = 'http://legacy:8080';
    process.env.JUDGE_URLS = ' http://judge-1:8080/ , http://judge-2:8080 , http://judge-1:8080, ';
    expect(getJudgeUrls()).toEqual(['http://judge-1:8080', 'http://judge-2:8080']);
    expect(isJudgeConfigured()).toBe(true);

    // Empty/whitespace JUDGE_URLS falls back to JUDGE_URL.
    expect(parseJudgeUrls('  ,  ', 'http://legacy:8080/')).toEqual(['http://legacy:8080']);
  });

  it('throws judge_not_configured when no judge URLs are set', async () => {
    await expect(runOnJudge(SAMPLE_REQ)).rejects.toThrow(JudgeError);
    await expect(runOnJudge(SAMPLE_REQ)).rejects.toThrow('judge_not_configured');
  });

  it('routes to least-in-flight judge and tie-breaks round-robin', async () => {
    process.env.JUDGE_URLS = 'http://judge-1:8080,http://judge-2:8080,http://judge-3:8080';

    const resolvers: Array<() => void> = [];
    const calledUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);
      calledUrls.push(url);
      return new Promise<Response>((resolve) => {
        resolvers.push(() => resolve(okJsonResponse()));
      });
    });

    // Launch 3 concurrent requests -> should spread across judge-1, judge-2, judge-3.
    const p1 = runOnJudge(SAMPLE_REQ);
    const p2 = runOnJudge(SAMPLE_REQ);
    const p3 = runOnJudge(SAMPLE_REQ);

    expect(calledUrls).toEqual([
      'http://judge-1:8080/run',
      'http://judge-2:8080/run',
      'http://judge-3:8080/run',
    ]);
    expect(getJudgePoolSnapshot().map((s) => s.inFlight)).toEqual([1, 1, 1]);

    // Finish judge-2 first so it has 0 in-flight while judge-1 and judge-3 still have 1.
    resolvers[1]();
    await p2;

    const p4 = runOnJudge(SAMPLE_REQ);
    expect(calledUrls[3]).toBe('http://judge-2:8080/run');

    // Resolve all remaining requests.
    resolvers[0]();
    resolvers[2]();
    resolvers[3]();
    await Promise.all([p1, p3, p4]);
    expect(getJudgePoolSnapshot().map((s) => s.inFlight)).toEqual([0, 0, 0]);
  });

  it('fails over once to another healthy judge on connection error and applies cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));

    process.env.JUDGE_URLS = 'http://judge-1:8080,http://judge-2:8080';
    const calledUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith('http://judge-1:8080')) {
        throw new Error('ECONNREFUSED');
      }
      return okJsonResponse();
    });

    // First request picks judge-1, fails with connection error, fails over to judge-2.
    const res1 = await runOnJudge(SAMPLE_REQ);
    expect(res1).toEqual(OK_BODY);
    expect(calledUrls).toEqual(['http://judge-1:8080/run', 'http://judge-2:8080/run']);

    // Next request during 10s cooldown skips judge-1 directly and goes to judge-2.
    const res2 = await runOnJudge(SAMPLE_REQ);
    expect(res2).toEqual(OK_BODY);
    expect(calledUrls).toEqual([
      'http://judge-1:8080/run',
      'http://judge-2:8080/run',
      'http://judge-2:8080/run',
    ]);

    // After 10s cooldown expires, judge-1 is eligible again.
    vi.advanceTimersByTime(10_001);
    const snapshot = getJudgePoolSnapshot();
    expect(snapshot.find((s) => s.url === 'http://judge-1:8080')?.healthy).toBe(true);
  });

  it('fails over once on 5xx error, but does NOT fail over on 4xx client error', async () => {
    process.env.JUDGE_URLS = 'http://judge-1:8080,http://judge-2:8080';
    const calledUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.startsWith('http://judge-1:8080')) {
        return new Response('overloaded', { status: 503 });
      }
      return okJsonResponse();
    });

    const res = await runOnJudge(SAMPLE_REQ);
    expect(res).toEqual(OK_BODY);
    expect(calledUrls).toEqual(['http://judge-1:8080/run', 'http://judge-2:8080/run']);

    // Now test 400 error: should not fail over or mark unhealthy.
    resetJudgePoolState();
    calledUrls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calledUrls.push(String(input));
      return new Response('bad request', { status: 400 });
    });

    await expect(runOnJudge(SAMPLE_REQ)).rejects.toThrow('judge_status_400');
    expect(calledUrls).toEqual(['http://judge-1:8080/run']);
    expect(getJudgePoolSnapshot().every((s) => s.healthy)).toBe(true);
  });

  it('still falls back to judges when all are in cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T00:00:00Z'));

    process.env.JUDGE_URLS = 'http://judge-1:8080,http://judge-2:8080';
    let shouldSucceed = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (!shouldSucceed) {
        throw new Error('network down');
      }
      return okJsonResponse();
    });

    // Both judges fail and enter cooldown.
    await expect(runOnJudge(SAMPLE_REQ)).rejects.toThrow('judge_unreachable');
    expect(getJudgePoolSnapshot().every((s) => !s.healthy)).toBe(true);

    // Even before cooldown expires, a subsequent request still tries and recovers.
    shouldSucceed = true;
    const res = await runOnJudge(SAMPLE_REQ);
    expect(res).toEqual(OK_BODY);
  });

  it('checkJudgeHealth reports unconfigured, partial health, and full failure cleanly', async () => {
    // Unconfigured
    expect(await checkJudgeHealth()).toEqual({
      ok: false,
      configured: false,
      healthyCount: 0,
      totalCount: 0,
      judges: [],
    });
    expect(await judgeHealthy()).toBe(false);

    // 1 of 2 healthy -> overall ok = true
    process.env.JUDGE_URLS = 'http://judge-1:8080,http://judge-2:8080';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'http://judge-1:8080/health') {
        throw new Error('down');
      }
      return new Response('ok', { status: 200 });
    });

    const partial = await checkJudgeHealth();
    expect(partial).toEqual({
      ok: true,
      configured: true,
      healthyCount: 1,
      totalCount: 2,
      judges: [
        { url: 'http://judge-1:8080', ok: false },
        { url: 'http://judge-2:8080', ok: true },
      ],
    });
    expect(await judgeHealthy()).toBe(true);

    // 0 of 2 healthy -> overall ok = false
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('all down'));
    const allDown = await checkJudgeHealth();
    expect(allDown.ok).toBe(false);
    expect(allDown.configured).toBe(true);
    expect(allDown.healthyCount).toBe(0);
    expect(allDown.totalCount).toBe(2);
  });
});
