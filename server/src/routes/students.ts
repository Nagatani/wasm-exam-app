import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { generateInitialPassword } from '../lib/provisioning';

export const studentsRouter = Router();

studentsRouter.use(requireAuth, requireRole('TEACHER'));

const bulkSchema = z.object({
  students: z
    .array(
      z.object({
        studentNumber: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9_-]{3,32}$/, '学籍番号は英数字・ハイフン・アンダースコアのみ、3〜32文字です。'),
        displayName: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(1000),
  // Optionally enroll every listed student (created or pre-existing) into this
  // course.
  courseId: z.string().nullable().optional(),
});

// Bulk-provision student accounts from a roster. Each new account gets a random
// initial password (returned once here, and re-viewable via the course roster
// until the student changes it) and `mustChangePassword`. Existing
// studentNumbers are left untouched and reported as skipped.
studentsRouter.post('/bulk', async (req, res) => {
  const parsed = bulkSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  // De-dupe within the request (first occurrence wins).
  const seen = new Set<string>();
  const rows = parsed.data.students.filter((s) => {
    if (seen.has(s.studentNumber)) return false;
    seen.add(s.studentNumber);
    return true;
  });

  const existing = await prisma.user.findMany({
    where: { studentNumber: { in: rows.map((r) => r.studentNumber) } },
    select: { id: true, studentNumber: true },
  });
  const existingByNumber = new Map(existing.map((u) => [u.studentNumber, u.id]));

  const created: { studentNumber: string; displayName: string; initialPassword: string }[] = [];
  const skipped: string[] = [];
  const targetUserIds: string[] = [];

  for (const row of rows) {
    const existingId = existingByNumber.get(row.studentNumber);
    if (existingId) {
      skipped.push(row.studentNumber);
      targetUserIds.push(existingId);
      continue;
    }
    const initialPassword = generateInitialPassword();
    const user = await prisma.user.create({
      data: {
        studentNumber: row.studentNumber,
        displayName: row.displayName,
        passwordHash: await bcrypt.hash(initialPassword, 12),
        role: 'STUDENT',
        mustChangePassword: true,
        initialPassword,
      },
      select: { id: true },
    });
    targetUserIds.push(user.id);
    created.push({
      studentNumber: row.studentNumber,
      displayName: row.displayName,
      initialPassword,
    });
  }

  let enrolled = 0;
  const courseId = parsed.data.courseId;
  if (courseId) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (course) {
      const already = await prisma.enrollment.findMany({
        where: { courseId, userId: { in: targetUserIds } },
        select: { userId: true },
      });
      const alreadyIds = new Set(already.map((e) => e.userId));
      const toEnroll = targetUserIds.filter((id) => !alreadyIds.has(id));
      if (toEnroll.length > 0) {
        await prisma.enrollment.createMany({
          data: toEnroll.map((userId) => ({ courseId, userId })),
        });
      }
      enrolled = toEnroll.length;
    }
  }

  res.status(201).json({ created, skipped, enrolled });
});
