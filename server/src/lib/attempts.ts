import type { Language, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { judgeSubmission, type JudgeInput, type JudgeVerdict } from './judge';
import { isJudgeConfigured, runOnJudge } from './judgeClient';
import { withJudgeSlot } from './executionQueue';
import { beginGrading, isServerGraded } from './grading';

// Languages whose "実行" preview (and, without a judge, whose grading) runs on
// the server: only Java — it can't run in the browser. The others preview in
// the student's browser. With a judge configured, *grading* (final submit,
// auto-finalize, regrade) runs on the judge for every language — see
// lib/grading.ts.
const SERVER_EXEC_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['JAVA']);

export function isServerExec(language: Language): boolean {
  return SERVER_EXEC_LANGUAGES.has(language);
}

// Teacher "regrade" re-runs stored submissions on the judge. Since
// 2026-09-26 the judge runs every language with the browser's runtimes, so
// every language is regradable (given a configured judge).
export function isRegradeCapable(_language: Language): boolean {
  return true;
}

// The judge protocol's `language` field — the same names as the enum.
export function judgeLanguage(language: Language): Language {
  return language;
}

// The wall-clock deadline of an attempt: a fixed offset from when it started,
// clamped to the exam's `closesAt` if one is set. `extraMinutes` is a
// per-student accommodation added to both the limit and this student's
// personal `closesAt`. The countdown the student sees and the "所要時間" a
// teacher sees both derive from this.
export function attemptDeadline(
  startedAt: Date,
  timeLimitMinutes: number,
  closesAt?: Date | null,
  extraMinutes = 0,
): Date {
  const byLimit = startedAt.getTime() + (timeLimitMinutes + extraMinutes) * 60_000;
  const byClose = closesAt
    ? closesAt.getTime() + extraMinutes * 60_000
    : Number.POSITIVE_INFINITY;
  return new Date(Math.min(byLimit, byClose));
}

// Per-student time accommodation for an exam, in minutes (0 if none).
export async function extraMinutesFor(examId: string, studentId: string): Promise<number> {
  const row = await prisma.examTimeExtension.findUnique({
    where: { examId_studentId: { examId, studentId } },
  });
  return row?.extraMinutes ?? 0;
}

// Per-student extra attempts for an exam (0 if none) — "もう1回受けさせる".
export async function extraAttemptsFor(examId: string, studentId: string): Promise<number> {
  const row = await prisma.examAttemptGrant.findUnique({
    where: { examId_studentId: { examId, studentId } },
  });
  return row?.extraAttempts ?? 0;
}

// The attempt cap that actually applies to one student: the exam's
// maxAttempts plus their grant. null (unlimited) stays unlimited.
export function effectiveMaxAttempts(maxAttempts: number | null, extraAttempts: number): number | null {
  return maxAttempts === null ? null : maxAttempts + extraAttempts;
}

// Turn a judge-container run response into the { compileFailed, outcomes }
// shape judgeSubmission consumes.
export function judgeInputFromContainer(jr: Awaited<ReturnType<typeof runOnJudge>>): JudgeInput {
  if (!jr.compile.ok) {
    return { compileFailed: true, outcomes: [] };
  }
  return {
    compileFailed: false,
    outcomes: jr.results.map((r) => ({
      testCaseId: r.id,
      stage: r.timedOut
        ? ('tle' as const)
        : r.oom
          ? ('mle' as const)
          : (r.exitCode ?? 1) !== 0
            ? ('runtime_error' as const)
            : ('success' as const),
      stdout: r.stdout,
      timeMs: r.timeMs,
    })),
  };
}

// Auto-finalize an attempt whose time is up but which the student never
// submitted (decision 2026-09-10: "自動確定して評価"). With a judge configured
// the attempt is locked as GRADING (submittedAt = the deadline) and every
// drafted task — any language — is graded in the background from its saved
// draft (lib/grading.ts). Without a judge (legacy), the server can't re-run
// browser-executed languages, so a drafted client-exec task is graded WA/0.
// A no-op unless the attempt is IN_PROGRESS *and* past its deadline. Returns
// whether it settled (i.e. is no longer in progress).
//
// Concurrency-safe: the status flip is a single guarded UPDATE, so only one
// caller wins and writes submissions.
export async function maybeSettleAttempt(attemptId: string): Promise<boolean> {
  const attempt = await prisma.examAttempt.findUnique({
    where: { id: attemptId },
    include: {
      exam: { include: { tasks: { include: { testCases: true } } } },
      drafts: true,
    },
  });
  if (!attempt || attempt.status !== 'IN_PROGRESS') return false;

  const deadline = attemptDeadline(
    attempt.startedAt,
    // Non-null: an ExamAttempt only ever exists for a mode:EXAM exam, which
    // requires timeLimitMinutes at creation (server/src/routes/exams.ts).
    attempt.exam.timeLimitMinutes!,
    attempt.exam.closesAt,
    await extraMinutesFor(attempt.examId, attempt.studentId),
  );
  if (Date.now() < deadline.getTime()) return false;

  if (isServerGraded()) {
    return beginGrading(attempt.id, deadline);
  }

  const draftByTask = new Map(attempt.drafts.map((d) => [d.taskId, d]));
  const submissionData: Prisma.SubmissionCreateManyInput[] = [];

  for (const task of attempt.exam.tasks) {
    const draft = draftByTask.get(task.id);
    if (!draft) continue; // never touched → no submission → "未提出"

    let verdict: JudgeVerdict = { overallStatus: 'WA', results: [], score: 0 };
    if (isServerExec(task.language) && isJudgeConfigured()) {
      try {
        const tests = task.testCases.map((tc) => ({
          id: tc.id,
          stdin: tc.input,
          timeLimitMs: tc.timeLimitMs,
          memoryLimitMb: tc.memoryLimitMb,
        }));
        const jr = await withJudgeSlot(attempt.studentId, () =>
          runOnJudge({ code: draft.code, tests }),
        );
        verdict = judgeSubmission(
          task.testCases,
          task.points,
          judgeInputFromContainer(jr),
          { mode: task.comparisonMode, floatTolerance: task.floatTolerance },
          task.allowPartialCredit,
        );
      } catch {
        verdict = { overallStatus: 'WA', results: [], score: 0 };
      }
    }

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

  const total = submissionData.reduce((sum, d) => sum + (d.score ?? 0), 0);

  // Guarded flip: whichever concurrent caller matches status IN_PROGRESS wins.
  const locked = await prisma.examAttempt.updateMany({
    where: { id: attempt.id, status: 'IN_PROGRESS' },
    data: { status: 'SUBMITTED', submittedAt: deadline, score: total },
  });
  if (locked.count === 0) return false;

  if (submissionData.length > 0) {
    await prisma.submission.createMany({ data: submissionData });
  }
  return true;
}
