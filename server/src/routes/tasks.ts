import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { languageSchema, parseLanguageParam } from '../lib/language';
import { isRegradeCapable, isServerExec, judgeInputFromContainer, judgeLanguage } from '../lib/attempts';
import { isJudgeConfigured, runOnJudge, JudgeError } from '../lib/judgeClient';
import { withJudgeSlot, QueueRejectedError } from '../lib/executionQueue';
import { judgeSubmission } from '../lib/judge';

export const tasksRouter = Router();

tasksRouter.use(requireAuth, requireRole('TEACHER'));

const taskUpdateSchema = z.object({
  order: z.number().int().optional(),
  title: z.string().min(1).optional(),
  statementMarkdown: z.string().optional(),
  // The single language this task must be answered in, and its editor
  // template. Both save as part of this task PATCH (unlike the reference
  // solution, which has its own route).
  language: languageSchema.optional(),
  starterCode: z.string().nullable().optional(),
  points: z.number().int().nonnegative().optional(),
  comparisonMode: z
    .enum(['EXACT', 'TRIM_TRAILING_WS', 'IGNORE_BLANK_LINES', 'FLOAT'])
    .optional(),
  floatTolerance: z.number().positive().optional(),
  allowPartialCredit: z.boolean().optional(),
});

const testCaseInputSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
  isSample: z.boolean().default(false),
  order: z.number().int(),
  timeLimitMs: z.number().int().positive().default(2000),
  memoryLimitMb: z.number().int().positive().default(256),
});

const solutionInputSchema = z.object({
  code: z.string(),
});

tasksRouter.get('/:taskId', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      testCases: { orderBy: { order: 'asc' } },
      solutions: true,
    },
  });

  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  res.json({ task });
});

tasksRouter.patch('/:taskId', async (req, res) => {
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const existing = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!existing) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const task = await prisma.task.update({
    where: { id: req.params.taskId },
    data: parsed.data,
  });

  res.json({ task });
});

// Authoring aid: run a candidate solution against every test case and return
// the raw stdout per case so the teacher can confirm (or fix) expected
// outputs. Java only — client-exec languages (C/JS/TS/Python) are run in the
// teacher's browser via the same `runClientSide` the student flow uses, so
// they never hit this endpoint. Never persists anything.
const checkSolutionSchema = z.object({ code: z.string().min(1).max(200_000) });

tasksRouter.post('/:taskId/check-solution', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { testCases: { orderBy: { order: 'asc' } } },
  });
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const parsed = checkSolutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  if (!isServerExec(task.language)) {
    res.status(400).json({ error: 'この言語はブラウザ側で検証します。' });
    return;
  }
  if (!isJudgeConfigured()) {
    res.status(503).json({ error: 'この言語の実行環境が現在利用できません。' });
    return;
  }
  if (task.testCases.length === 0) {
    res.status(400).json({ error: 'テストケースがありません。' });
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
    jr = await withJudgeSlot(req.user!.id, () => runOnJudge({ code: parsed.data.code, tests }));
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
    res.json({ compileFailed: true, compileStderr: jr.compile.stderr, outcomes: [] });
    return;
  }
  res.json({
    compileFailed: false,
    compileStderr: '',
    outcomes: jr.results.map((r) => ({
      testCaseId: r.id,
      stage:
        r.timedOut || r.oom || (r.exitCode ?? 1) !== 0
          ? ('runtime_error' as const)
          : ('success' as const),
      stdout: r.stdout,
    })),
  });
});

tasksRouter.delete('/:taskId', async (req, res) => {
  const existing = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!existing) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  await prisma.task.delete({ where: { id: req.params.taskId } });
  res.status(204).end();
});

tasksRouter.post('/:taskId/test-cases', async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const parsed = testCaseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const testCase = await prisma.testCase.create({
    data: { taskId: task.id, ...parsed.data },
  });

  res.status(201).json({ testCase });
});

// Bulk import — append many test cases at once (paste from a spreadsheet /
// generator). `order` continues from the current count.
const bulkTestCaseSchema = z.object({
  cases: z
    .array(
      z.object({
        input: z.string(),
        expectedOutput: z.string(),
        isSample: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(200),
});

tasksRouter.post('/:taskId/test-cases/bulk', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { _count: { select: { testCases: true } } },
  });
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const parsed = bulkTestCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const base = task._count.testCases;
  await prisma.testCase.createMany({
    data: parsed.data.cases.map((c, i) => ({
      taskId: task.id,
      input: c.input,
      expectedOutput: c.expectedOutput,
      isSample: c.isSample,
      order: base + i,
    })),
  });
  const testCases = await prisma.testCase.findMany({
    where: { taskId: task.id },
    orderBy: { order: 'asc' },
  });
  res.status(201).json({ testCases });
});

