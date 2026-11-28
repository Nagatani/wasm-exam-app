import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { toPublicUser } from '../lib/publicUser';
import { requireAuth, requireRole } from '../middleware/auth';
import { checkJudgeHealth, getJudgePoolSnapshot } from '../lib/judgeClient';
import { getExecutionQueueStats } from '../lib/executionQueue';
import { getGradingQueueStats } from '../lib/grading';
import { clearIpRateLimit } from '../lib/loginRateLimit';
import { invalidateSessionCacheForUser } from '../lib/session';

export const adminRouter = Router();

// Quick liveness and operational metrics of the backing services, for the
// teacher admin dashboard.
adminRouter.get('/service-health', requireAuth, requireRole('TEACHER'), async (_req, res) => {
  let db: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }
  const judgeHealth = await checkJudgeHealth();
  const judge: 'ok' | 'error' | 'disabled' = !judgeHealth.configured
    ? 'disabled'
    : judgeHealth.ok
      ? 'ok'
      : 'error';
  res.json({
    db,
    judge,
    judgePool: {
      healthy: judgeHealth.healthyCount,
      total: judgeHealth.totalCount,
    },
    metrics: {
      execution: getExecutionQueueStats(),
      grading: getGradingQueueStats(),
      judgePool: getJudgePoolSnapshot().map(({ url, inFlight, healthy }) => ({
        url,
        inFlight,
        healthy,
      })),
    },
  });
});

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
    invalidateSessionCacheForUser(target.id);

    res.json({ user: toPublicUser(updated) });
  },
);

const clearIpLockoutSchema = z.object({
  ip: z.string().trim().min(1).optional(),
});

// Teacher escape hatch when a shared classroom NAT IP trips the per-IP login
// rate limit. Omit `ip` to clear all IP lockout entries.
adminRouter.post(
  '/clear-ip-lockout',
  requireAuth,
  requireRole('TEACHER'),
  (req, res) => {
    const parsed = clearIpLockoutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'ip の指定が不正です。' });
      return;
    }

    const cleared = clearIpRateLimit(parsed.data.ip);
    res.json({ cleared });
  },
);
