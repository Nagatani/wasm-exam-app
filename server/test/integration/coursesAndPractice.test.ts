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
} from './helpers';

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

describe('course (roster) scoping', () => {
  async function setup() {
    const { client: teacher } = await signupTeacher();
    const { client: enrolled, userId: enrolledId } = await signup('s001');
    const { client: outsider } = await signup('s002');
    const course = await teacher.post('/api/courses', { name: '演習A' });
    expect(course.status).toBe(201);
    const courseId: string = course.body.course.id;
    const enroll = await teacher.post(`/api/courses/${courseId}/enrollments`, {
      studentNumbers: ['s001', 'nobody', 'teacher01'],
    });
    expect(enroll.status).toBe(201);
    // A teacher's number isn't a STUDENT, so it's reported as not found.
    expect(enroll.body).toMatchObject({ added: 1, notFound: ['nobody', 'teacher01'] });

    const scoped = await createExam(teacher, { title: 'クラス限定', courseId });
    const open = await createExam(teacher, { title: '全員向け' });
    return { teacher, enrolled, enrolledId, outsider, courseId, scoped, open };
  }

  it('an enrolled student sees both exams, an outsider only the unscoped one', async () => {
    const { enrolled, outsider } = await setup();
    const titles = async (c: typeof enrolled) =>
      (await c.get('/api/student/exams')).body.exams.map((e: { title: string }) => e.title).sort();
    expect(await titles(enrolled)).toEqual(['クラス限定', '全員向け']);
    expect(await titles(outsider)).toEqual(['全員向け']);
  });

  it('an outsider gets 404 on every read/start of a course-scoped exam', async () => {
    const { outsider, scoped } = await setup();
    expect((await outsider.get(`/api/student/exams/${scoped.examId}`)).status).toBe(404);
    expect((await outsider.post(`/api/student/exams/${scoped.examId}/attempts`)).status).toBe(404);
    expect((await outsider.get(`/api/student/tasks/${scoped.tasks[0].id}`)).status).toBe(404);
  });

  it('the results dashboard of a course-scoped exam lists only enrollees', async () => {
    const { teacher, scoped, open } = await setup();
    const scopedRows = (await teacher.get(`/api/exams/${scoped.examId}/results`)).body.students;
    expect(scopedRows.map((s: { studentNumber: string }) => s.studentNumber)).toEqual(['s001']);
    const openRows = (await teacher.get(`/api/exams/${open.examId}/results`)).body.students;
    expect(openRows.map((s: { studentNumber: string }) => s.studentNumber).sort()).toEqual(['s001', 's002']);
  });

  it('unenrolling removes access', async () => {
    const { teacher, enrolled, enrolledId, courseId, scoped } = await setup();
    expect((await teacher.delete(`/api/courses/${courseId}/enrollments/${enrolledId}`)).status).toBe(204);
    expect((await enrolled.get(`/api/student/exams/${scoped.examId}`)).status).toBe(404);
  });
});

