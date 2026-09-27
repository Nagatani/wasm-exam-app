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

export class QueueRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueRejectedError';
  }
}

let active = 0;
// Two waiting lines: interactive work (a student's "実行", a teacher's
// check-solution / regrade) is always served before the background grader,
// so a class-wide final-submit rush never makes a live preview wait behind
// dozens of gradings.
const interactiveWaiters: Array<() => void> = [];
const backgroundWaiters: Array<() => void> = [];
const usersInFlight = new Set<string>();

function acquireGlobalSlot(priority: 'interactive' | 'background' = 'interactive'): Promise<void> {
  if (active < GLOBAL_LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    (priority === 'interactive' ? interactiveWaiters : backgroundWaiters).push(() => {
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

/**
 * Runs `fn` once a global slot is free, without the per-user cap — for the
 * background grader (lib/grading.ts), which runs one student's tasks one after
 * another and must queue, never be rejected.
 */
export async function withJudgeCapacity<T>(fn: () => Promise<T>): Promise<T> {
  await acquireGlobalSlot('background');
  try {
    return await fn();
  } finally {
    releaseGlobalSlot();
  }
}
