import { describe, expect, it } from 'vitest';
import {
  getExecutionQueueStats,
  QueueAbortedError,
  QueueRejectedError,
  QueueTimeoutError,
  withJudgeCapacity,
  withJudgeSlot,
} from '../src/lib/executionQueue';

// Default JUDGE_CONCURRENCY is 2 global slots.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('executionQueue', () => {
  it('serves interactive work before queued background grading', async () => {
    const order: string[] = [];
    const hold = [deferred(), deferred()];
    // Fill both slots.
    const busy = hold.map((d, i) => withJudgeCapacity(async () => { order.push(`busy${i}`); await d.promise; }));
    // Background grading queues first, then a student's live preview.
    const bg = withJudgeCapacity(async () => { order.push('background'); });
    const ia = withJudgeSlot('student-1', async () => { order.push('interactive'); });
    await Promise.resolve();
    hold[0].resolve();
    await ia;
    hold[1].resolve();
    await Promise.all([...busy, bg]);
    expect(order).toEqual(['busy0', 'busy1', 'interactive', 'background']);
  });

  it('still rejects a second concurrent interactive job from the same user', async () => {
    const d = deferred();
    const first = withJudgeSlot('student-2', () => d.promise);
    await expect(withJudgeSlot('student-2', async () => 1)).rejects.toBeInstanceOf(QueueRejectedError);
    d.resolve();
    await first;
  });

  it('rejects when the interactive wait queue reaches maxQueue', async () => {
    const hold = [deferred(), deferred()];
    const busy = hold.map((d) => withJudgeCapacity(() => d.promise));
    // Queue 1 interactive waiter with maxQueue=1; the next one must be rejected.
    const w1 = withJudgeSlot('student-q1', async () => 'ok', { maxQueue: 1 });
    await expect(
      withJudgeSlot('student-q2', async () => 'nope', { maxQueue: 1 }),
    ).rejects.toBeInstanceOf(QueueRejectedError);

    hold.forEach((d) => d.resolve());
    await expect(w1).resolves.toBe('ok');
    await Promise.all(busy);

    // Rejected user is not stuck in usersInFlight and can run afterwards.
    await expect(withJudgeSlot('student-q2', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('rejects with QueueTimeoutError when waitTimeoutMs elapses before a slot frees', async () => {
    const hold = [deferred(), deferred()];
    const busy = hold.map((d) => withJudgeCapacity(() => d.promise));

    let ran = false;
    await expect(
      withJudgeSlot(
        'student-timeout',
        async () => {
          ran = true;
          return 'late';
        },
        { waitTimeoutMs: 25 },
      ),
    ).rejects.toBeInstanceOf(QueueTimeoutError);
    expect(ran).toBe(false);

    hold.forEach((d) => d.resolve());
    await Promise.all(busy);

    // Timed-out user is cleaned up and can run once slots are free.
    await expect(withJudgeSlot('student-timeout', async () => 'ok')).resolves.toBe('ok');
  });

  it('removes a waiting job immediately when AbortSignal aborts', async () => {
    const hold = [deferred(), deferred()];
    const busy = hold.map((d) => withJudgeCapacity(() => d.promise));

    const ac = new AbortController();
    let abortedJobRan = false;
    const abortedJob = withJudgeSlot(
      'student-abort',
      async () => {
        abortedJobRan = true;
        return 'should-not-run';
      },
      { signal: ac.signal },
    );
    const nextJob = withJudgeSlot('student-after-abort', async () => 'next');

    ac.abort();
    await expect(abortedJob).rejects.toBeInstanceOf(QueueAbortedError);

    hold.forEach((d) => d.resolve());
    await expect(nextJob).resolves.toBe('next');
    await Promise.all(busy);
    expect(abortedJobRan).toBe(false);

    // Pre-aborted signal rejects immediately without running fn.
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      withJudgeSlot('student-abort', async () => 'never', { signal: preAborted.signal }),
    ).rejects.toBeInstanceOf(QueueAbortedError);
  });

  it('reports live execution queue stats via getExecutionQueueStats', async () => {
    expect(getExecutionQueueStats()).toEqual({
      active: 0,
      interactiveWaiting: 0,
      backgroundWaiting: 0,
      concurrency: 2,
    });

    const hold = [deferred(), deferred()];
    const busy = hold.map((d) => withJudgeCapacity(() => d.promise));
    const bgWait = withJudgeCapacity(async () => 'bg');
    const iaWait = withJudgeSlot('student-stats', async () => 'ia');
    await Promise.resolve();

    expect(getExecutionQueueStats()).toEqual({
      active: 2,
      interactiveWaiting: 1,
      backgroundWaiting: 1,
      concurrency: 2,
    });

    hold.forEach((d) => d.resolve());
    await Promise.all([...busy, bgWait, iaWait]);

    expect(getExecutionQueueStats()).toEqual({
      active: 0,
      interactiveWaiting: 0,
      backgroundWaiting: 0,
      concurrency: 2,
    });
  });
});
