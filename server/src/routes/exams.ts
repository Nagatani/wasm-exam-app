import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { getExamResults } from '../lib/examResults';
import { toCsv, UTF8_BOM } from '../lib/csv';

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

examsRouter.get('/:examId/results', async (req, res) => {
  const results = await getExamResults(req.params.examId);
  if (!results) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }
  res.json(results);
});

examsRouter.get('/:examId/results/csv', async (req, res) => {
  const results = await getExamResults(req.params.examId);
  if (!results) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const header = [
    '学籍番号',
    '氏名',
    '試験名',
    ...results.tasks.map((t) => t.title),
    '合計点',
    '所要時間（秒）',
    '提出日時',
  ];

  const rows = results.students.map((student) => [
    student.studentNumber,
    student.displayName,
    results.exam.title,
    ...student.results.map((r) => String(r.score)),
    String(student.totalScore),
    student.elapsedSeconds !== null ? String(student.elapsedSeconds) : '',
    student.lastSubmittedAt ? student.lastSubmittedAt.toISOString() : '',
  ]);

  const csv = UTF8_BOM + toCsv([header, ...rows]);
  const asciiFilename = `exam-results-${results.exam.id}.csv`;
  const utf8Filename = encodeURIComponent(`${results.exam.title}-成績.csv`);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`,
  );
  res.send(csv);
});

// "差し戻し": wipes a single student's attempt at this exam back to
// never-took-it — deletes every Submission plus the ExamAttempt row so the
// student-side countdown restarts from scratch the next time they open it.
// Irreversible (submissions are otherwise immutable by design), so this is
// the one place that deliberately breaks that invariant, and only a teacher
// can reach it.
examsRouter.delete('/:examId/students/:studentId/results', async (req, res) => {
  const { examId, studentId } = req.params;

  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) {
    res.status(404).json({ error: '試験が見つかりません。' });
    return;
  }

  const student = await prisma.user.findUnique({ where: { id: studentId } });
  if (!student || student.role !== 'STUDENT') {
    res.status(404).json({ error: '生徒が見つかりません。' });
    return;
  }

  await prisma.$transaction([
    prisma.submission.deleteMany({ where: { examId, studentId } }),
    prisma.examAttempt.deleteMany({ where: { examId, studentId } }),
  ]);

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
