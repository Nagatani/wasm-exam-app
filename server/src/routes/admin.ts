import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { toPublicUser } from '../lib/publicUser';
import { requireAuth, requireRole } from '../middleware/auth';

export const adminRouter = Router();

const promoteSchema = z.object({
  targetStudentNumber: z.string().min(1),
});

// Only an existing teacher can promote another account to teacher — this is
// the sole path by which a user's role can change after signup.
adminRouter.post(
  '/promote-to-teacher',
  requireAuth,
  requireRole('TEACHER'),
  async (req, res) => {
    const parsed = promoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'targetStudentNumber は必須です。' });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { studentNumber: parsed.data.targetStudentNumber },
    });
    if (!target) {
      res.status(404).json({ error: '対象の学籍番号が見つかりません。' });
      return;
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: 'TEACHER' },
    });

    res.json({ user: toPublicUser(updated) });
  },
);
