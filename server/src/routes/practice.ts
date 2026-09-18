import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { judgeSubmission } from '../lib/judge';
import { resolveOutcomes, RunRequestError, type ResolvedOutcomes } from '../lib/execution';

// Practice mode (ExamMode.PRACTICE): untimed, unlimited-retry learning
// support. Deliberately routes around every ExamAttempt/TaskDraft concept —
// see CLAUDE.md "演習モード" and the plan this was built from. A practice
// "exam" is just a Task container with no time limit / attempt cap; a
// student may run (ephemeral) or submit (recorded as PracticeSubmission,
// unlimited history) any of its tasks at any time, gated only by course
// visibility + `status === 'PUBLISHED'`, exactly like the real exam flow's
// visibility rules.

export const practiceRouter = Router();

practiceRouter.use(requireAuth);

async function enrolledCourseIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.enrollment.findMany({
    where: { userId },
    select: { courseId: true },
  });
  return new Set(rows.map((r) => r.courseId));
}

function examVisible(courseId: string | null, enrolled: Set<string>): boolean {
  return courseId === null || enrolled.has(courseId);
}

// ---------------------------------------------------------------------------
// Practice set (Exam, mode: PRACTICE) listing / entry
// ---------------------------------------------------------------------------

practiceRouter.get('/exams', async (req, res) => {
  const userId = req.user!.id;
  const enrolled = await enrolledCourseIds(userId);
  const exams = (
    await prisma.exam.findMany({
      where: { status: 'PUBLISHED', mode: 'PRACTICE' },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { tasks: true } },
        tasks: { select: { points: true, language: true } },
      },
    })
  ).filter((e) => examVisible(e.courseId, enrolled));

  res.json({
    exams: exams.map((exam) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      courseId: exam.courseId,
      defaultLanguage: exam.defaultLanguage,
      taskCount: exam._count.tasks,
      totalPoints: exam.tasks.reduce((sum, t) => sum + t.points, 0),
      languages: [...new Set(exam.tasks.map((t) => t.language))],
    })),
  });
});

practiceRouter.get('/exams/:examId', async (req, res) => {
  const userId = req.user!.id;
  const exam = await prisma.exam.findUnique({
    where: { id: req.params.examId, status: 'PUBLISHED', mode: 'PRACTICE' },
    include: {
      tasks: {
        orderBy: { order: 'asc' },
        select: { id: true, order: true, title: true, points: true, language: true },
      },
    },
  });
  if (!exam || !examVisible(exam.courseId, await enrolledCourseIds(userId))) {
    res.status(404).json({ error: '演習セットが見つかりません。' });
    return;
  }

  res.json({
    exam: {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      tasks: exam.tasks,
      totalPoints: exam.tasks.reduce((sum, t) => sum + t.points, 0),
    },
  });
});

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

practiceRouter.get('/tasks/:taskId', async (req, res) => {
  const userId = req.user!.id;
  const task = await prisma.task.findUnique({
    where: { id: req.params.taskId },
    include: {
      exam: { select: { id: true, mode: true, status: true, courseId: true } },
      testCases: { orderBy: { order: 'asc' } },
    },
  });
  if (
    !task ||
    task.exam.mode !== 'PRACTICE' ||
    task.exam.status !== 'PUBLISHED' ||
    !examVisible(task.exam.courseId, await enrolledCourseIds(userId))
  ) {
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
      language: task.language,
      starterCode: task.starterCode,
      points: task.points,
      aiHintEnabled: task.aiHintEnabled,
      aiHintMaxStage: task.aiHintMaxStage,
      // Hidden (non-sample) test cases expose only `input` — same redaction
      // rule as the exam flow (server/src/routes/student.ts).
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

async function loadPracticeTask(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      exam: { select: { mode: true, status: true, courseId: true } },
      testCases: true,
    },
  });
  if (
    !task ||
    task.exam.mode !== 'PRACTICE' ||
    task.exam.status !== 'PUBLISHED' ||
    !examVisible(task.exam.courseId, await enrolledCourseIds(userId))
  ) {
    return null;
  }
  return task;
}

// Ephemeral preview — judges but never persists, identical semantics to the
// exam flow's POST /api/student/tasks/:taskId/run.
practiceRouter.post('/tasks/:taskId/run', async (req, res) => {
  const userId = req.user!.id;
  const task = await loadPracticeTask(req.params.taskId, userId);
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  let resolved: ResolvedOutcomes;
  try {
    resolved = await resolveOutcomes(req.body, task, userId);
  } catch (err) {
    if (err instanceof RunRequestError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  const verdict = judgeSubmission(
    task.testCases,
    task.points,
    resolved.judgeInput,
    { mode: task.comparisonMode, floatTolerance: task.floatTolerance },
    task.allowPartialCredit,
  );
  res.json({ verdict, compileStderr: resolved.compileStderr });
});

// Judges the same way as /run, but records the result as a PracticeSubmission
// (unlimited history — never overwrites a previous one, unlike the exam
// flow's immutable-per-attempt Submission).
// Submitted code is recorded regardless of language: for a server-exec task
// the body IS `{code}` (execution.ts's serverExecSchema); for a client-exec
// task the browser already ran the code and reports `{compileFailed,
// outcomes}`, so the frontend adds `code` alongside those fields just for
// this persistence step (execution.ts's schemas ignore the extra field).
const submitCodeSchema = z.object({ code: z.string() });

practiceRouter.post('/tasks/:taskId/submit', async (req, res) => {
  const userId = req.user!.id;
  const task = await loadPracticeTask(req.params.taskId, userId);
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const parsedCode = submitCodeSchema.safeParse(req.body);
  if (!parsedCode.success) {
    res.status(400).json({ error: 'code は必須です。' });
    return;
  }

  let resolved: ResolvedOutcomes;
  try {
    resolved = await resolveOutcomes(req.body, task, userId);
  } catch (err) {
    if (err instanceof RunRequestError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  const verdict = judgeSubmission(
    task.testCases,
    task.points,
    resolved.judgeInput,
    { mode: task.comparisonMode, floatTolerance: task.floatTolerance },
    task.allowPartialCredit,
  );

  const submission = await prisma.practiceSubmission.create({
    data: {
      taskId: task.id,
      studentId: userId,
      language: task.language,
      code: parsedCode.data.code,
      results: verdict.results as unknown as Prisma.InputJsonValue,
      overallStatus: verdict.overallStatus,
      score: verdict.score,
    },
  });

  res.status(201).json({
    verdict,
    compileStderr: resolved.compileStderr,
    submittedAt: submission.submittedAt,
  });
});

// The caller's own submission history for this task, most recent first.
practiceRouter.get('/tasks/:taskId/submissions', async (req, res) => {
  const userId = req.user!.id;
  const task = await loadPracticeTask(req.params.taskId, userId);
  if (!task) {
    res.status(404).json({ error: '問題が見つかりません。' });
    return;
  }

  const submissions = await prisma.practiceSubmission.findMany({
    where: { taskId: task.id, studentId: userId },
    orderBy: { submittedAt: 'desc' },
  });

  res.json({
    submissions: submissions.map((s) => ({
      id: s.id,
      language: s.language,
      code: s.code,
      results: s.results,
      overallStatus: s.overallStatus,
      score: s.score,
      submittedAt: s.submittedAt,
    })),
  });
});