describe('bulk student provisioning', () => {
  it('creates accounts with a one-time initial password and forces a change', async () => {
    const { client: teacher } = await signupTeacher();
    await signup('s001'); // already exists → skipped
    const res = await teacher.post('/api/students/bulk', {
      students: [
        { studentNumber: 's001', displayName: '既存' },
        { studentNumber: 's100', displayName: '新規 太郎' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.text).toContain('s100');
    const created = await prisma.user.findUniqueOrThrow({ where: { studentNumber: 's100' } });
    expect(created).toMatchObject({ role: 'STUDENT', mustChangePassword: true, displayName: '新規 太郎' });
    expect(created.initialPassword).toBeTruthy();
    const existing = await prisma.user.findUniqueOrThrow({ where: { studentNumber: 's001' } });
    expect(existing.mustChangePassword).toBe(false);

    const { Client } = await import('./helpers');
    const c = new Client();
    const login = await c.post('/api/auth/login', { studentNumber: 's100', password: created.initialPassword });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });
});

describe('practice mode', () => {
  async function setup() {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId: studentId } = await signup('s001');
    const practice = await createExam(teacher, { title: '演習セット', mode: 'PRACTICE' });
    const exam = await createExam(teacher, { title: '本試験' });
    return { teacher, student, studentId, practice, exam };
  }

  it('can be created without a time limit (EXAM mode still requires one)', async () => {
    const { client: teacher } = await signupTeacher();
    expect((await teacher.post('/api/exams', { title: 'p', mode: 'PRACTICE' })).status).toBe(201);
    expect((await teacher.post('/api/exams', { title: 'e', mode: 'EXAM' })).status).toBe(400);
  });

  it('never leaks into the timed-exam flow (regression: 2026-09-18 mode leak)', async () => {
    const { student, practice } = await setup();
    const examTitles = (await student.get('/api/student/exams')).body.exams.map((e: { title: string }) => e.title);
    expect(examTitles).toEqual(['本試験']);
    expect((await student.get(`/api/student/exams/${practice.examId}`)).status).toBe(404);
    expect((await student.post(`/api/student/exams/${practice.examId}/attempts`)).status).toBe(404);
    expect(await prisma.examAttempt.count()).toBe(0);
  });

  it('the practice list shows only practice sets, and exam tasks aren’t reachable through it', async () => {
    const { student, exam } = await setup();
    const list = (await student.get('/api/student/practice/exams')).body.exams;
    expect(list.map((e: { title: string }) => e.title)).toEqual(['演習セット']);
    expect((await student.get(`/api/student/practice/exams/${exam.examId}`)).status).toBe(404);
    expect((await student.get(`/api/student/practice/tasks/${exam.tasks[0].id}`)).status).toBe(404);
  });

  it('hides hidden expected output and exposes the AI hint settings', async () => {
    const { teacher, student } = await setup();
    const p = await createExam(teacher, {
      mode: 'PRACTICE',
      tasks: [{ cases: [['1', 'SAMPLE_OUT', true], ['2', 'HIDDEN_SECRET_OUT', false]] }],
    });
    await teacher.patch(`/api/tasks/${p.tasks[0].id}`, { aiHintEnabled: true, aiHintMaxStage: 2 });
    const res = await student.get(`/api/student/practice/tasks/${p.tasks[0].id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SAMPLE_OUT');
    expect(res.text).not.toContain('HIDDEN_SECRET_OUT');
    expect(res.body.task ?? res.body).toMatchObject({ aiHintEnabled: true, aiHintMaxStage: 2 });
  });

  it('run never persists; every submit is kept as history, newest first', async () => {
    const { student, practice } = await setup();
    const t = practice.tasks[0];
    const run = await student.post(`/api/student/practice/tasks/${t.id}/run`, {
      compileFailed: false,
      outcomes: outcomes(t.testCaseIds, 'x'),
    });
    expect(run.status).toBe(200);
    expect(await prisma.practiceSubmission.count()).toBe(0);

    const s1 = await student.post(`/api/student/practice/tasks/${t.id}/submit`, {
      code: 'first',
      compileFailed: false,
      outcomes: outcomes(t.testCaseIds, 'wrong'),
    });
    expect(s1.status).toBe(201);
    expect(s1.body.verdict.overallStatus).toBe('WA');
    const s2 = await student.post(`/api/student/practice/tasks/${t.id}/submit`, {
      code: 'second',
      compileFailed: false,
      outcomes: outcomes(t.testCaseIds, ['3', '30']),
    });
    expect(s2.body.verdict.overallStatus).toBe('AC');

    const history = (await student.get(`/api/student/practice/tasks/${t.id}/submissions`)).body.submissions;
    expect(history.map((h: { code: string }) => h.code)).toEqual(['second', 'first']);
    // Practice submissions never touch the exam flow's tables.
    expect(await prisma.submission.count()).toBe(0);
  });

  it('submit requires code', async () => {
    const { student, practice } = await setup();
    const t = practice.tasks[0];
    const res = await student.post(`/api/student/practice/tasks/${t.id}/submit`, {
      compileFailed: false,
      outcomes: outcomes(t.testCaseIds, 'x'),
    });
    expect(res.status).toBe(400);
  });

  it('a student only ever sees their own history', async () => {
    const { student, practice } = await setup();
    const { client: other } = await signup('s002');
    const t = practice.tasks[0];
    await student.post(`/api/student/practice/tasks/${t.id}/submit`, {
      code: 'mine',
      compileFailed: false,
      outcomes: outcomes(t.testCaseIds, 'x'),
    });
    expect((await other.get(`/api/student/practice/tasks/${t.id}/submissions`)).body.submissions).toEqual([]);
  });

  it('practice-stats aggregates submitters, solves and per-student history for the teacher', async () => {
    const { teacher, student, studentId, practice, exam } = await setup();
    const { client: other } = await signup('s002');
    await signup('s003'); // never submits
    const t = practice.tasks[0];
    const submit = (c: typeof student, stdout: string | string[], code: string) =>
      c.post(`/api/student/practice/tasks/${t.id}/submit`, {
        code,
        compileFailed: false,
        outcomes: outcomes(t.testCaseIds, stdout),
      });
    await submit(student, 'wrong', 'a1');
    await submit(student, ['3', '30'], 'a2'); // s001 solves on the 2nd try
    await submit(other, 'wrong', 'b1'); // s002 tries once, fails

    const stats = await teacher.get(`/api/exams/${practice.examId}/practice-stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.tasks[0]).toMatchObject({ submissionCount: 3, submitterCount: 2, solvedCount: 1 });
    const byNumber = Object.fromEntries(
      stats.body.students.map((r: { studentNumber: string }) => [r.studentNumber, r]),
    );
    expect(byNumber.s001).toMatchObject({ solvedCount: 1, submissionCount: 2 });
    expect(byNumber.s001.tasks[0]).toMatchObject({ solved: true, bestScore: 10, lastStatus: 'AC' });
    expect(byNumber.s002.tasks[0]).toMatchObject({ solved: false, submissionCount: 1, lastStatus: 'WA' });
    expect(byNumber.s003.tasks[0]).toMatchObject({ submissionCount: 0, bestScore: null, lastSubmittedAt: null });

    const history = await teacher.get(
      `/api/exams/${practice.examId}/practice-stats/students/${studentId}/tasks/${t.id}`,
    );
    expect(history.body.submissions.map((h: { code: string }) => h.code)).toEqual(['a2', 'a1']);

    // EXAM-mode exams have no practice stats; students can't read them.
    expect((await teacher.get(`/api/exams/${exam.examId}/practice-stats`)).status).toBe(400);
    expect((await student.get(`/api/exams/${practice.examId}/practice-stats`)).status).toBe(403);
    expect(
      (await teacher.get(`/api/exams/${practice.examId}/practice-stats/students/${studentId}/tasks/${exam.tasks[0].id}`)).status,
    ).toBe(404);
  });

  it('exam-flow draft routes don’t operate on practice tasks', async () => {
    const { student, practice } = await setup();
    expect((await student.put(`/api/student/tasks/${practice.tasks[0].id}/draft`, draftBody('x'))).status).toBe(409);
  });
});
