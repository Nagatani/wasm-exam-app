import { describe, expect, it } from 'vitest';
import { QueueRejectedError, withJudgeCapacity, withJudgeSlot } from '../src/lib/executionQueue';

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
});
