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

const GLOBAL_LIMIT = Math.max(1, Number(process.env.JUDGE_CONCURRENCY ?? 3));

export class QueueRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueRejectedError';
  }
}

let active = 0;
const waiters: Array<() => void> = [];
const usersInFlight = new Set<string>();

function acquireGlobalSlot(): Promise<void> {
  if (active < GLOBAL_LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function releaseGlobalSlot(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Runs `fn` once a global slot is free. Rejects immediately (429-style) if the
 * same user already has a job in flight, so a double-click or a second tab
 * can't stack work.
 */
export async function withJudgeSlot<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  if (usersInFlight.has(userId)) {
    throw new QueueRejectedError('前の実行がまだ処理中です。少し待ってからもう一度お試しください。');
  }
  usersInFlight.add(userId);
  try {
    await acquireGlobalSlot();
    try {
      return await fn();
    } finally {
      releaseGlobalSlot();
    }
  } finally {
    usersInFlight.delete(userId);
  }
}
