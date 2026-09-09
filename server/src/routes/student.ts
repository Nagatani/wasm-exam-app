import { Router } from 'express';
import { z } from 'zod';
import type { Language, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { judgeSubmission, type JudgeInput } from '../lib/judge';
import { isJudgeConfigured, runOnJudge, JudgeError } from '../lib/judgeClient';
import { withJudgeSlot, QueueRejectedError } from '../lib/executionQueue';

export const studentRouter = Router();

studentRouter.use(requireAuth);

// Languages the server compiles+runs itself (in the sandboxed judge
// container). Everything else is executed in the student's browser and the
// client reports the per-test outcomes back.
const SERVER_EXEC_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['JAVA']);

const MAX_CODE_LENGTH = 200_000;

const outcomeSchema = z.object({
  testCaseId: z.string(),
  stage: z.enum(['success', 'runtime_error']),
  stdout: z.string(),
});

// The answer language is fixed by the task (task.language) — the student has
// no picker — so a run/submit body carries no language field; only the
// per-mode payload differs.
//
// Client-executed languages (C, later JS/TS): the browser compiled and ran the
// program and reports what it printed per test case. Never a self-declared
// verdict — judgeSubmission still decides AC/WA/CE.
const clientExecSchema = z.object({
  compileFailed: z.boolean(),
  outcomes: z.array(outcomeSchema),
});

// Server-executed languages (Java): the browser can't run it, so it sends the
// source and the judge container compiles + runs it against every test case.
const serverExecSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LENGTH),
});

interface ResolvedOutcomes {
  judgeInput: JudgeInput;
  compileStderr: string;
}

type TaskWithTestCases = Prisma.TaskGetPayload<{ include: { testCases: true } }>;

// Turns a run/submit request body into the { compileFailed, outcomes } shape
// judgeSubmission consumes — either straight from the client (client-exec) or
// by calling the sandboxed judge (server-exec). Throws a RunRequestError with
// an HTTP status for anything the caller should surface as-is.
class RunRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function resolveOutcomes(
  body: unknown,
  task: TaskWithTestCases,
  userId: string,
): Promise<ResolvedOutcomes> {
  // Authoritative — the task, not the request, decides the language.
  const language = task.language;

  if (!SERVER_EXEC_LANGUAGES.has(language)) {
    const parsed = clientExecSchema.safeParse(body);
    if (!parsed.success) {
      throw new RunRequestError(400, parsed.error.issues[0]?.message ?? 'invalid_request');
    }
    return {
      judgeInput: { compileFailed: parsed.data.compileFailed, outcomes: parsed.data.outcomes },
      compileStderr: '',
    };
  }

  // ---- server-exec (Java) ----
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
    judgeResult = await withJudgeSlot(userId, () =>
      runOnJudge({ code: parsed.data.code, tests }),
    );
  } catch (err) {
    if (err instanceof QueueRejectedError) {
      throw new RunRequestError(429, err.message);
    }
    if (err instanceof JudgeError) {
      throw new RunRequestError(502, '実行環境でエラーが発生しました。しばらくして再度お試しください。');
    }
    throw err;
  }

  if (!judgeResult.compile.ok) {
    return { judgeInput: { compileFailed: true, outcomes: [] }, compileStderr: judgeResult.compile.stderr };
  }

  const outcomes = judgeResult.results.map((r) => ({
    testCaseId: r.id,
    // TLE/MLE aren't distinct verdicts yet (Phase 6) — a timeout, an OOM or a
    // non-zero exit all surface as a per-test 'runtime_error' → RE badge → WA.
    stage:
      r.timedOut || r.oom || (r.exitCode ?? 1) !== 0
        ? ('runtime_error' as const)
        : ('success' as const),
    stdout: r.stdout,
  }));

  return { judgeInput: { compileFailed: false, outcomes }, compileStderr: '' };
}

