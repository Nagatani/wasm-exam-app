import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExam,
  draftBody,
  outcomes,
  prisma,
  resetDb,
  signup,
  signupTeacher,
  startServer,
  stopServer,
  type Client,
} from './helpers';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

async function setup(opts: Parameters<typeof createExam>[1] = {}) {
  const { client: teacher } = await signupTeacher();
  const { client: student, userId: studentId } = await signup('s001');
  const exam = await createExam(teacher, opts);
  return { teacher, student, studentId, ...exam };
}

async function takeAndSubmit(
  student: Client,
  examId: string,
  tasks: Array<{ id: string; testCaseIds: string[] }>,
  stdout: string | string[],
) {
  const start = await student.post(`/api/student/exams/${examId}/attempts`);
  expect([200, 201]).toContain(start.status);
  for (const t of tasks) {
    expect((await student.put(`/api/student/tasks/${t.id}/draft`, draftBody('print(1)'))).status).toBe(200);
  }
  return student.post(`/api/student/exams/${examId}/submit`, {
    tasks: tasks.map((t) => ({ taskId: t.id, compileFailed: false, outcomes: outcomes(t.testCaseIds, stdout) })),
  });
}

describe('exam listing and visibility', () => {
  it('a DRAFT exam is invisible and 404s for students', async () => {
    const { student, examId, tasks } = await setup({ publish: false });
    expect((await student.get('/api/student/exams')).body.exams).toEqual([]);
    expect((await student.get(`/api/student/exams/${examId}`)).status).toBe(404);
    expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(404);
    expect((await student.get(`/api/student/tasks/${tasks[0].id}`)).status).toBe(404);
  });

  it('never sends a hidden test case’s expected output to the student', async () => {
    const { student, examId, tasks } = await setup({
      tasks: [{ cases: [['1 2', 'SAMPLE_OUT', true], ['3 4', 'HIDDEN_SECRET_OUT', false]] }],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    const res = await student.get(`/api/student/tasks/${tasks[0].id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SAMPLE_OUT');
    expect(res.text).not.toContain('HIDDEN_SECRET_OUT');
    // Every other student-facing read of the exam too.
    for (const path of [
      '/api/student/exams',
      `/api/student/exams/${examId}`,
      `/api/student/exams/${examId}/attempt`,
    ]) {
      expect((await student.get(path)).text, path).not.toContain('HIDDEN_SECRET_OUT');
    }
    const run = await student.post(`/api/student/tasks/${tasks[0].id}/run`, {
      compileFailed: false,
      outcomes: outcomes(tasks[0].testCaseIds, 'wrong'),
    });
    expect(run.status).toBe(200);
    expect(run.text).not.toContain('HIDDEN_SECRET_OUT');
  });
});

describe('attempt lifecycle', () => {
  it('starting is explicit and idempotent while in progress', async () => {
    const { student, studentId, examId } = await setup();
    expect(await prisma.examAttempt.count()).toBe(0);
    await student.get(`/api/student/exams/${examId}`); // viewing never creates one
    expect(await prisma.examAttempt.count()).toBe(0);

    const first = await student.post(`/api/student/exams/${examId}/attempts`);
    expect(first.status).toBe(201);
    expect(first.body.attempt.attemptNumber).toBe(1);
    const again = await student.post(`/api/student/exams/${examId}/attempts`);
    expect(again.status).toBe(200);
    expect(again.body.attempt.id).toBe(first.body.attempt.id);
    expect(await prisma.examAttempt.count({ where: { studentId } })).toBe(1);
  });

  it('draft save requires an in-progress attempt and is never graded', async () => {
    const { student, examId, tasks } = await setup();
    expect((await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('x'))).status).toBe(409);
    await student.post(`/api/student/exams/${examId}/attempts`);
    expect((await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('v1'))).status).toBe(200);
    expect((await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('v2'))).status).toBe(200);
    expect(await prisma.taskDraft.count()).toBe(1);
    expect((await prisma.taskDraft.findFirstOrThrow()).code).toBe('v2');
    expect(await prisma.submission.count()).toBe(0);
    const task = await student.get(`/api/student/tasks/${tasks[0].id}`);
    expect(task.body.draft.code).toBe('v2');
  });

  it('run is an ephemeral preview: server judges, nothing is persisted', async () => {
    const { student, tasks } = await setup();
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, {
      compileFailed: false,
      outcomes: outcomes(tasks[0].testCaseIds, ['3', '30']),
    });
    expect(res.status).toBe(200);
    expect(res.body.verdict.overallStatus).toBe('AC');
    expect(res.body.verdict.score).toBe(10);
    expect(await prisma.submission.count()).toBe(0);
  });

  it('final submit grades drafted tasks, skips undrafted ones, and locks the attempt', async () => {
    const { student, studentId, examId, tasks } = await setup({
      tasks: [{ points: 10 }, { points: 20 }, { points: 30 }],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('a'));
    await student.put(`/api/student/tasks/${tasks[1].id}/draft`, draftBody('b'));
    // tasks[2] never drafted → 未提出

    const res = await student.post(`/api/student/exams/${examId}/submit`, {
      tasks: [
        { taskId: tasks[0].id, compileFailed: false, outcomes: outcomes(tasks[0].testCaseIds, ['3', '30']) },
        { taskId: tasks[1].id, compileFailed: false, outcomes: outcomes(tasks[1].testCaseIds, ['3', '31']) },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.attempt.score).toBe(10);
    expect(res.body.perTask.map((p: { status: string }) => p.status)).toEqual(['AC', 'WA']);

    const subs = await prisma.submission.findMany({ where: { studentId }, orderBy: { score: 'desc' } });
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ taskId: tasks[0].id, overallStatus: 'AC', score: 10, code: 'a', keystrokeCount: 5 });
    const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { studentId } });
    expect(attempt.status).toBe('SUBMITTED');
    expect(attempt.score).toBe(10);

    // Double submit is rejected and doesn't write a second set.
    const again = await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] });
    expect(again.status).toBe(409);
    expect(await prisma.submission.count()).toBe(2);
    // Drafts are frozen too.
    expect((await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('late'))).status).toBe(409);
  });

  it('a drafted client-exec task without submitted results → 400, attempt stays open', async () => {
    const { student, examId, tasks } = await setup();
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('a'));
    expect((await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] })).status).toBe(400);
    expect((await prisma.examAttempt.findFirstOrThrow()).status).toBe('IN_PROGRESS');
  });

  it('the client can’t fake AC: a wrong stdout is WA whatever else it sends', async () => {
    const { student, examId, tasks } = await setup();
    const res = await student.post(`/api/student/exams/${examId}/attempts`).then(async () => {
      await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('a'));
      return student.post(`/api/student/exams/${examId}/submit`, {
        tasks: [
          {
            taskId: tasks[0].id,
            compileFailed: false,
            outcomes: outcomes(tasks[0].testCaseIds, 'nope').map((o) => ({ ...o, status: 'AC', score: 999 })),
            overallStatus: 'AC',
            score: 999,
          },
        ],
      });
    });
    expect(res.status).toBe(201);
    expect(res.body.attempt.score).toBe(0);
    expect(res.body.perTask[0].status).toBe('WA');
  });

  it('partial credit is applied at final submit', async () => {
    const { student, examId, tasks } = await setup({
      tasks: [
        {
          points: 10,
          allowPartialCredit: true,
          cases: [['a', '1', true], ['b', '2', false], ['c', '3', false], ['d', '4', false]],
        },
      ],
    });
    const res = await takeAndSubmit(student, examId, tasks, ['1', '2', '3', 'x']);
    expect(res.body.perTask[0]).toMatchObject({ status: 'WA', score: 8 });
    expect(res.body.attempt.score).toBe(8);
  });
});

describe('retakes', () => {
  it('maxAttempts=1 blocks a second attempt', async () => {
    const { student, examId, tasks } = await setup({ maxAttempts: 1 });
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(409);
    const list = await student.get('/api/student/exams');
    expect(list.body.exams[0]).toMatchObject({ attemptsUsed: 1, canStart: false, latestScore: 10 });
  });

  it('the grade is the LATEST submitted attempt, not the best', async () => {
    const { teacher, student, examId, tasks } = await setup({ maxAttempts: null });
    await takeAndSubmit(student, examId, tasks, ['3', '30']); // 10
    const second = await takeAndSubmit(student, examId, tasks, 'wrong'); // 0
    expect(second.body.attempt.score).toBe(0);

    const result = await student.get(`/api/student/exams/${examId}/result`);
    expect(result.body.attempt).toMatchObject({ attemptNumber: 2, score: 0 });
    expect(result.body.attemptsUsed).toBe(2);
    expect(result.body.canRetake).toBe(true);

    const dash = await teacher.get(`/api/exams/${examId}/results`);
    const row = dash.body.students.find((s: { studentNumber: string }) => s.studentNumber === 's001');
    expect(row).toMatchObject({ totalScore: 0, attemptCount: 2 });
  });

  it('hides the previous score on the dashboard while a retake is in progress', async () => {
    const { student, examId, tasks } = await setup({ maxAttempts: null });
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    expect((await student.get('/api/student/exams')).body.exams[0].latestScore).toBe(10);

    await student.post(`/api/student/exams/${examId}/attempts`);
    const during = (await student.get('/api/student/exams')).body.exams[0];
    expect(during.hasInProgress).toBe(true);
    expect(during.latestScore).toBeNull();
    // The exam view doesn't leak the prior evaluation either.
    expect((await student.get(`/api/student/exams/${examId}`)).text).not.toContain('"score"');
  });

  it('submission-detail shows the latest attempt by default and earlier ones on request', async () => {
    const { teacher, student, studentId, examId, tasks } = await setup({ maxAttempts: null });
    await takeAndSubmit(student, examId, tasks, ['3', '30']); // attempt 1: 10
    await takeAndSubmit(student, examId, tasks, 'wrong'); // attempt 2: 0
    await student.post(`/api/student/exams/${examId}/attempts`); // attempt 3: in progress
    const base = `/api/exams/${examId}/students/${studentId}/submission-detail`;

    const latest = await teacher.get(base);
    expect(latest.status).toBe(200);
    expect(latest.body).toMatchObject({ attemptNumber: 2, latestAttemptNumber: 2 });
    // Only SUBMITTED attempts are listed (the in-progress 3rd is not).
    expect(latest.body.attempts.map((a: { attemptNumber: number; score: number }) => [a.attemptNumber, a.score])).toEqual([
      [1, 10],
      [2, 0],
    ]);
    expect(latest.body.tasks[0].overallStatus).toBe('WA');

    const first = await teacher.get(`${base}?attempt=1`);
    expect(first.body).toMatchObject({ attemptNumber: 1, latestAttemptNumber: 2 });
    expect(first.body.tasks[0]).toMatchObject({ overallStatus: 'AC', submitted: true });
    expect(first.body.tasks[0].keystrokeCount).toEqual(expect.any(Number));

    expect((await teacher.get(`${base}?attempt=3`)).status).toBe(404); // in progress
    expect((await teacher.get(`${base}?attempt=9`)).status).toBe(404);
    expect((await student.get(base)).status).toBe(403);
  });

  it('a new attempt starts with no drafts (白紙開始)', async () => {
    const { student, examId, tasks } = await setup({ maxAttempts: null });
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    await student.post(`/api/student/exams/${examId}/attempts`);
    const task = await student.get(`/api/student/tasks/${tasks[0].id}`);
    expect(task.body.draft).toBeNull();
  });
});

describe('scheduling window', () => {
  it('before opensAt: visible but not startable', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { student, examId } = await setup({ opensAt: future });
    const row = (await student.get('/api/student/exams')).body.exams[0];
    expect(row).toMatchObject({ notYetOpen: true, canStart: false });
    expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(409);
  });

  it('after closesAt: no new attempt', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { student, examId } = await setup({ closesAt: past });
    expect((await student.get('/api/student/exams')).body.exams[0]).toMatchObject({ closed: true, canStart: false });
    expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(409);
  });

  it('the attempt deadline is clamped to closesAt', async () => {
    const closesAt = new Date(Date.now() + 10 * 60_000);
    const { student, examId } = await setup({ timeLimitMinutes: 60, closesAt: closesAt.toISOString() });
    const res = await student.post(`/api/student/exams/${examId}/attempts`);
    expect(new Date(res.body.attempt.deadline).getTime()).toBe(closesAt.getTime());
  });
});

describe('auto-finalize at the deadline (maybeSettleAttempt)', () => {
  async function expire(studentId: string, minutesAgo: number) {
    await prisma.examAttempt.updateMany({
      where: { studentId, status: 'IN_PROGRESS' },
      data: { startedAt: new Date(Date.now() - minutesAgo * 60_000) },
    });
  }

  it('an expired attempt is settled on the next read; client-exec drafts grade WA/0', async () => {
    const { student, studentId, examId, tasks } = await setup({
      timeLimitMinutes: 30,
      tasks: [{ points: 10 }, { points: 10 }],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('a'));
    await expire(studentId, 31);

    const review = await student.get(`/api/student/exams/${examId}/attempt`);
    expect(review.status).toBe(409);

    const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { studentId } });
    expect(attempt).toMatchObject({ status: 'SUBMITTED', score: 0 });
    const subs = await prisma.submission.findMany({ where: { studentId } });
    expect(subs).toHaveLength(1); // only the drafted task
    expect(subs[0]).toMatchObject({ taskId: tasks[0].id, overallStatus: 'WA', score: 0 });

    // The late client submit is refused rather than re-grading.
    expect((await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] })).status).toBe(409);
  });

  it('the teacher results view also settles expired attempts', async () => {
    const { teacher, student, studentId, examId, tasks } = await setup({ timeLimitMinutes: 30 });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody('a'));
    await expire(studentId, 31);
    const dash = await teacher.get(`/api/exams/${examId}/results`);
    const row = dash.body.students.find((s: { id: string }) => s.id === studentId);
    expect(row.attemptCount).toBe(1);
    expect(row.results[0].status).toBe('WA');
  });

  it('an unexpired attempt is left alone', async () => {
    const { student, studentId, examId } = await setup({ timeLimitMinutes: 30 });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await expire(studentId, 29);
    expect((await student.get(`/api/student/exams/${examId}/attempt`)).status).toBe(200);
    expect((await prisma.examAttempt.findFirstOrThrow()).status).toBe('IN_PROGRESS');
  });

  it('a per-student time extension pushes the deadline out', async () => {
    const { teacher, student, studentId, examId } = await setup({ timeLimitMinutes: 30 });
    const ext = await teacher.put(`/api/exams/${examId}/students/${studentId}/time-extension`, { extraMinutes: 15 });
    expect(ext.status).toBe(200);
    await student.post(`/api/student/exams/${examId}/attempts`);
    await expire(studentId, 40); // past 30, within 45
    expect((await student.get(`/api/student/exams/${examId}/attempt`)).status).toBe(200);
    await expire(studentId, 46);
    expect((await student.get(`/api/student/exams/${examId}/attempt`)).status).toBe(409);
  });
});

describe('差し戻し (teacher reset)', () => {
  it('wipes submissions, attempts and drafts so the student can start fresh', async () => {
    const { teacher, student, studentId, examId, tasks } = await setup({ maxAttempts: 1 });
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(409);

    const res = await teacher.delete(`/api/exams/${examId}/students/${studentId}/results`);
    expect(res.status).toBe(204);
    expect(await prisma.submission.count({ where: { studentId } })).toBe(0);
    expect(await prisma.examAttempt.count({ where: { studentId } })).toBe(0);
    expect(await prisma.taskDraft.count()).toBe(0);

    const restart = await student.post(`/api/student/exams/${examId}/attempts`);
    expect(restart.status).toBe(201);
    expect(restart.body.attempt.attemptNumber).toBe(1);
  });

  it('only affects the targeted student', async () => {
    const { teacher, student, studentId, examId, tasks } = await setup({ maxAttempts: 1 });
    const { client: other, userId: otherId } = await signup('s002');
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    await takeAndSubmit(other, examId, tasks, ['3', '30']);
    await teacher.delete(`/api/exams/${examId}/students/${studentId}/results`);
    expect(await prisma.examAttempt.count({ where: { studentId: otherId } })).toBe(1);
    expect(await prisma.submission.count({ where: { studentId: otherId } })).toBe(1);
  });

  it('is teacher-only', async () => {
    const { student, studentId, examId } = await setup();
    expect((await student.delete(`/api/exams/${examId}/students/${studentId}/results`)).status).toBe(403);
  });
});

describe('results export', () => {
  it('CSV has a UTF-8 BOM, the header row, and one row per student', async () => {
    const { teacher, student, examId, tasks } = await setup();
    await signup('s002'); // never takes it
    await takeAndSubmit(student, examId, tasks, ['3', '30']);
    const res = await teacher.get(`/api/exams/${examId}/results/csv`);
    expect(res.status).toBe(200);
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.slice(1).trim().split(/\r?\n/);
    expect(lines[0]).toContain('学籍番号');
    expect(lines[0]).toContain('合計点');
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.startsWith('s001'))).toContain('10');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
  });
});
