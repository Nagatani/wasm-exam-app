import type { Prisma, Task, TestCase } from '@prisma/client';
import { prisma } from './prisma';
import { judgeSubmission, type JudgeVerdict } from './judge';
import { isJudgeConfigured, runOnJudge } from './judgeClient';
import { withJudgeCapacity } from './executionQueue';
import { judgeInputFromContainer, judgeLanguage } from './attempts';

// Server-side grading of finished exam attempts (2026-09-26, "本採点のサーバー
// 実行化"). When the judge is configured, an attempt's final submit — by the
// student or automatically at the deadline — no longer trusts outcomes the
// browser reports: the attempt is locked as GRADING right away (so the submit
// time is the click / the deadline, whatever the queue looks like), and a
// background job runs every drafted task's code through the judge — for all
// five languages, with the same runtimes and limits as the browser preview
// (see judge/Judge.java and judge/runner/shared/) — then writes the immutable
// Submission rows and flips the attempt to SUBMITTED with its score.
//
// Without a judge (JUDGE_URL empty) the legacy flow stays: the browser runs
// the client-exec languages and reports outcomes (routes/student.ts submit).
//
// The queue is in-process (like executionQueue.ts): single server instance,
// and on startup `resumePendingGrading()` re-enqueues any attempt left in
// GRADING (e.g. a restart mid-grading) — the drafts it grades from are kept.

export function isServerGraded(): boolean {
  return isJudgeConfigured();
}

const RETRY_DELAY_MS = Math.max(1000, Number(process.env.GRADING_RETRY_MS ?? 15_000));
const CONCURRENCY = Math.max(1, Number(process.env.GRADING_CONCURRENCY ?? process.env.JUDGE_CONCURRENCY ?? 3));

// Run one task's code through the judge and derive the verdict exactly like
// every other path (judgeSubmission).
export async function gradeCodeOnJudge(
  task: Pick<Task, 'language' | 'points' | 'comparisonMode' | 'floatTolerance' | 'allowPartialCredit'>,
  testCases: TestCase[],
  code: string,
): Promise<JudgeVerdict> {
  const tests = testCases.map((tc) => ({
    id: tc.id,
    stdin: tc.input,
    timeLimitMs: tc.timeLimitMs,
    memoryLimitMb: tc.memoryLimitMb,
  }));
  const jr = await withJudgeCapacity(() =>
    runOnJudge({ language: judgeLanguage(task.language), code, tests }),
  );
  return judgeSubmission(
    testCases,
    task.points,
    judgeInputFromContainer(jr),
    { mode: task.comparisonMode, floatTolerance: task.floatTolerance },
    task.allowPartialCredit,
  );
}

// Lock an IN_PROGRESS attempt as GRADING (guarded: only one caller wins) and
// queue it. Returns false if it wasn't IN_PROGRESS any more.
export async function beginGrading(attemptId: string, submittedAt: Date): Promise<boolean> {
  const locked = await prisma.examAttempt.updateMany({
    where: { id: attemptId, status: 'IN_PROGRESS' },
    data: { status: 'GRADING', submittedAt },
  });
  if (locked.count === 0) return false;
  enqueueGrading(attemptId);
  return true;
}

type GradeOutcome = 'done' | 'gone';

// Grade one GRADING attempt. Throws on a judge/infrastructure failure (the
// queue retries later); a compile error or wrong answer is a normal verdict.
export async function gradeAttempt(attemptId: string): Promise<GradeOutcome> {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: { include: { tasks: { orderBy: { order: 'asc' }, include: { testCases: true } } } },
      drafts: true,
    },
  });
  // Deleted (差し戻し) or already graded meanwhile → nothing to do.
  if (!attempt || attempt.status !== 'GRADING') return 'gone';

  const draftByTask = new Map(attempt.drafts.map((d) => [d.taskId, d]));
  const submissionData: Prisma.SubmissionCreateManyInput[] = [];
  for (const task of attempt.exam.tasks) {
    const draft = draftByTask.get(task.id);
    if (!draft) continue; // never drafted → no submission → "未提出"
    const verdict = await gradeCodeOnJudge(task, task.testCases, draft.code);
    submissionData.push({
      examId: attempt.examId,
      taskId: task.id,
      studentId: attempt.studentId,
      attemptId: attempt.id,
      language: task.language,
      code: draft.code,
      results: verdict.results as unknown as Prisma.InputJsonValue,
      overallStatus: verdict.overallStatus,
      score: verdict.score,
      keystrokeCount: draft.keystrokeCount,
      pasteCount: draft.pasteCount,
      pastedCharCount: draft.pastedCharCount,
      timeSpentSeconds: draft.timeSpentSeconds,
    });
  }
  const score = submissionData.reduce((sum, d) => sum + (d.score ?? 0), 0);

  // Guarded: if the attempt was reset (差し戻し) while grading, write nothing.
  return prisma.$transaction(async (tx) => {
    const flipped = await tx.examAttempt.updateMany({
      where: { id: attempt.id, status: 'GRADING' },
      data: { status: 'SUBMITTED', score },
    });
    if (flipped.count === 0) return 'gone' as const;
    if (submissionData.length > 0) await tx.submission.createMany({ data: submissionData });
    return 'done' as const;
  });
}

// ---- in-process queue ------------------------------------------------------

const queued = new Set<string>();
const order: string[] = [];
let running = 0;
let idleWaiters: Array<() => void> = [];
const retryTimers = new Set<ReturnType<typeof setTimeout>>();

export function enqueueGrading(attemptId: string): void {
  if (queued.has(attemptId)) return;
  queued.add(attemptId);
  order.push(attemptId);
  pump();
}

function pump(): void {
  while (running < CONCURRENCY && order.length > 0) {
    const id = order.shift()!;
    running += 1;
    void gradeAttempt(id)
      .then(() => queued.delete(id))
      .catch((err) => {
        console.error(`grading attempt ${id} failed, retrying in ${RETRY_DELAY_MS}ms:`, err);
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          order.push(id);
          pump();
        }, RETRY_DELAY_MS);
        timer.unref?.();
        retryTimers.add(timer);
      })
      .finally(() => {
        running -= 1;
        pump();
        if (running === 0 && order.length === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          waiters.forEach((w) => w());
        }
      });
  }
}

// Re-enqueue attempts left in GRADING (server restart mid-grading).
export async function resumePendingGrading(): Promise<number> {
  if (!isServerGraded()) return 0;
  const pending = await prisma.examAttempt.findMany({
    where: { status: 'GRADING' },
    select: { id: true },
    orderBy: { submittedAt: 'asc' },
  });
  pending.forEach((a) => enqueueGrading(a.id));
  return pending.length;
}

// Tests: resolve once nothing is running or queued (pending retries excluded).
export function waitForGradingIdle(): Promise<void> {
  if (running === 0 && order.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

// Tests: forget queued work and pending retries between test cases.
export function resetGradingQueue(): void {
  retryTimers.forEach((t) => clearTimeout(t));
  retryTimers.clear();
  queued.clear();
  order.length = 0;
}
