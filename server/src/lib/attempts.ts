import type { Language, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { judgeSubmission, type JudgeInput, type JudgeVerdict } from './judge';
import { isJudgeConfigured, runOnJudge } from './judgeClient';
import { withJudgeSlot } from './executionQueue';

// Languages the server compiles+runs itself (in the sandboxed judge
// container). Everything else runs in the student's browser and the client
// reports per-test outcomes back — the server cannot reproduce those runs.
const SERVER_EXEC_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['JAVA']);

export function isServerExec(language: Language): boolean {
  return SERVER_EXEC_LANGUAGES.has(language);
}

// The wall-clock deadline of an attempt: a fixed offset from when it started,
// clamped to the exam's `closesAt` if one is set. The countdown the student
// sees and the "所要時間" a teacher sees both derive from this.
export function attemptDeadline(
  startedAt: Date,
  timeLimitMinutes: number,
  closesAt?: Date | null,
): Date {
  const byLimit = startedAt.getTime() + timeLimitMinutes * 60_000;
  const byClose = closesAt ? closesAt.getTime() : Number.POSITIVE_INFINITY;
  return new Date(Math.min(byLimit, byClose));
}

// Turn a judge-container run response into the { compileFailed, outcomes }
// shape judgeSubmission consumes.
function judgeInputFromContainer(jr: Awaited<ReturnType<typeof runOnJudge>>): JudgeInput {
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
    })),
  };
}

// Auto-finalize an attempt whose time is up but which the student never
// submitted (decision 2026-09-10: "自動確定して評価"). The server can't re-run
// browser-executed languages (C/JS/TS/Python), so a drafted client-exec task
// whose result the student never sent is graded WA/0; server-exec (Java)
// drafts are still compiled and run through the judge. A no-op unless the
// attempt is IN_PROGRESS *and* past its deadline. Returns whether it settled.
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
    attempt.exam.timeLimitMinutes,
    attempt.exam.closesAt,
  );
  if (Date.now() < deadline.getTime()) return false;

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
        verdict = judgeSubmission(task.testCases, task.points, judgeInputFromContainer(jr), {
          mode: task.comparisonMode,
          floatTolerance: task.floatTolerance,
        });
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
