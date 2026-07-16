import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const examsRouter = Router();

// Every route here is teacher-only admin console functionality — students
// browsing published exams is a separate (Phase 4) concern with its own,
// much narrower read endpoint.
examsRouter.use(requireAuth, requireRole('TEACHER'));

const examInputSchema = z.object({
  title: z.string().min(1, 'タイトルは必須です。'),
  description: z.string().nullable().optional(),
  timeLimitMinutes: z.number().int().positive('制限時間は1分以上で入力してください。'),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

const taskInputSchema = z.object({
  order: z.number().int(),
  title: z.string().min(1, 'タイトルは必須です。'),
  statementMarkdown: z.string().default(''),
  starterCodeC: z.string().nullable().optional(),
  starterCodeJava: z.string().nullable().optional(),
  points: z.number().int().nonnegative().default(0),
});

examsRouter.get('/', async (_req, res) => {
  const exams = await prisma.exam.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tasks: true } } },
  });

  res.json({
    exams: exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      timeLimitMinutes: exam.timeLimitMinutes,
      status: exam.status,
      createdAt: exam.createdAt,
      updatedAt: exam.updatedAt,
      taskCount: exam._count.tasks,
    })),
  });
});

examsRouter.post('/', async (req, res) => {
  const parsed = examInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const exam = await prisma.exam.create({
    data: {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      timeLimitMinutes: parsed.data.timeLimitMinutes,
      status: parsed.data.status ?? 'DRAFT',
      createdById: req.user!.id,
    },
  });

  res.status(201).json({ exam });
});

examsRouter.get('/:examId', async (req, res) => {
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId },
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

  res.json({ exam });
});

examsRouter.patch('/:examId', async (req, res) => {
  const parsed = examInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const existing = await prisma.exam.findUnique({ where: { id: req.params.examId } });
  if (!existing) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const exam = await prisma.exam.update({
    where: { id: req.params.examId },
    data: parsed.data,
  });

  res.json({ exam });
});

examsRouter.delete('/:examId', async (req, res) => {
  const existing = await prisma.exam.findUnique({ where: { id: req.params.examId } });
  if (!existing) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  await prisma.exam.delete({ where: { id: req.params.examId } });
  res.status(204).end();
});

examsRouter.post('/:examId/tasks', async (req, res) => {
  const exam = await prisma.exam.findUnique({ where: { id: req.params.examId } });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const parsed = taskInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const task = await prisma.task.create({
    data: {
      examId: exam.id,
      order: parsed.data.order,
      title: parsed.data.title,
      statementMarkdown: parsed.data.statementMarkdown,
      starterCodeC: parsed.data.starterCodeC ?? null,
      starterCodeJava: parsed.data.starterCodeJava ?? null,
      points: parsed.data.points,
    },
  });

  res.status(201).json({ task });
});
