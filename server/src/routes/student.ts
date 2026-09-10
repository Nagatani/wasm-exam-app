import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { judgeSubmission, type JudgeInput } from '../lib/judge';
import { isJudgeConfigured, runOnJudge, JudgeError } from '../lib/judgeClient';
import { withJudgeSlot, QueueRejectedError } from '../lib/executionQueue';
import { attemptDeadline, isServerExec, maybeSettleAttempt } from '../lib/attempts';

export const studentRouter = Router();

studentRouter.use(requireAuth);

const MAX_CODE_LENGTH = 200_000;

const outcomeSchema = z.object({
  testCaseId: z.string(),
  stage: z.enum(['success', 'runtime_error']),
  stdout: z.string(),
});

// ---------------------------------------------------------------------------
// Attempt / draft helpers
// ---------------------------------------------------------------------------

// The student's most recent attempt row for an exam (any status), or null.
function latestAttempt(examId: string, studentId: string) {
  return prisma.examAttempt.findFirst({
    where: { examId, studentId },
    orderBy: { attemptNumber: 'desc' },
  });
}

// `maxAttempts === null` means unlimited retakes.
function canStartAnother(maxAttempts: number | null, submittedCount: number): boolean {
  return maxAttempts === null || submittedCount < maxAttempts;
}

interface AttemptView {
  id: string;
  attemptNumber: number;
  startedAt: Date;
  deadline: Date;
  draftedTaskIds: string[];
}

async function attemptView(attemptId: string): Promise<AttemptView> {
  const a = await prisma.examAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      exam: { select: { timeLimitMinutes: true } },
      drafts: { select: { taskId: true } },
    },
  });
  return {
    id: a.id,
    attemptNumber: a.attemptNumber,
    startedAt: a.startedAt,
    deadline: attemptDeadline(a.startedAt, a.exam.timeLimitMinutes),
    draftedTaskIds: a.drafts.map((d) => d.taskId),
  };
}

// ---------------------------------------------------------------------------
// Ephemeral "run" (preview) — judges but never persists. The task fixes the
// language, so the body carries no language field; only the per-mode payload
// differs (client-exec sends per-test outcomes, server-exec sends source).
// ---------------------------------------------------------------------------

const clientExecSchema = z.object({
  compileFailed: z.boolean(),
  outcomes: z.array(outcomeSchema),
});
const serverExecSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LENGTH),
});

class RunRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type TaskWithTestCases = Prisma.TaskGetPayload<{ include: { testCases: true } }>;

interface ResolvedOutcomes {
  judgeInput: JudgeInput;
  compileStderr: string;
}

async function resolveOutcomes(
  body: unknown,
  task: TaskWithTestCases,
  userId: string,
): Promise<ResolvedOutcomes> {
  if (!isServerExec(task.language)) {
    const parsed = clientExecSchema.safeParse(body);
    if (!parsed.success) {
      throw new RunRequestError(400, parsed.error.issues[0]?.message ?? 'invalid_request');
    }
    return {
      judgeInput: { compileFailed: parsed.data.compileFailed, outcomes: parsed.data.outcomes },
      compileStderr: '',
    };
  }

  if (!isJudgeConfigured()) {
    throw new RunRequestError(503, 'この言語の実行環境が現在利用できません。');
  }
  const parsed = serverExecSchema.safeParse(body);
  if (!parsed.success) {
    throw new RunRequestError(400, parsed.error.issues[0]?.message ?? 'invalid_request');
  }

  const tests = task.testCases.map((tc) => ({
    id: tc.id,
    stdin: tc.input,
    timeLimitMs: tc.timeLimitMs,
    memoryLimitMb: tc.memoryLimitMb,
  }));

  let judgeResult;
  try {
    judgeResult = await withJudgeSlot(userId, () => runOnJudge({ code: parsed.data.code, tests }));
  } catch (err) {
    if (err instanceof QueueRejectedError) {
      throw new RunRequestError(429, err.message);
    }
    if (err instanceof JudgeError) {
      throw new RunRequestError(
        502,
        '実行環境でエラーが発生しました。しばらくして再度お試しください。',
      );
    }
    throw err;
  }

  if (!judgeResult.compile.ok) {
    return {
      judgeInput: { compileFailed: true, outcomes: [] },
      compileStderr: judgeResult.compile.stderr,
    };
  }

  const outcomes = judgeResult.results.map((r) => ({
    testCaseId: r.id,
    stage:
      r.timedOut || r.oom || (r.exitCode ?? 1) !== 0
        ? ('runtime_error' as const)
        : ('success' as const),
    stdout: r.stdout,
  }));

  return { judgeInput: { compileFailed: false, outcomes }, compileStderr: '' };
}

