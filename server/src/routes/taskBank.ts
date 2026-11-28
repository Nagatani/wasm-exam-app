import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { parseLanguageParam } from '../lib/language';

// A searchable view across every task the caller is allowed to discover:
// their own (via the task's exam's `createdById`) plus anything another
// teacher has marked `isPublic`. This is a *discovery* boundary only — it
// doesn't restrict direct task/exam access, which stays the existing
// "any teacher can edit any exam" admin-console model (see CLAUDE.md). No
// separate bank/template model: every task ever authored is itself a bank
// entry, reusing the existing duplicate-into-exam endpoint to "add" one.
export const taskBankRouter = Router();

taskBankRouter.use(requireAuth, requireRole('TEACHER'));

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function makeStatementPreview(markdown: string): string {
  const normalized = markdown.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 160)}…`;
}

taskBankRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const scope = req.query.scope === 'mine' || req.query.scope === 'public' ? req.query.scope : 'all';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const language = typeof req.query.language === 'string' ? parseLanguageParam(req.query.language) : null;
  const tags = parseTags(req.query.tags);
  const sort =
    req.query.sort === 'title' || req.query.sort === 'points' ? req.query.sort : 'newest';

  const visibility: Prisma.TaskWhereInput =
    scope === 'mine'
      ? { exam: { createdById: userId } }
      : scope === 'public'
        ? { isPublic: true }
        : { OR: [{ exam: { createdById: userId } }, { isPublic: true }] };

  const where: Prisma.TaskWhereInput = {
    AND: [
      visibility,
      q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { statementMarkdown: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
      language ? { language } : {},
      tags.length > 0 ? { tags: { hasSome: tags } } : {},
    ],
  };

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    sort === 'title'
      ? [{ title: 'asc' }, { createdAt: 'desc' }]
      : sort === 'points'
        ? [{ points: 'desc' }, { createdAt: 'desc' }]
        : [{ createdAt: 'desc' }];

  const tasks = await prisma.task.findMany({
    where,
    orderBy,
    take: 200,
    include: {
      exam: { select: { id: true, title: true, createdById: true, createdBy: { select: { displayName: true } } } },
      _count: { select: { testCases: true } },
    },
  });

  res.json({
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      statementPreview: makeStatementPreview(t.statementMarkdown),
      language: t.language,
      points: t.points,
      tags: t.tags,
      isPublic: t.isPublic,
      testCaseCount: t._count.testCases,
      examId: t.examId,
      examTitle: t.exam.title,
      ownerName: t.exam.createdBy.displayName,
      mine: t.exam.createdById === userId,
      createdAt: t.createdAt,
    })),
  });
});

// Tag-name autocomplete, scoped to the same visibility as the search above —
// no point suggesting a tag from a task the caller can't even see.
taskBankRouter.get('/tags', async (req, res) => {
  const userId = req.user!.id;
  const tasks = await prisma.task.findMany({
    where: { OR: [{ exam: { createdById: userId } }, { isPublic: true }] },
    select: { tags: true },
  });
  const tagSet = new Set<string>();
  for (const t of tasks) for (const tag of t.tags) tagSet.add(tag);
  res.json({ tags: [...tagSet].sort((a, b) => a.localeCompare(b, 'ja')) });
});