// Re-grade every existing submission for this task against its *current* test
// cases + comparison settings. Java only — client-executed languages can't be
// re-run server-side. Mutates otherwise-immutable submissions (a
// teacher-initiated correction, like 差し戻し) and recomputes affected attempt
// scores. Runs sequentially through the judge queue.
tasksRouter.post('/:taskId/regrade', async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { testCases: true },
  });
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }
  if (!isRegradeCapable(task.language)) {
    res.status(400).json({ error: 'サーバー側で再採点できるのは Java / C のみです。' });
    return;
  }
  if (!isJudgeConfigured()) {
    res.status(503).json({ error: 'judge が未設定です。' });
    return;
  }

  const submissions = await prisma.submission.findMany({ where: { taskId: task.id } });
  const tests = task.testCases.map((tc) => ({
    id: tc.id,
    stdin: tc.input,
    timeLimitMs: tc.timeLimitMs,
    memoryLimitMb: tc.memoryLimitMb,
  }));
  const language = judgeLanguage(task.language);

  let changed = 0;
  let failed = 0;
  const affectedAttemptIds = new Set<string>();

  for (const sub of submissions) {
    let jr;
    try {
      jr = await withJudgeSlot(req.user!.id, () => runOnJudge({ language, code: sub.code, tests }));
    } catch {
      failed += 1;
      continue;
    }
    const verdict = judgeSubmission(
      task.testCases,
      task.points,
      judgeInputFromContainer(jr),
      { mode: task.comparisonMode, floatTolerance: task.floatTolerance },
      task.allowPartialCredit,
    );
    if (verdict.overallStatus !== sub.overallStatus || verdict.score !== sub.score) {
      changed += 1;
    }
    await prisma.submission.update({
      where: { id: sub.id },
      data: {
        overallStatus: verdict.overallStatus,
        score: verdict.score,
        results: verdict.results as unknown as Prisma.InputJsonValue,
      },
    });
    if (sub.attemptId) affectedAttemptIds.add(sub.attemptId);
  }

  for (const attemptId of affectedAttemptIds) {
    const subs = await prisma.submission.findMany({
      where: { attemptId },
      select: { score: true },
    });
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: { score: subs.reduce((s, x) => s + x.score, 0) },
    });
  }

  res.json({ regraded: submissions.length - failed, changed, failed });
});

// Duplicate a task (with its test cases + reference solutions) into the same
// exam by default, or into `examId` if given. The copy is appended last.
tasksRouter.post('/:taskId/duplicate', async (req, res) => {
  const src = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: { testCases: { orderBy: { order: 'asc' } }, solutions: true },
  });
  if (!src) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const targetExamId: string =
    typeof req.body?.examId === 'string' && req.body.examId ? req.body.examId : src.examId;
  const targetExam = await prisma.exam.findUnique({
    where: { id: targetExamId },
    include: { _count: { select: { tasks: true } } },
  });
  if (!targetExam) {
    res.status(400).json({ error: '複製先の試験が見つかりません。' });
    return;
  }

  const created = await prisma.task.create({
    data: {
      examId: targetExamId,
      order: targetExam._count.tasks,
      title: `${src.title}（コピー）`,
      statementMarkdown: src.statementMarkdown,
      language: src.language,
      starterCode: src.starterCode,
      points: src.points,
      comparisonMode: src.comparisonMode,
      floatTolerance: src.floatTolerance,
      allowPartialCredit: src.allowPartialCredit,
      testCases: {
        create: src.testCases.map((tc) => ({
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isSample: tc.isSample,
          order: tc.order,
          timeLimitMs: tc.timeLimitMs,
          memoryLimitMb: tc.memoryLimitMb,
        })),
      },
      solutions: {
        create: src.solutions.map((s) => ({ language: s.language, code: s.code })),
      },
    },
    include: { testCases: { orderBy: { order: 'asc' } }, solutions: true },
  });

  res.status(201).json({ task: created });
});

tasksRouter.put('/:taskId/solutions/:language', async (req, res) => {
  const language = parseLanguageParam(req.params.language);
  if (!language) {
    res.status(400).json({ error: 'language の指定が不正です。' });
    return;
  }

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const parsed = solutionInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const solution = await prisma.solution.upsert({
    where: { taskId_language: { taskId: task.id, language } },
    create: { taskId: task.id, language, code: parsed.data.code },
    update: { code: parsed.data.code },
  });

  res.json({ solution });
});

tasksRouter.delete('/:taskId/solutions/:language', async (req, res) => {
  const language = parseLanguageParam(req.params.language);
  if (!language) {
    res.status(400).json({ error: 'language の指定が不正です。' });
    return;
  }

  await prisma.solution
    .delete({ where: { taskId_language: { taskId: req.params.taskId, language } } })
    .catch(() => null);

  res.status(204).end();
});
