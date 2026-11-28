import { afterEach, describe, expect, it, vi } from 'vitest';

const mockAttemptFindUnique = vi.fn();
const mockAttemptFindMany = vi.fn();
const mockAttemptUpdateMany = vi.fn();
const mockExtensionFindUnique = vi.fn();
const mockSubmissionCreateMany = vi.fn();
const mockBeginGrading = vi.fn();
const mockIsServerGraded = vi.fn();

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    examAttempt: {
      findUnique: (...args: unknown[]) => mockAttemptFindUnique(...args),
      findMany: (...args: unknown[]) => mockAttemptFindMany(...args),
      updateMany: (...args: unknown[]) => mockAttemptUpdateMany(...args),
    },
    examTimeExtension: {
      findUnique: (...args: unknown[]) => mockExtensionFindUnique(...args),
    },
    submission: {
      createMany: (...args: unknown[]) => mockSubmissionCreateMany(...args),
    },
  },
}));

vi.mock('../src/lib/grading', () => ({
  beginGrading: (...args: unknown[]) => mockBeginGrading(...args),
  isServerGraded: () => mockIsServerGraded(),
}));

import { maybeSettleAttempt, settleExpiredAttemptsForExam } from '../src/lib/attempts';

describe('maybeSettleAttempt (two-stage settlement)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses minimal select and calls beginGrading without fetching tasks/drafts when server-graded', async () => {
    const startedAt = new Date(Date.now() - 120 * 60_000); // 2h ago
    mockAttemptFindUnique.mockResolvedValueOnce({
      id: 'att-1',
      examId: 'exam-1',
      studentId: 'stu-1',
      status: 'IN_PROGRESS',
      startedAt,
      exam: { timeLimitMinutes: 60, closesAt: null },
    });
    mockExtensionFindUnique.mockResolvedValueOnce(null);
    mockIsServerGraded.mockReturnValue(true);
    mockBeginGrading.mockResolvedValueOnce(true);

    const settled = await maybeSettleAttempt('att-1');

    expect(settled).toBe(true);
    expect(mockAttemptFindUnique).toHaveBeenCalledTimes(1);
    const queryArg = mockAttemptFindUnique.mock.calls[0][0] as Record<string, unknown>;
    expect(queryArg).toHaveProperty('select');
    expect(queryArg).not.toHaveProperty('include');
    expect(mockBeginGrading).toHaveBeenCalledTimes(1);
    expect(mockBeginGrading).toHaveBeenCalledWith(
      'att-1',
      new Date(startedAt.getTime() + 60 * 60_000),
    );
  });

  it('returns false immediately without loading tasks/drafts when deadline has not passed', async () => {
    mockAttemptFindUnique.mockResolvedValueOnce({
      id: 'att-2',
      examId: 'exam-1',
      studentId: 'stu-1',
      status: 'IN_PROGRESS',
      startedAt: new Date(Date.now() - 5 * 60_000),
      exam: { timeLimitMinutes: 60, closesAt: null },
    });
    mockExtensionFindUnique.mockResolvedValueOnce(null);

    const settled = await maybeSettleAttempt('att-2');

    expect(settled).toBe(false);
    expect(mockAttemptFindUnique).toHaveBeenCalledTimes(1);
    expect(mockBeginGrading).not.toHaveBeenCalled();
  });
});

describe('settleExpiredAttemptsForExam', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('settles only expired attempts using preloaded extensions and respects bounded concurrency', async () => {
    const now = new Date('2026-10-01T12:00:00.000Z').getTime();
    const exam = { id: 'exam-1', timeLimitMinutes: 60, closesAt: null };
    mockAttemptFindMany.mockResolvedValueOnce([
      // Expired (started 90m ago, no extension)
      { id: 'exp-1', studentId: 's1', startedAt: new Date(now - 90 * 60_000) },
      // Extended by 45m -> deadline is +15m from now (NOT expired)
      { id: 'ext-1', studentId: 's2', startedAt: new Date(now - 90 * 60_000) },
      // Expired (started 70m ago)
      { id: 'exp-2', studentId: 's3', startedAt: new Date(now - 70 * 60_000) },
      // Expired (started 65m ago)
      { id: 'exp-3', studentId: 's4', startedAt: new Date(now - 65 * 60_000) },
      // Not expired (started 10m ago)
      { id: 'act-1', studentId: 's5', startedAt: new Date(now - 10 * 60_000) },
    ]);
    mockIsServerGraded.mockReturnValue(true);

    let inFlight = 0;
    let peakInFlight = 0;
    mockBeginGrading.mockImplementation(async (id: string) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      if (id === 'exp-2') throw new Error('transient');
      return true;
    });

    const extraByStudent = new Map([['s2', 45]]);
    const settledCount = await settleExpiredAttemptsForExam(exam, extraByStudent, 2, now);

    // exp-1 and exp-3 succeeded; exp-2 failed transiently and was skipped; ext-1 & act-1 untouched.
    expect(settledCount).toBe(2);
    expect(mockBeginGrading).toHaveBeenCalledTimes(3);
    expect(mockBeginGrading.mock.calls.map((c) => c[0]).sort()).toEqual(['exp-1', 'exp-2', 'exp-3']);
    expect(peakInFlight).toBeLessThanOrEqual(2);
    // No per-attempt extension queries were issued.
    expect(mockExtensionFindUnique).not.toHaveBeenCalled();
  });
});
