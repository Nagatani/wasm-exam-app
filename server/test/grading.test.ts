import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeJudgeTimeoutMs, type JudgeRunRequest } from '../src/lib/judgeClient';

const mockFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockRunOnJudge = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    examAttempt: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock('../src/lib/judgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/judgeClient')>();
  return {
    ...actual,
    runOnJudge: (...args: unknown[]) => mockRunOnJudge(...args),
  };
});

import {
  computeRetryDelayMs,
  enqueueGrading,
  getGradingQueuePosition,
  gradeAttempt,
  resetGradingQueue,
  waitForGradingIdle,
} from '../src/lib/grading';

function makeTests(count: number, timeLimitMs = 2_000): JudgeRunRequest['tests'] {
  return Array.from({ length: count }, (_, i) => ({
    id: `tc-${i}`,
    stdin: '',
    timeLimitMs,
    memoryLimitMb: 256,
  }));
}

describe('computeJudgeTimeoutMs', () => {
  it('never cuts short a 5-test Python TLE (5 x 15s = 75s)', () => {
    const timeout = computeJudgeTimeoutMs({ language: 'PYTHON', tests: makeTests(5) }, 60_000);
    // 30_000 margin + 5 * (15_000 + 2_000) = 115_000
    expect(timeout).toBeGreaterThan(75_000);
    expect(timeout).toBe(115_000);
  });

  it('scales for multi-test C / JS / TS submissions', () => {
    for (const language of ['C', 'JS', 'TS'] as const) {
      const timeout = computeJudgeTimeoutMs({ language, tests: makeTests(10) }, 60_000);
      // 30_000 + 10 * (10_000 + 2_000) = 150_000
      expect(timeout).toBe(150_000);
    }
  });

  it('sums per-test timeLimitMs for Java and clamps huge values', () => {
    const normal = computeJudgeTimeoutMs({ language: 'JAVA', tests: makeTests(10, 5_000) }, 60_000);
    // 30_000 + 10 * (5_000 + 2_000) = 100_000
    expect(normal).toBe(100_000);

    const clamped = computeJudgeTimeoutMs({ tests: makeTests(5, 999_999) }, 60_000);
    // Omitted language defaults to JAVA; each test clamped to 15_000 -> 30_000 + 5 * 17_000 = 115_000
    expect(clamped).toBe(115_000);
  });

  it('honors minTimeoutMs as a floor for small test suites', () => {
    expect(computeJudgeTimeoutMs({ language: 'PYTHON', tests: makeTests(1) }, 60_000)).toBe(60_000);
    expect(computeJudgeTimeoutMs({ language: 'JAVA', tests: makeTests(1, 2_000) }, 90_000)).toBe(90_000);
    expect(computeJudgeTimeoutMs({ language: 'JS', tests: [] }, 60_000)).toBe(60_000);
  });
});

describe('computeRetryDelayMs', () => {
  it('doubles exponentially up to maxDelayMs', () => {
    const mid = () => 0.5; // jitter factor = 1.0
    expect(computeRetryDelayMs(0, 5_000, 60_000, mid)).toBe(5_000);
    expect(computeRetryDelayMs(1, 5_000, 60_000, mid)).toBe(10_000);
    expect(computeRetryDelayMs(2, 5_000, 60_000, mid)).toBe(20_000);
    expect(computeRetryDelayMs(3, 5_000, 60_000, mid)).toBe(40_000);
    expect(computeRetryDelayMs(4, 5_000, 60_000, mid)).toBe(60_000);
    expect(computeRetryDelayMs(10, 5_000, 60_000, mid)).toBe(60_000);
  });

  it('applies ±20% jitter without exceeding maxDelayMs', () => {
    expect(computeRetryDelayMs(0, 5_000, 60_000, () => 0)).toBe(4_000);
    expect(computeRetryDelayMs(0, 5_000, 60_000, () => 1)).toBe(6_000);
    // At the cap, upward jitter must not exceed maxDelayMs.
    expect(computeRetryDelayMs(5, 5_000, 60_000, () => 1)).toBe(60_000);
    expect(computeRetryDelayMs(5, 5_000, 60_000, () => 0)).toBe(48_000);
  });

  it('supports fast base delays for tests (e.g. GRADING_RETRY_MS=1000)', () => {
    const delay = computeRetryDelayMs(0, 1_000, 60_000, () => 0.5);
    expect(delay).toBe(1_000);
  });
});

