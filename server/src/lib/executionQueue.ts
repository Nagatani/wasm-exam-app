// Bounds how much server-side judging runs concurrently. Java compile+run
// (unlike C, which executes in the student's browser) hits this process, so a
// class all clicking "実行" at once must not fan out into unbounded work.
//
// Two limits:
//  - a global concurrency cap (JUDGE_CONCURRENCY) — total in-flight judge jobs
//  - a per-user cap of 1 — one student can't queue several jobs at once
//
// This is deliberately a tiny in-process primitive (no Redis/pg-boss): the
// operational deployment is a single Node process (consolidated serving).

// Keep equal to the judge container's JUDGE_MAX_CONCURRENT (default 2) — more
// only makes requests queue inside the judge instead of here, where the
// interactive-first ordering below applies.
const GLOBAL_LIMIT = Math.max(1, Number(process.env.JUDGE_CONCURRENCY ?? 2));

const envInteractiveMaxQueue = Number(process.env.JUDGE_INTERACTIVE_MAX_QUEUE);
const DEFAULT_INTERACTIVE_MAX_QUEUE =
  Number.isInteger(envInteractiveMaxQueue) && envInteractiveMaxQueue > 0
    ? envInteractiveMaxQueue
    : 30;

const envInteractiveWaitTimeoutMs = Number(process.env.JUDGE_INTERACTIVE_WAIT_TIMEOUT_MS);
const DEFAULT_INTERACTIVE_WAIT_TIMEOUT_MS =
  Number.isFinite(envInteractiveWaitTimeoutMs) && envInteractiveWaitTimeoutMs > 0
    ? envInteractiveWaitTimeoutMs
    : 25_000;

export class QueueRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueRejectedError';
  }
}

export class QueueTimeoutError extends QueueRejectedError {
  constructor(message = '実行待ちがタイムアウトしました。少し待ってからもう一度お試しください。') {
    super(message);
    this.name = 'QueueTimeoutError';
  }
}

export class QueueAbortedError extends Error {
  constructor(message = '実行リクエストがキャンセルされました。') {
    super(message);
    this.name = 'QueueAbortedError';
  }
}

export interface JudgeSlotOptions {
  signal?: AbortSignal;
  maxQueue?: number;
  waitTimeoutMs?: number;
}

export interface ExecutionQueueStats {
  active: number;
  interactiveWaiting: number;
  backgroundWaiting: number;
  concurrency: number;
}

let active = 0;
// Two waiting lines: interactive work (a student's "実行", a teacher's
// check-solution) is always served before background work (grading / regrade),
// so a class-wide final-submit rush or regrade never makes a live preview wait
// behind dozens of gradings.
const interactiveWaiters: Array<() => void> = [];
const backgroundWaiters: Array<() => void> = [];
const usersInFlight = new Set<string>();

export function getExecutionQueueStats(): ExecutionQueueStats {
  return {
    active,
    interactiveWaiting: interactiveWaiters.length,
    backgroundWaiting: backgroundWaiters.length,
    concurrency: GLOBAL_LIMIT,
  };
}

function acquireInteractiveSlot(options?: JudgeSlotOptions): Promise<void> {
  const signal = options?.signal;
  if (signal?.aborted) {
    return Promise.reject(new QueueAbortedError());
  }
  if (active < GLOBAL_LIMIT) {
    active += 1;
    return Promise.resolve();
  }

  const maxQueue = options?.maxQueue ?? DEFAULT_INTERACTIVE_MAX_QUEUE;
  if (interactiveWaiters.length >= maxQueue) {
    return Promise.reject(
      new QueueRejectedError('実行キューが混み合っています。少し待ってからもう一度お試しください。'),
    );
  }

  const waitTimeoutMs = options?.waitTimeoutMs ?? DEFAULT_INTERACTIVE_WAIT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener('abort', onAbort);
    };

    const removeWaiter = () => {
      const idx = interactiveWaiters.indexOf(grant);
      if (idx !== -1) interactiveWaiters.splice(idx, 1);
    };

    const grant = () => {
      if (settled) return;
      settled = true;
      cleanup();
      active += 1;
      resolve();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      removeWaiter();
      cleanup();
      reject(new QueueAbortedError());
    };

    if (waitTimeoutMs > 0 && Number.isFinite(waitTimeoutMs)) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        removeWaiter();
        cleanup();
        reject(new QueueTimeoutError());
      }, waitTimeoutMs);
      timer.unref?.();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    interactiveWaiters.push(grant);
  });
}

function acquireBackgroundSlot(): Promise<void> {
  if (active < GLOBAL_LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    backgroundWaiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function releaseGlobalSlot(): void {
  active -= 1;
  const next = interactiveWaiters.shift() ?? backgroundWaiters.shift();
  if (next) next();
}

/**
 * Runs `fn` once a global slot is free. Rejects immediately (429-style) if the
 * same user already has a job in flight or if the interactive wait queue is
 * full, rejects on wait timeout, and removes the waiter immediately if `signal`
 * aborts (e.g. disconnected HTTP client).
 */
export async function withJudgeSlot<T>(
  userId: string,
  fn: () => Promise<T>,
  options?: JudgeSlotOptions,
): Promise<T> {
  if (options?.signal?.aborted) {
    throw new QueueAbortedError();
  }
  if (usersInFlight.has(userId)) {
    throw new QueueRejectedError('前の実行がまだ処理中です。少し待ってからもう一度お試しください。');
  }
  usersInFlight.add(userId);
  try {
    await acquireInteractiveSlot(options);
    try {
      return await fn();
    } finally {
      releaseGlobalSlot();
    }
  } finally {
    usersInFlight.delete(userId);
  }
}

/**
 * Runs `fn` once a global slot is free, without the per-user cap — for
 * background work (lib/grading.ts, task regrade), which queues behind
 * interactive previews and is never rejected.
 */
export async function withJudgeCapacity<T>(fn: () => Promise<T>): Promise<T> {
  await acquireBackgroundSlot();
  try {
    return await fn();
  } finally {
    releaseGlobalSlot();
  }
}
