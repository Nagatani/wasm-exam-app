import { prisma } from './prisma';
import type { SubmissionStatus } from '@prisma/client';
import { maybeSettleAttempt } from './attempts';

export interface TaskColumn {
  id: string;
  title: string;
  order: number;
  points: number;
}

export interface StudentTaskCell {
  taskId: string;
  status: SubmissionStatus | null;
  score: number;
  submittedAt: Date | null;
  keystrokeCount: number | null;
  pasteCount: number | null;
  pastedCharCount: number | null;
  // Wall-clock seconds spent on this specific task's page before submitting
  // it, distinct from `elapsedSeconds` on the student row (which spans the
  // whole attempt from start to final submission).
  timeSpentSeconds: number | null;
}

export interface StudentResultRow {
  id: string;
  studentNumber: string;
  displayName: string;
  results: StudentTaskCell[];
  totalScore: number;
  lastSubmittedAt: Date | null;
  startedAt: Date | null;
  // Wall-clock time from the start of the graded attempt to its final
  // submission. null until the student has a submitted attempt.
  elapsedSeconds: number | null;
  // How many times this student has submitted this exam (finished attempts).
  attemptCount: number;
}

export interface ExamResults {
  exam: { id: string; title: string };
  tasks: TaskColumn[];
  students: StudentResultRow[];
}

// Shared by the JSON dashboard endpoint and the CSV export so the two never
// drift apart. Lists every STUDENT account (not just ones who attempted this
// exam). A student's grade is their **latest SUBMITTED attempt** — not their
// best — so this joins against that attempt's submissions only.
export async function getExamResults(examId: string): Promise<ExamResults | null> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      tasks: {
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true, points: true },
      },
    },
  });

  if (!exam) {
    return null;
  }

  const students = await prisma.user.findMany({
    where: { role: 'STUDENT' },
    orderBy: { studentNumber: 'asc' },
  });

  // Settle any attempt whose time is up but which was never submitted, so its
  // (auto-finalized) result shows here rather than as "未提出".
  const expired = await prisma.examAttempt.findMany({
    where: { examId, status: 'IN_PROGRESS' },
  });
  for (const a of expired) {
    try {
      await maybeSettleAttempt(a.id);
    } catch {
      /* skip — a transient judge failure shouldn't blank the dashboard */
    }
  }

  const attempts = await prisma.examAttempt.findMany({
    where: { examId, status: 'SUBMITTED' },
    orderBy: { attemptNumber: 'desc' },
  });

  const latestByStudent = new Map<string, (typeof attempts)[number]>();
  const countByStudent = new Map<string, number>();
  for (const a of attempts) {
    countByStudent.set(a.studentId, (countByStudent.get(a.studentId) ?? 0) + 1);
    if (!latestByStudent.has(a.studentId)) {
      latestByStudent.set(a.studentId, a); // first seen = highest attemptNumber
    }
  }

  const attemptIds = [...latestByStudent.values()].map((a) => a.id);
  const submissions = attemptIds.length
    ? await prisma.submission.findMany({ where: { attemptId: { in: attemptIds } } })
    : [];
  const submissionByStudentTask = new Map<string, (typeof submissions)[number]>();
  for (const s of submissions) {
    submissionByStudentTask.set(`${s.studentId}:${s.taskId}`, s);
  }

  const studentRows: StudentResultRow[] = students.map((student) => {
    const attempt = latestByStudent.get(student.id) ?? null;

    const results: StudentTaskCell[] = exam.tasks.map((task) => {
      const submission = submissionByStudentTask.get(`${student.id}:${task.id}`);
      return submission
        ? {
            taskId: task.id,
            status: submission.overallStatus,
            score: submission.score,
            submittedAt: submission.submittedAt,
            keystrokeCount: submission.keystrokeCount,
            pasteCount: submission.pasteCount,
            pastedCharCount: submission.pastedCharCount,
            timeSpentSeconds: submission.timeSpentSeconds,
          }
        : {
            taskId: task.id,
            status: null,
            score: 0,
            submittedAt: null,
            keystrokeCount: null,
            pasteCount: null,
            pastedCharCount: null,
            timeSpentSeconds: null,
          };
    });

    const totalScore =
      attempt?.score ?? results.reduce((sum, r) => sum + r.score, 0);
    const lastSubmittedAt = attempt?.submittedAt ?? null;
    const startedAt = attempt?.startedAt ?? null;
    const elapsedSeconds =
      startedAt && lastSubmittedAt
        ? Math.max(0, Math.round((lastSubmittedAt.getTime() - startedAt.getTime()) / 1000))
        : null;

    return {
      id: student.id,
      studentNumber: student.studentNumber,
      displayName: student.displayName,
      results,
      totalScore,
      lastSubmittedAt,
      startedAt,
      elapsedSeconds,
      attemptCount: countByStudent.get(student.id) ?? 0,
    };
  });

  return {
    exam: { id: exam.id, title: exam.title },
    tasks: exam.tasks,
    students: studentRows,
  };
}
