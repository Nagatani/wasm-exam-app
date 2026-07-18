import { prisma } from './prisma';
import type { SubmissionStatus } from '@prisma/client';

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
}

export interface StudentResultRow {
  id: string;
  studentNumber: string;
  displayName: string;
  results: StudentTaskCell[];
  totalScore: number;
  lastSubmittedAt: Date | null;
}

export interface ExamResults {
  exam: { id: string; title: string };
  tasks: TaskColumn[];
  students: StudentResultRow[];
}

// Shared by the JSON dashboard endpoint and the CSV export so the two never
// drift apart. Lists every STUDENT account (not just ones who attempted this
// exam) so a teacher can see who hasn't submitted anything at all.
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

  const submissions = await prisma.submission.findMany({
    where: { examId: exam.id },
    orderBy: { submittedAt: 'desc' },
  });

  const latestByStudentTask = new Map<string, (typeof submissions)[number]>();
  for (const submission of submissions) {
    const key = `${submission.studentId}:${submission.taskId}`;
    if (!latestByStudentTask.has(key)) {
      latestByStudentTask.set(key, submission);
    }
  }

  const studentRows: StudentResultRow[] = students.map((student) => {
    const results: StudentTaskCell[] = exam.tasks.map((task) => {
      const submission = latestByStudentTask.get(`${student.id}:${task.id}`);
      return submission
        ? {
            taskId: task.id,
            status: submission.overallStatus,
            score: submission.score,
            submittedAt: submission.submittedAt,
          }
        : { taskId: task.id, status: null, score: 0, submittedAt: null };
    });

    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const lastSubmittedAt = results.reduce<Date | null>((latest, r) => {
      if (!r.submittedAt) return latest;
      if (!latest || r.submittedAt > latest) return r.submittedAt;
      return latest;
    }, null);

    return {
      id: student.id,
      studentNumber: student.studentNumber,
      displayName: student.displayName,
      results,
      totalScore,
      lastSubmittedAt,
    };
  });

  return {
    exam: { id: exam.id, title: exam.title },
    tasks: exam.tasks,
    students: studentRows,
  };
}