// ---------------------------------------------------------------------------
// Exam listing / entry
// ---------------------------------------------------------------------------

studentRouter.get('/exams', async (req, res) => {
  const userId = req.user!.id;
  const exams = await prisma.exam.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { tasks: true } },
      tasks: { select: { points: true } },
    },
  });

  const examIds = exams.map((e) => e.id);
  let attempts = await prisma.examAttempt.findMany({
    where: { studentId: userId, examId: { in: examIds } },
  });

  // Auto-finalize any attempt whose time is up but which was never submitted.
  const expired = attempts.filter((a) => a.status === 'IN_PROGRESS');
  if (expired.length > 0) {
    for (const a of expired) {
      try {
        await maybeSettleAttempt(a.id);
      } catch {
        /* leave it for the next read */
      }
    }
    attempts = await prisma.examAttempt.findMany({
      where: { studentId: userId, examId: { in: examIds } },
    });
  }

  const byExam = new Map<string, typeof attempts>();
  for (const a of attempts) {
    const list = byExam.get(a.examId) ?? [];
    list.push(a);
    byExam.set(a.examId, list);
  }

  res.json({
    exams: exams.map((exam) => {
      const list = (byExam.get(exam.id) ?? []).sort((a, b) => b.attemptNumber - a.attemptNumber);
      const latest = list[0] ?? null;
      const submitted = list.filter((a) => a.status === 'SUBMITTED');
      const hasInProgress = latest?.status === 'IN_PROGRESS';
      const latestSubmitted = submitted[0] ?? null; // list is desc by attemptNumber
      return {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        timeLimitMinutes: exam.timeLimitMinutes,
        taskCount: exam._count.tasks,
        totalPoints: exam.tasks.reduce((sum, t) => sum + t.points, 0),
        maxAttempts: exam.maxAttempts, // null = unlimited
        attemptsUsed: submitted.length,
        hasInProgress,
        canStart: hasInProgress || canStartAnother(exam.maxAttempts, submitted.length),
        latestScore: latestSubmitted?.score ?? null,
      };
    }),
  });
});

// Begin a new attempt (or resume the in-progress one). Explicit action — not a
// side effect of viewing the exam — so merely opening the dashboard never
// burns an attempt.
studentRouter.post('/exams/:examId/attempts', async (req, res) => {
  const userId = req.user!.id;
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED' },
    include: { _count: { select: { tasks: true } } },
  });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }
  if (exam._count.tasks === 0) {
    res.status(400).json({ error: 'この試験にはまだ問題が登録されていません。' });
    return;
  }

  const latest = await latestAttempt(exam.id, userId);
  if (latest && latest.status === 'IN_PROGRESS') {
    const settled = await maybeSettleAttempt(latest.id);
    if (!settled) {
      res.status(200).json({ attempt: await attemptView(latest.id) });
      return;
    }
  }

  const all = await prisma.examAttempt.findMany({
    where: { examId: exam.id, studentId: userId },
  });
  const submittedCount = all.filter((a) => a.status === 'SUBMITTED').length;
  if (!canStartAnother(exam.maxAttempts, submittedCount)) {
    res.status(409).json({ error: 'この試験の受験可能回数を超えています。' });
    return;
  }

  const nextNumber = all.reduce((max, a) => Math.max(max, a.attemptNumber), 0) + 1;
  try {
    const created = await prisma.examAttempt.create({
      data: {
        examId: exam.id,
        studentId: userId,
        attemptNumber: nextNumber,
        status: 'IN_PROGRESS',
      },
    });
    res.status(201).json({ attempt: await attemptView(created.id) });
  } catch (err) {
    // Two rapid "受験する" clicks race to create the same attemptNumber; the
    // unique constraint rejects the loser. Fall back to whatever attempt now
    // exists.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    ) {
      const existing = await latestAttempt(exam.id, userId);
      if (existing) {
        res.status(200).json({ attempt: await attemptView(existing.id) });
        return;
      }
    }
    throw err;
  }
});

