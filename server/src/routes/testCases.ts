import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';

export const testCasesRouter = Router();

testCasesRouter.use(requireAuth, requireRole('TEACHER'));

const testCaseUpdateSchema = z.object({
  input: z.string().optional(),
  expectedOutput: z.string().optional(),
  isSample: z.boolean().optional(),
  order: z.number().int().optional(),
  timeLimitMs: z.number().int().positive().optional(),
  memoryLimitMb: z.number().int().positive().optional(),
});

testCasesRouter.patch('/:testCaseId', async (req, res) => {
  const parsed = testCaseUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'invalid_request' });
    return;
  }

  const existing = await prisma.testCase.findUnique({ where: { id: req.params.testCaseId } });
  if (!existing) {
    res.status(404).json({ error: 'テストケースが見つかりません。' });
    return;
  }

  const testCase = await prisma.testCase.update({
    where: { id: req.params.testCaseId },
    data: parsed.data,
  });

  res.json({ testCase });
});

testCasesRouter.delete('/:testCaseId', async (req, res) => {
  const existing = await prisma.testCase.findUnique({ where: { id: req.params.testCaseId } });
  if (!existing) {
    res.status(404).json({ error: 'テストケースが見つかりません。' });
    return;
  }

  await prisma.testCase.delete({ where: { id: req.params.testCaseId } });
  res.status(204).end();
});
