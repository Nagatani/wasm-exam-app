import { prisma } from './prisma';

// Teacher-facing overview of a PRACTICE-mode exam ("演習の状況"). Practice has
// no attempts and unlimited resubmission (PracticeSubmission is append-only),
// so instead of a grade this reports activity: per task how many students
// tried / solved it, and per student per task their submission count, best
// score, whether they ever got AC, and when they last submitted.

export interface PracticeTaskStats {
  id: string;
  title: string;
  order: number;
  points: number;
  submissionCount: number;
  submitterCount: number;
  solvedCount: number; // students with at least one AC
}

export interface PracticeStudentTaskCell {
  taskId: string;
  submissionCount: number;
  solved: boolean;
  bestScore: number | null; // null = never submitted
  lastStatus: string | null;
  lastSubmittedAt: Date | null;
}

export interface PracticeStudentRow {
  id: string;
  studentNumber: string;
  displayName: string;
  tasks: PracticeStudentTaskCell[];
  solvedCount: number;
  submissionCount: number;
  lastSubmittedAt: Date | null;
}

export interface PracticeStats {
  exam: { id: string; title: string; courseId: string | null };
  tasks: PracticeTaskStats[];
  students: PracticeStudentRow[];
}

export type PracticeStatsResult =
  | { ok: true; stats: PracticeStats }
  | { ok: false; reason: 'not_found' | 'not_practice' };

export async function getPracticeStats(examId: string): Promise<PracticeStatsResult> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      tasks: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true, points: true } },
    },
  });
  if (!exam) return { ok: false, reason: 'not_found' };
  if (exam.mode !== 'PRACTICE') return { ok: false, reason: 'not_practice' };

  // Same audience rule as the exam grade dashboard (getExamResults).
  const audience = exam.courseId
    ? (
        await prisma.enrollment.findMany({
          where: { courseId: exam.courseId },
          include: { user: true },
          orderBy: { user: { studentNumber: 'asc' } },
        })
      ).map((e) => e.user)
    : await prisma.user.findMany({ where: { role: 'STUDENT' }, orderBy: { studentNumber: 'asc' } });

  const taskIds = exam.tasks.map((t) => t.id);
  const submissions = taskIds.length
    ? await prisma.practiceSubmission.findMany({
        where: { taskId: { in: taskIds } },
        select: { taskId: true, studentId: true, overallStatus: true, score: true, submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      })
    : [];

  // (studentId, taskId) → running aggregate; submissions are in time order, so
  // the last one seen is the latest.
  const cells = new Map<string, PracticeStudentTaskCell>();
  const key = (studentId: string, taskId: string) => `${studentId}:${taskId}`;
  for (const s of submissions) {
    const k = key(s.studentId, s.taskId);
    const cell = cells.get(k) ?? {
      taskId: s.taskId,
      submissionCount: 0,
      solved: false,
      bestScore: null,
      lastStatus: null,
      lastSubmittedAt: null,
    };
    cell.submissionCount += 1;
    cell.solved ||= s.overallStatus === 'AC';
    cell.bestScore = Math.max(cell.bestScore ?? 0, s.score);
    cell.lastStatus = s.overallStatus;
    cell.lastSubmittedAt = s.submittedAt;
    cells.set(k, cell);
  }

  const tasks: PracticeTaskStats[] = exam.tasks.map((t) => {
    const forTask = [...cells.values()].filter((c) => c.taskId === t.id);
    return {
      ...t,
      submissionCount: forTask.reduce((n, c) => n + c.submissionCount, 0),
      submitterCount: forTask.length,
      solvedCount: forTask.filter((c) => c.solved).length,
    };
  });

  const students: PracticeStudentRow[] = audience.map((u) => {
    const row = exam.tasks.map(
      (t) =>
        cells.get(key(u.id, t.id)) ?? {
          taskId: t.id,
          submissionCount: 0,
          solved: false,
          bestScore: null,
          lastStatus: null,
          lastSubmittedAt: null,
        },
    );
    const last = row
      .map((c) => c.lastSubmittedAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: u.id,
      studentNumber: u.studentNumber,
      displayName: u.displayName,
      tasks: row,
      solvedCount: row.filter((c) => c.solved).length,
      submissionCount: row.reduce((n, c) => n + c.submissionCount, 0),
      lastSubmittedAt: last ?? null,
    };
  });

  return { ok: true, stats: { exam: { id: exam.id, title: exam.title, courseId: exam.courseId }, tasks, students } };
}