// Read-only view for a student taking (or about to take) the exam. Never shows
// a previous attempt's evaluation (decision 2026-09-10).
studentRouter.get('/exams/:examId', async (req, res) => {
  const userId = req.user!.id;
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED' },
    include: {
      tasks: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, title: true, points: true },
      },
    },
  });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const latest = await latestAttempt(exam.id, userId);
  if (latest && latest.status === 'IN_PROGRESS') {
    await maybeSettleAttempt(latest.id);
  }

  const all = await prisma.examAttempt.findMany({
    where: { examId: exam.id, studentId: userId },
    orderBy: { attemptNumber: 'desc' },
  });
  const current = all[0]?.status === 'IN_PROGRESS' ? all[0] : null;
  const submittedCount = all.filter((a) => a.status === 'SUBMITTED').length;

  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      timeLimitMinutes: exam.timeLimitMinutes,
      tasks: exam.tasks,
      maxAttempts: exam.maxAttempts,
      totalPoints: exam.tasks.reduce((sum, t) => sum + t.points, 0),
    },
    attempt: current ? await attemptView(current.id) : null,
    attemptsUsed: submittedCount,
    canStartNew: current === null && canStartAnother(exam.maxAttempts, submittedCount),
  });
});

// ---------------------------------------------------------------------------
// Task + draft
// ---------------------------------------------------------------------------

studentRouter.get('/tasks/:taskId', async (req, res) => {
  const userId = req.user!.id;
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      exam: { select: { id: true, status: true } },
      testCases: { orderBy: { order: 'asc' } },
    },
  });
  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const latest = await latestAttempt(task.examId, userId);
  const draft =
    latest && latest.status === 'IN_PROGRESS'
      ? await prisma.taskDraft.findUnique({
          where: { attemptId_taskId: { attemptId: latest.id, taskId: task.id } },
        })
      : null;

  res.json({
    task: {
      id: task.id,
      examId: task.examId,
      order: task.order,
      title: task.title,
      statementMarkdown: task.statementMarkdown,
      language: task.language,
      starterCode: task.starterCode,
      points: task.points,
      // Hidden (non-sample) test cases expose only `input`.
      testCases: task.testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        order: tc.order,
        isSample: tc.isSample,
        expectedOutput: tc.isSample ? tc.expectedOutput : undefined,
      })),
    },
    draft: draft
      ? {
          code: draft.code,
          keystrokeCount: draft.keystrokeCount,
          pasteCount: draft.pasteCount,
          pastedCharCount: draft.pastedCharCount,
          timeSpentSeconds: draft.timeSpentSeconds,
        }
      : null,
  });
});

const draftSchema = z.object({
  code: z.string().max(MAX_CODE_LENGTH),
  keystrokeCount: z.number().int().nonnegative(),
  pasteCount: z.number().int().nonnegative(),
  pastedCharCount: z.number().int().nonnegative(),
  timeSpentSeconds: z.number().int().nonnegative(),
});

studentRouter.put('/tasks/:taskId/draft', async (req, res) => {
  const userId = req.user!.id;
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { exam: { select: { status: true } } },
  });
  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const latest = await latestAttempt(task.examId, userId);
  if (!latest || latest.status !== 'IN_PROGRESS') {
    res.status(409).json({ error: '進行中の受験がありません。試験を開始してください。' });
    return;
  }

  const draft = await prisma.taskDraft.upsert({
    where: { attemptId_taskId: { attemptId: latest.id, taskId: task.id } },
    create: { attemptId: latest.id, taskId: task.id, ...parsed.data },
    update: { ...parsed.data },
  });
  res.json({ ok: true, updatedAt: draft.updatedAt });
});

studentRouter.post('/tasks/:taskId/run', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      exam: { select: { status: true } },
      testCases: true,
    },
  });
  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  let resolved: ResolvedOutcomes;
  try {
    resolved = await resolveOutcomes(req.body, task, req.user!.id);
  } catch (err) {
    if (err instanceof RunRequestError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  const verdict = judgeSubmission(task.testCases, task.points, resolved.judgeInput);
  res.json({ verdict, compileStderr: resolved.compileStderr });
});

