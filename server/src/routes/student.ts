import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { judgeSubmission } from '../lib/judge';

export const studentRouter = Router();

studentRouter.use(requireAuth);

const outcomeSchema = z.object({
  testCaseId: z.string(),
  stage: z.enum(['success', 'runtime_error']),
  stdout: z.string(),
});

const judgeRequestSchema = z.object({
  compileFailed: z.boolean(),
  outcomes: z.array(outcomeSchema),
});

studentRouter.get('/exams', async (_req, res) => {
  const exams = await prisma.exam.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { tasks: true } } },
  });

  res.json({
    exams: exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      timeLimitMinutes: exam.timeLimitMinutes,
      taskCount: exam._count.tasks,
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
      starterCodeC: task.starterCodeC,
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

  const parsed = judgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const verdict = judgeSubmission(task.testCases, task.points, parsed.data);

  // Ephemeral: this is the "try it out" run, nothing is persisted.
  res.json({ verdict });
});

const submissionRequestSchema = judgeRequestSchema.extend({
  taskId: z.string(),
  language: z.literal('C'),
  code: z.string(),
});

studentRouter.post('/submissions', async (req, res) => {
  const parsed = submissionRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const task = await prisma.task.findUnique({
    where: { id: parsed.data.taskId },
    include: {
      exam: { select: { id: true, status: true } },
      testCases: true,
    },
  });

  if (!task || task.exam.status !== 'PUBLISHED') {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const verdict = judgeSubmission(task.testCases, task.points, parsed.data);

  const submission = await prisma.submission.create({
    data: {
      examId: task.exam.id,
      taskId: task.id,
      studentId: req.user!.id,
      language: 'C',
      code: parsed.data.code,
      results: verdict.results as unknown as Prisma.InputJsonValue,
      overallStatus: verdict.overallStatus,
      score: verdict.score,
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
