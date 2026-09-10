import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { getExamResults } from '../lib/examResults';
import { toCsv, UTF8_BOM } from '../lib/csv';
import { languageSchema } from '../lib/language';

export const examsRouter = Router();

// Every route here is teacher-only admin console functionality — students
// browsing published exams is a separate (Phase 4) concern with its own,
// much narrower read endpoint.
examsRouter.use(requireAuth, requireRole('TEACHER'));

const examInputSchema = z.object({
  title: z.string().min(1, 'タイトルは必須です。'),
  description: z.string().nullable().optional(),
  timeLimitMinutes: z.number().int().positive('制限時間は1分以上で入力してください。'),
  // How many times a student may take this exam. `null` = unlimited; omit to
  // keep the current value (default 1 on create).
  maxAttempts: z
    .number()
    .int()
    .positive('受験可能回数は1以上で入力してください。')
    .nullable()
    .optional(),
  // Optional scheduling window. `null` clears; omit to keep.
  opensAt: z.coerce.date().nullable().optional(),
  closesAt: z.coerce.date().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

const comparisonModeSchema = z.enum([
  'EXACT',
  'TRIM_TRAILING_WS',
  'IGNORE_BLANK_LINES',
  'FLOAT',
]);

const taskInputSchema = z.object({
  order: z.number().int(),
  title: z.string().min(1, 'タイトルは必須です。'),
  statementMarkdown: z.string().default(''),
  language: languageSchema.default('C'),
  starterCode: z.string().nullable().optional(),
  points: z.number().int().nonnegative().default(0),
  comparisonMode: comparisonModeSchema.optional(),
  floatTolerance: z.number().positive().optional(),
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
      // `undefined` → schema default (1); `null` → unlimited.
      ...(parsed.data.maxAttempts !== undefined
        ? { maxAttempts: parsed.data.maxAttempts }
        : {}),
      ...(parsed.data.opensAt !== undefined ? { opensAt: parsed.data.opensAt } : {}),
      ...(parsed.data.closesAt !== undefined ? { closesAt: parsed.data.closesAt } : {}),
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

  // Mirrors the dashboard: the summary columns (matching its collapsed row)
  // come first, then the per-task detail (matching its accordion contents)
  // is appended at the tail rather than interleaved with the summary.
  const header = [
    '学籍番号',
    '氏名',
    '試験名',
    ...results.tasks.map((t) => t.title),
    '合計点',
    '受験回数',
    '提出日時',
    '所要時間（秒）',
    ...results.tasks.map((t) => `${t.title}（解答時間・秒）`),
    ...results.tasks.map((t) => `${t.title}（打鍵数）`),
  ];

  const rows = results.students.map((student) => [
    student.studentNumber,
    student.displayName,
    results.exam.title,
    ...student.results.map((r) => String(r.score)),
    String(student.totalScore),
    String(student.attemptCount),
    student.lastSubmittedAt ? student.lastSubmittedAt.toISOString() : '',
    student.elapsedSeconds !== null ? String(student.elapsedSeconds) : '',
    ...student.results.map((r) => (r.timeSpentSeconds !== null ? String(r.timeSpentSeconds) : '')),
    ...student.results.map((r) => (r.keystrokeCount !== null ? String(r.keystrokeCount) : '')),
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

// The submitted code + per-test-case outcomes for one student's *latest
// submitted attempt* — so a teacher can see why a submission got its verdict.
// Mirrors `getExamResults`'s "latest SUBMITTED attempt" rule.
examsRouter.get('/:examId/students/:studentId/submission-detail', async (req, res) => {
  const { examId, studentId } = req.params;
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
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

  const attempt = await prisma.examAttempt.findFirst({
    where: { examId, studentId, status: 'SUBMITTED' },
    orderBy: { attemptNumber: 'desc' },
  });
  if (!attempt) {
    res.json({ attemptNumber: null, tasks: [] });
    return;
  }

  const submissions = await prisma.submission.findMany({ where: { attemptId: attempt.id } });
  const byTask = new Map(submissions.map((s) => [s.taskId, s]));

  res.json({
    attemptNumber: attempt.attemptNumber,
    tasks: exam.tasks.map((t) => {
      const s = byTask.get(t.id);
      return {
        taskId: t.id,
        title: t.title,
        order: t.order,
        points: t.points,
        language: t.language,
        submitted: !!s,
        overallStatus: s?.overallStatus ?? null,
        score: s?.score ?? 0,
        code: s?.code ?? null,
        results: s ? s.results : [],
        testCases: t.testCases.map((tc) => ({
          id: tc.id,
          order: tc.order,
          input: tc.input,
          expectedOutput: tc.expectedOutput,
          isSample: tc.isSample,
        })),
      };
    }),
  });
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
      language: parsed.data.language,
      starterCode: parsed.data.starterCode ?? null,
      points: parsed.data.points,
    },
  });

  res.status(201).json({ task });
});
