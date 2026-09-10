import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { languageSchema, parseLanguageParam } from '../lib/language';
import { isServerExec } from '../lib/attempts';
import { isJudgeConfigured, runOnJudge, JudgeError } from '../lib/judgeClient';
import { withJudgeSlot, QueueRejectedError } from '../lib/executionQueue';

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