// ---------------------------------------------------------------------------
// Final submission (finalize the current attempt)
// ---------------------------------------------------------------------------

// Everything the review page needs to grade the current attempt client-side:
// per task, its language, the student's draft code, and the test-case inputs.
// 404 if there is no in-progress attempt; 409 if the deadline passed and it
// was auto-finalized as a result of this call.
studentRouter.get('/exams/:examId/attempt', async (req, res) => {
  const userId = req.user!.id;
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED' },
    include: {
      tasks: {
        orderBy: { order: 'asc' },
        include: { testCases: { orderBy: { order: 'asc' } } },
      },
    },
  });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const latest = await latestAttempt(exam.id, userId);
  if (!latest || latest.status !== 'IN_PROGRESS') {
    res.status(404).json({ error: '進行中の受験がありません。' });
    return;
  }
  if (await maybeSettleAttempt(latest.id)) {
    res.status(409).json({ error: '制限時間が終了したため、受験は自動的に提出されました。' });
    return;
  }

  const drafts = await prisma.taskDraft.findMany({ where: { attemptId: latest.id } });
  const draftByTask = new Map(drafts.map((d) => [d.taskId, d]));

  res.json({
    attempt: {
      id: latest.id,
      attemptNumber: latest.attemptNumber,
      startedAt: latest.startedAt,
      deadline: attemptDeadline(latest.startedAt, exam.timeLimitMinutes),
    },
    exam: {
      id: exam.id,
      title: exam.title,
      totalPoints: exam.tasks.reduce((sum, t) => sum + t.points, 0),
    },
    tasks: exam.tasks.map((t) => {
      const d = draftByTask.get(t.id);
      return {
        id: t.id,
        order: t.order,
        title: t.title,
        points: t.points,
        language: t.language,
        serverExec: isServerExec(t.language),
        hasDraft: !!d,
        draftCode: d?.code ?? null,
        testCases: t.testCases.map((tc) => ({ id: tc.id, input: tc.input })),
      };
    }),
  });
});

const submitSchema = z.object({
  // Per-task results for client-executed languages (C/JS/TS/Python). The
  // browser ran the *saved draft* against every test case; the server still
  // decides AC/WA/CE. Server-exec tasks (Java) are omitted — the server runs
  // their stored draft itself.
  tasks: z.array(
    z.object({
      taskId: z.string(),
      compileFailed: z.boolean(),
      outcomes: z.array(outcomeSchema),
    }),
  ),
});