describe('gradeAttempt task memoization', () => {
  afterEach(() => {
    resetGradingQueue();
    vi.clearAllMocks();
  });

  it('does not re-run already completed tasks when a later task fails and retries', async () => {
    const attemptFixture = {
      id: 'attempt-1',
      examId: 'exam-1',
      studentId: 'student-1',
      status: 'GRADING',
      exam: {
        tasks: [
          {
            id: 'task-1',
            language: 'PYTHON',
            points: 10,
            comparisonMode: 'EXACT',
            floatTolerance: null,
            allowPartialCredit: false,
            testCases: [
              { id: 'tc-1', input: '1\n', expectedOutput: '1', timeLimitMs: 2000, memoryLimitMb: 256 },
            ],
          },
          {
            id: 'task-2',
            language: 'PYTHON',
            points: 20,
            comparisonMode: 'EXACT',
            floatTolerance: null,
            allowPartialCredit: false,
            testCases: [
              { id: 'tc-2', input: '2\n', expectedOutput: '2', timeLimitMs: 2000, memoryLimitMb: 256 },
            ],
          },
        ],
      },
      drafts: [
        {
          taskId: 'task-1',
          code: 'print(1)',
          keystrokeCount: 1,
          pasteCount: 0,
          pastedCharCount: 0,
          timeSpentSeconds: 10,
        },
        {
          taskId: 'task-2',
          code: 'print(2)',
          keystrokeCount: 1,
          pasteCount: 0,
          pastedCharCount: 0,
          timeSpentSeconds: 10,
        },
      ],
    };

    mockFindUnique.mockResolvedValue(attemptFixture);
    const createdSubmissions: unknown[] = [];
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        examAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        submission: {
          createMany: vi.fn().mockImplementation(async ({ data }: { data: unknown[] }) => {
            createdSubmissions.push(...data);
          }),
        },
      }),
    );

    // First attempt: task-1 succeeds, task-2 throws a transient judge error.
    mockRunOnJudge
      .mockResolvedValueOnce({
        compile: { ok: true, stderr: '' },
        results: [{ id: 'tc-1', stdout: '1\n', stderr: '', exitCode: 0, timedOut: false, oom: false }],
      })
      .mockRejectedValueOnce(new Error('judge_unreachable: transient'))
      // Retry: only task-2 should be invoked on the judge.
      .mockResolvedValueOnce({
        compile: { ok: true, stderr: '' },
        results: [{ id: 'tc-2', stdout: '2\n', stderr: '', exitCode: 0, timedOut: false, oom: false }],
      });

    await expect(gradeAttempt('attempt-1')).rejects.toThrow('judge_unreachable');
    expect(mockRunOnJudge).toHaveBeenCalledTimes(2);

    const outcome = await gradeAttempt('attempt-1');
    expect(outcome).toBe('done');
    // task-1 was served from the retry-cycle cache, so total calls = 3 (not 4).
    expect(mockRunOnJudge).toHaveBeenCalledTimes(3);
    expect(createdSubmissions).toHaveLength(2);
  });
});

describe('getGradingQueuePosition', () => {
  afterEach(() => {
    resetGradingQueue();
    vi.clearAllMocks();
  });

  it('returns null for unknown attempts, 0 for running, and 1-based index for queued', async () => {
    expect(getGradingQueuePosition('unknown')).toBeNull();

    // Hold gradeAttempt open via mockFindUnique so default CONCURRENCY (4)
    // slots fill up and subsequent attempts stay in the wait queue.
    const resolvers = new Map<string, () => void>();
    mockFindUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        new Promise((resolve) => {
          resolvers.set(where.id, () => resolve(null));
        }),
    );

    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    for (const id of ids) enqueueGrading(id);

    // First 4 are actively running (position 0); a5 and a6 are waiting (1 and 2).
    expect(getGradingQueuePosition('a1')).toEqual({ position: 0, total: 6 });
    expect(getGradingQueuePosition('a4')).toEqual({ position: 0, total: 6 });
    expect(getGradingQueuePosition('a5')).toEqual({ position: 1, total: 6 });
    expect(getGradingQueuePosition('a6')).toEqual({ position: 2, total: 6 });

    // Finish all in-flight attempts (resolving a1..a4 lets a5..a6 start).
    for (const id of ['a1', 'a2', 'a3', 'a4']) resolvers.get(id)?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(getGradingQueuePosition('a1')).toBeNull();
    expect(getGradingQueuePosition('a5')).toEqual({ position: 0, total: 2 });
    expect(getGradingQueuePosition('a6')).toEqual({ position: 0, total: 2 });

    for (const id of ['a5', 'a6']) resolvers.get(id)?.();
    await waitForGradingIdle();

    expect(getGradingQueuePosition('a5')).toBeNull();
    expect(getGradingQueuePosition('a6')).toBeNull();
  });
});
