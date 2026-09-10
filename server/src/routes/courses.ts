import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const coursesRouter = Router();

coursesRouter.use(requireAuth, requireRole('TEACHER'));

const courseInputSchema = z.object({
  name: z.string().min(1, 'クラス名は必須です。'),
  term: z.string().nullable().optional(),
});

coursesRouter.get('/', async (_req, res) => {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { enrollments: true, exams: true } } },
  });
  res.json({
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      term: c.term,
      createdAt: c.createdAt,
      enrollmentCount: c._count.enrollments,
      examCount: c._count.exams,
    })),
  });
});

coursesRouter.post('/', async (req, res) => {
  const parsed = courseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }
  const course = await prisma.course.create({
    data: {
      name: parsed.data.name,
      term: parsed.data.term ?? null,
      createdById: req.user!.id,
    },
  });
  res.status(201).json({ course });
});

coursesRouter.get('/:courseId', async (req, res) => {
  const course = await prisma.course.findUnique({
    where: { id: req.params.courseId },
    include: {
      enrollments: {
        include: { user: { select: { id: true, studentNumber: true, displayName: true } } },
        orderBy: { user: { studentNumber: 'asc' } },
      },
      exams: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true },
      },
    },
  });
  if (!course) {
    res.status(404).json({ error: 'クラスが見つかりません。' });
    return;
  }
  res.json({
    course: {
      id: course.id,
      name: course.name,
      term: course.term,
      createdAt: course.createdAt,
      students: course.enrollments.map((e) => ({
        userId: e.user.id,
        studentNumber: e.user.studentNumber,
        displayName: e.user.displayName,
        enrolledAt: e.createdAt,
      })),
      exams: course.exams,
    },
  });
});

coursesRouter.patch('/:courseId', async (req, res) => {
  const parsed = courseInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }
  const existing = await prisma.course.findUnique({ where: { id: req.params.courseId } });
  if (!existing) {
    res.status(404).json({ error: 'クラスが見つかりません。' });
    return;
  }
  const course = await prisma.course.update({
    where: { id: req.params.courseId },
    data: parsed.data,
  });
  res.json({ course });
});

coursesRouter.delete('/:courseId', async (req, res) => {
  const existing = await prisma.course.findUnique({ where: { id: req.params.courseId } });
  if (!existing) {
    res.status(404).json({ error: 'クラスが見つかりません。' });
    return;
  }
  // Enrollments cascade; exams keep existing but lose their course scoping
  // (onDelete: SetNull), reverting to "visible to every student".
  await prisma.course.delete({ where: { id: req.params.courseId } });
  res.status(204).end();
});

// Bulk-add students by 学籍番号 (the roster CSV import feeds this). Reports
// which numbers were added / already enrolled / not a known student account.
const enrollSchema = z.object({
  studentNumbers: z.array(z.string().trim().min(1)).min(1).max(1000),
});

coursesRouter.post('/:courseId/enrollments', async (req, res) => {
  const course = await prisma.course.findUnique({ where: { id: req.params.courseId } });
  if (!course) {
    res.status(404).json({ error: 'クラスが見つかりません。' });
    return;
  }
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const wanted = [...new Set(parsed.data.studentNumbers.map((s) => s.trim()))];
  const users = await prisma.user.findMany({
    where: { studentNumber: { in: wanted }, role: 'STUDENT' },
    select: { id: true, studentNumber: true },
  });
  const byNumber = new Map(users.map((u) => [u.studentNumber, u.id]));

  const existing = await prisma.enrollment.findMany({
    where: { courseId: course.id, userId: { in: users.map((u) => u.id) } },
    select: { userId: true },
  });
  const alreadyIds = new Set(existing.map((e) => e.userId));

  const notFound: string[] = [];
  const alreadyEnrolled: string[] = [];
  const toCreate: { courseId: string; userId: string }[] = [];
  for (const number of wanted) {
    const id = byNumber.get(number);
    if (!id) {
      notFound.push(number);
    } else if (alreadyIds.has(id)) {
      alreadyEnrolled.push(number);
    } else {
      toCreate.push({ courseId: course.id, userId: id });
    }
  }

  if (toCreate.length > 0) {
    await prisma.enrollment.createMany({ data: toCreate });
  }

  res.status(201).json({
    added: toCreate.length,
    alreadyEnrolled,
    notFound,
  });
});

coursesRouter.delete('/:courseId/enrollments/:userId', async (req, res) => {
  await prisma.enrollment
    .delete({
      where: {
        courseId_userId: { courseId: req.params.courseId, userId: req.params.userId },
      },
    })
    .catch(() => null);
  res.status(204).end();
});