studentRouter.post('/exams/:examId/submit', async (req, res) => {
  const userId = req.user!.id;
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED' },
    include: {
      tasks: { orderBy: { order: 'asc' }, include: { testCases: true } },
    },
  });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const latest = await latestAttempt(exam.id, userId);
  if (!latest || latest.status !== 'IN_PROGRESS') {
    res.status(409).json({ error: 'この試験には進行中の受験がありません。' });
    return;
  }

  const drafts = await prisma.taskDraft.findMany({ where: { attemptId: latest.id } });
  const draftByTask = new Map(drafts.map((d) => [d.taskId, d]));
  const clientByTask = new Map(parsed.data.tasks.map((t) => [t.taskId, t]));

  const perTask: Array<{
    taskId: string;
    status: 'AC' | 'WA' | 'CE';
    score: number;
    compileStderr: string;
  }> = [];
  const submissionData: Prisma.SubmissionCreateManyInput[] = [];

  for (const task of exam.tasks) {
    const draft = draftByTask.get(task.id);
    if (!draft) continue; // never drafted → no submission → "未提出"

    let judgeInput: JudgeInput;
    let compileStderr = '';

    if (isServerExec(task.language)) {
      if (!isJudgeConfigured()) {
        res.status(503).json({ error: `${task.title}: この言語の実行環境が利用できません。` });
        return;
      }
      const tests = task.testCases.map((tc) => ({
        id: tc.id,
        stdin: tc.input,
        timeLimitMs: tc.timeLimitMs,
        memoryLimitMb: tc.memoryLimitMb,
      }));
      let jr;
      try {
        jr = await withJudgeSlot(userId, () => runOnJudge({ code: draft.code, tests }));
      } catch (err) {
        if (err instanceof QueueRejectedError) {
          res.status(429).json({ error: err.message });
          return;
        }
        if (err instanceof JudgeError) {
          res.status(502).json({ error: '実行環境でエラーが発生しました。' });
          return;
        }
        throw err;
      }
      if (!jr.compile.ok) {
        judgeInput = { compileFailed: true, outcomes: [] };
        compileStderr = jr.compile.stderr;
      } else {
        judgeInput = {
          compileFailed: false,
          outcomes: jr.results.map((r) => ({
            testCaseId: r.id,
            stage:
              r.timedOut || r.oom || (r.exitCode ?? 1) !== 0
                ? ('runtime_error' as const)
                : ('success' as const),
            stdout: r.stdout,
          })),
        };
      }
    } else {
      const c = clientByTask.get(task.id);
      if (!c) {
        res.status(400).json({ error: `「${task.title}」の実行結果が送信されていません。` });
        return;
      }
      judgeInput = { compileFailed: c.compileFailed, outcomes: c.outcomes };
    }

    const verdict = judgeSubmission(task.testCases, task.points, judgeInput);
    perTask.push({
      taskId: task.id,
      status: verdict.overallStatus,
      score: verdict.score,
      compileStderr,
    });
    submissionData.push({
      examId: exam.id,
      taskId: task.id,
      studentId: userId,
      attemptId: latest.id,
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

  const totalScore = submissionData.reduce((sum, d) => sum + (d.score ?? 0), 0);
  const submittedAt = new Date();

  // Guarded flip so a double-submit can't grade twice.
  const locked = await prisma.examAttempt.updateMany({
    where: { id: latest.id, status: 'IN_PROGRESS' },
    data: { status: 'SUBMITTED', submittedAt, score: totalScore },
  });
  if (locked.count === 0) {
    res.status(409).json({ error: 'この受験は既に提出済みです。' });
    return;
  }
  if (submissionData.length > 0) {
    await prisma.submission.createMany({ data: submissionData });
  }

  res.status(201).json({
    attempt: { attemptNumber: latest.attemptNumber, score: totalScore, submittedAt },
    perTask,
  });
});

// Latest SUBMITTED attempt's result — the exam's finished/summary page.
studentRouter.get('/exams/:examId/result', async (req, res) => {
  const userId = req.user!.id;
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED' },
    include: {
      tasks: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, title: true, points: true },
      },
    },
  });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const inProgress = await prisma.examAttempt.findFirst({
    where: { examId: exam.id, studentId: userId, status: 'IN_PROGRESS' },
  });
  if (inProgress) {
    await maybeSettleAttempt(inProgress.id);
  }

  const all = await prisma.examAttempt.findMany({
    where: { examId: exam.id, studentId: userId },
    orderBy: { attemptNumber: 'desc' },
  });
  const submitted = all.filter((a) => a.status === 'SUBMITTED');
  const latestSubmitted = submitted[0] ?? null;
  const hasInProgress = all.some((a) => a.status === 'IN_PROGRESS');
  const totalPoints = exam.tasks.reduce((sum, t) => sum + t.points, 0);
  const canRetake = !hasInProgress && canStartAnother(exam.maxAttempts, submitted.length);

  const base = {
    exam: { id: exam.id, title: exam.title, tasks: exam.tasks, totalPoints },
    attemptsUsed: submitted.length,
    maxAttempts: exam.maxAttempts,
    canRetake,
  };

  if (!latestSubmitted) {
    res.json({ ...base, attempt: null, perTask: [] });
    return;
  }

  const subs = await prisma.submission.findMany({ where: { attemptId: latestSubmitted.id } });
  res.json({
    ...base,
    attempt: {
      attemptNumber: latestSubmitted.attemptNumber,
      score: latestSubmitted.score ?? 0,
      submittedAt: latestSubmitted.submittedAt,
      startedAt: latestSubmitted.startedAt,
    },
    perTask: exam.tasks.map((t) => {
      const s = subs.find((x) => x.taskId === t.id);
      return { taskId: t.id, status: s?.overallStatus ?? null, score: s?.score ?? 0 };
    }),
  });
});