studentRouter.get('/exams', async (req, res) => {
  const exams = await prisma.exam.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tasks: true } } },
  });

  // Distinct (examId, taskId) submissions for this student across every
  // published exam, so the dashboard can tell "fully submitted" apart from
  // "not started"/"in progress" without an extra round-trip per exam.
  const submissions = await prisma.submission.findMany({
    where: { studentId: req.user!.id, examId: { in: exams.map((e) => e.id) } },
    select: { examId: true, taskId: true },
    distinct: ['examId', 'taskId'],
  });
  const submittedCountByExam = new Map<string, number>();
  for (const s of submissions) {
    submittedCountByExam.set(s.examId, (submittedCountByExam.get(s.examId) ?? 0) + 1);
  }

  res.json({
    exams: exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      timeLimitMinutes: exam.timeLimitMinutes,
      taskCount: exam._count.tasks,
      submittedTaskCount: submittedCountByExam.get(exam.id) ?? 0,
    })),
  });
});

studentRouter.get('/exams/:examId', async (req, res) => {
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

  // First time this student opens this exam, mark it as started — this is
  // the fixed reference point the student-side countdown and the teacher's
  // "所要時間" column both compute from. A no-op on every later visit.
  const attempt = await prisma.examAttempt.upsert({
    where: { examId_studentId: { examId: exam.id, studentId: req.user!.id } },
    update: {},
    create: { examId: exam.id, studentId: req.user!.id },
  });

  const submissions = await prisma.submission.findMany({
    where: { examId: exam.id, studentId: req.user!.id },
    select: { taskId: true },
    distinct: ['taskId'],
  });

  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      timeLimitMinutes: exam.timeLimitMinutes,
      tasks: exam.tasks,
      startedAt: attempt.startedAt,
    },
    submittedTaskIds: submissions.map((s) => s.taskId),
  });
});

studentRouter.get('/tasks/:taskId', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      exam: { select: { id: true, status: true, title: true } },
      testCases: { orderBy: { order: 'asc' } },
    },
  });

  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

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
      // Hidden (non-sample) test cases only ever expose `input` — the client
      // needs it to feed the student's program, but expectedOutput must never
      // leave the server or the judge is meaningless.
      testCases: task.testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        order: tc.order,
        isSample: tc.isSample,
        expectedOutput: tc.isSample ? tc.expectedOutput : undefined,
      })),
    },
  });
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

  // Ephemeral: this is the "try it out" run, nothing is persisted.
  res.json({ verdict, compileStderr: resolved.compileStderr });
});

const submissionMetadataSchema = z.object({
  taskId: z.string(),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  keystrokeCount: z.number().int().nonnegative(),
  pasteCount: z.number().int().nonnegative(),
  pastedCharCount: z.number().int().nonnegative(),
  timeSpentSeconds: z.number().int().nonnegative(),
});

studentRouter.post('/submissions', async (req, res) => {
  const meta = submissionMetadataSchema.safeParse(req.body);
  if (!meta.success) {
    res.status(400).json({ error: meta.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: meta.data.taskId },
    include: {
      exam: { select: { id: true, status: true } },
      testCases: true,
    },
  });

  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  // Re-derives the verdict server-side (for Java, by actually compiling and
  // running in the sandbox) rather than trusting anything the client computed.
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

  const submission = await prisma.submission.create({
    data: {
      examId: task.exam.id,
      taskId: task.id,
      studentId: req.user!.id,
      language: task.language,
      code: meta.data.code,
      results: verdict.results as unknown as Prisma.InputJsonValue,
      overallStatus: verdict.overallStatus,
      score: verdict.score,
      keystrokeCount: meta.data.keystrokeCount,
      pasteCount: meta.data.pasteCount,
      pastedCharCount: meta.data.pastedCharCount,
      timeSpentSeconds: meta.data.timeSpentSeconds,
    },
  });

  res.status(201).json({
    submission: {
      id: submission.id,
      overallStatus: submission.overallStatus,
      score: submission.score,
      results: verdict.results,
      submittedAt: submission.submittedAt,
    },
    compileStderr: resolved.compileStderr,
  });
});

studentRouter.get('/exams/:examId/submissions', async (req, res) => {
  const submissions = await prisma.submission.findMany({
    where: { examId: req.params.examId, studentId: req.user!.id },
    orderBy: { submittedAt: 'desc' },
  });

  // Keep only the latest submission per task.
  const latestByTask = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    if (!latestByTask.has(submission.taskId)) {
      latestByTask.set(submission.taskId, submission);
    }
  }

  res.json({
    submissions: Array.from(latestByTask.values()).map((s) => ({
      taskId: s.taskId,
      overallStatus: s.overallStatus,
      score: s.score,
      submittedAt: s.submittedAt,
    })),
  });
});
