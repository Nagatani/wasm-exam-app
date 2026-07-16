import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const tasksRouter = Router();

tasksRouter.use(requireAuth, requireRole('TEACHER'));

const taskUpdateSchema = z.object({
  order: z.number().int().optional(),
  title: z.string().min(1).optional(),
  statementMarkdown: z.string().optional(),
  starterCodeC: z.string().nullable().optional(),
  starterCodeJava: z.string().nullable().optional(),
  points: z.number().int().nonnegative().optional(),
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
  const language = req.params.language.toUpperCase();
  if (language !== 'C' && language !== 'JAVA') {
    res.status(400).json({ error: 'language は C または JAVA を指定してください。' });
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
  const language = req.params.language.toUpperCase();
  if (language !== 'C' && language !== 'JAVA') {
    res.status(400).json({ error: 'language は C または JAVA を指定してください。' });
    return;
  }

  await prisma.solution
    .delete({ where: { taskId_language: { taskId: req.params.taskId, language } } })
    .catch(() => null);

  res.status(204).end();
});
