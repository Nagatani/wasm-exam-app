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
} from '../integration/helpers';

// Real compile + run through the sandboxed judge container (Java for the
// exam/practice flow and check-solution; Java + C for regrade). Needs
// `docker compose up -d judge` — see test/judge/globalSetup.ts.

beforeAll(startServer);
afterAll(stopServer);
beforeEach(resetDb);

const JAVA_SUM = `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner s = new Scanner(System.in);
    System.out.println(s.nextInt() + s.nextInt());
  }
}`;
// JEP 512 (compact source file + instance main) — the reason Java runs
// server-side with --enable-preview at all (see CLAUDE.md).
const JAVA_COMPACT_SUM = `void main() {
  var s = new java.util.Scanner(System.in);
  System.out.println(s.nextInt() + s.nextInt());
}`;
const JAVA_WRONG = JAVA_SUM.replace('s.nextInt() + s.nextInt()', 's.nextInt() - s.nextInt()');
const JAVA_BROKEN = 'public class Main { public static void main(String[] a) { int x = } }';
const JAVA_LOOP = 'public class Main { public static void main(String[] a) { while (true) {} } }';
const JAVA_THROWS = 'public class Main { public static void main(String[] a) { throw new RuntimeException("x"); } }';

const C_SUM = `#include <stdio.h>
int main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }`;

async function javaSetup(opts: Parameters<typeof createExam>[1] = {}) {
  const { client: teacher } = await signupTeacher();
  const { client: student, userId: studentId } = await signup('s001');
  const exam = await createExam(teacher, { ...opts, tasks: opts.tasks ?? [{ language: 'JAVA' }] });
  return { teacher, student, studentId, ...exam };
}

describe('Java: preview run', () => {
  it.each([
    ['classic Main', JAVA_SUM, 'AC'],
    ['compact source file (JEP 512)', JAVA_COMPACT_SUM, 'AC'],
    ['wrong answer', JAVA_WRONG, 'WA'],
    ['compile error', JAVA_BROKEN, 'CE'],
  ])('%s → %s', async (_name, code, expected) => {
    const { student, tasks } = await javaSetup();
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, { code });
    expect(res.status).toBe(200);
    expect(res.body.verdict.overallStatus).toBe(expected);
    if (expected === 'CE') expect(res.body.compileStderr).toContain('Main.java');
    expect(await prisma.submission.count()).toBe(0);
  });

  it('an infinite loop → TLE (per-test time limit honoured)', async () => {
    const { teacher, student, tasks } = await javaSetup();
    for (const id of tasks[0].testCaseIds) {
      await teacher.patch(`/api/test-cases/${id}`, { timeLimitMs: 500 });
    }
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, { code: JAVA_LOOP });
    expect(res.body.verdict.overallStatus).toBe('TLE');
  });

  it('an uncaught exception → per-test RE, overall WA', async () => {
    const { student, tasks } = await javaSetup();
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, { code: JAVA_THROWS });
    expect(res.body.verdict.overallStatus).toBe('WA');
    expect(res.body.verdict.results.map((r: { status: string }) => r.status)).toEqual(['RE', 'RE']);
  });

  it('a Java task rejects client-reported outcomes (the server runs the code itself)', async () => {
    const { student, tasks } = await javaSetup();
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, {
      compileFailed: false,
      outcomes: outcomes(tasks[0].testCaseIds, ['3', '30']),
    });
    expect(res.status).toBe(400);
  });
});

describe('Java: final submit and auto-finalize', () => {
  it('final submit compiles and runs the saved draft server-side', async () => {
    const { student, studentId, examId, tasks } = await javaSetup({
      tasks: [{ language: 'JAVA', points: 10 }, { language: 'JAVA', points: 5 }],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody(JAVA_SUM));
    await student.put(`/api/student/tasks/${tasks[1].id}/draft`, draftBody(JAVA_WRONG));
    const res = await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] });
    expect(res.status).toBe(201);
    expect(res.body.perTask.map((p: { status: string }) => p.status)).toEqual(['AC', 'WA']);
    expect(res.body.attempt.score).toBe(10);
    const subs = await prisma.submission.findMany({ where: { studentId }, orderBy: { score: 'desc' } });
    expect(subs.map((s) => [s.language, s.code === JAVA_SUM])).toEqual([
      ['JAVA', true],
      ['JAVA', false],
    ]);
  });

  it('an expired attempt with a Java draft is auto-finalized by actually running it', async () => {
    const { student, studentId, examId, tasks } = await javaSetup({ timeLimitMinutes: 30 });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody(JAVA_SUM));
    await prisma.examAttempt.updateMany({
      where: { studentId },
      data: { startedAt: new Date(Date.now() - 31 * 60_000) },
    });
    expect((await student.get(`/api/student/exams/${examId}/attempt`)).status).toBe(409);
    const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { studentId } });
    // Unlike a client-exec draft (WA/0), a Java draft gets its real verdict.
    expect(attempt).toMatchObject({ status: 'SUBMITTED', score: 10 });
  });
});

describe('Java: practice mode', () => {
  it('submit runs on the judge and is recorded in the history', async () => {
    const { student, tasks } = await javaSetup({ mode: 'PRACTICE' });
    const res = await student.post(`/api/student/practice/tasks/${tasks[0].id}/submit`, { code: JAVA_SUM });
    expect(res.status).toBe(201);
    expect(res.body.verdict.overallStatus).toBe('AC');
    const history = (await student.get(`/api/student/practice/tasks/${tasks[0].id}/submissions`)).body.submissions;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ overallStatus: 'AC', code: JAVA_SUM });
  });
});

describe('teacher: check-solution (Java)', () => {
  it('returns raw stdout per test case without persisting anything', async () => {
    const { teacher, tasks } = await javaSetup({ publish: false });
    const res = await teacher.post(`/api/tasks/${tasks[0].id}/check-solution`, { code: JAVA_SUM });
    expect(res.status).toBe(200);
    expect(res.body.compileFailed).toBe(false);
    expect(res.body.outcomes.map((o: { stage: string; stdout: string }) => [o.stage, o.stdout.trim()])).toEqual([
      ['success', '3'],
      ['success', '30'],
    ]);
    const broken = await teacher.post(`/api/tasks/${tasks[0].id}/check-solution`, { code: JAVA_BROKEN });
    expect(broken.body.compileFailed).toBe(true);
    expect(await prisma.submission.count()).toBe(0);
  });

  it('is refused for a browser-executed language', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, { publish: false, tasks: [{ language: 'PYTHON' }] });
    expect((await teacher.post(`/api/tasks/${exam.tasks[0].id}/check-solution`, { code: 'print(3)' })).status).toBe(400);
  });
});

describe('teacher: regrade', () => {
  it('C: re-runs the stored code with gcc and fixes a verdict the browser reported wrongly', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId: studentId } = await signup('s001');
    const { examId, tasks } = await createExam(teacher, { tasks: [{ language: 'C', points: 10 }] });
    const t = tasks[0];
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${t.id}/draft`, draftBody(C_SUM));
    // The browser's run reported the wrong output (e.g. a flaky client).
    await student.post(`/api/student/exams/${examId}/submit`, {
      tasks: [{ taskId: t.id, compileFailed: false, outcomes: outcomes(t.testCaseIds, 'garbage') }],
    });
    expect((await prisma.examAttempt.findFirstOrThrow({ where: { studentId } })).score).toBe(0);

    const res = await teacher.post(`/api/tasks/${t.id}/regrade`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ regraded: 1, changed: 1, failed: 0 });
    const sub = await prisma.submission.findFirstOrThrow({ where: { studentId } });
    expect(sub).toMatchObject({ overallStatus: 'AC', score: 10 });
    // The attempt total is recomputed too.
    expect((await prisma.examAttempt.findFirstOrThrow({ where: { studentId } })).score).toBe(10);
  });

  it('Java: a corrected test case is applied to existing submissions', async () => {
    const { teacher, student, studentId, examId, tasks } = await javaSetup();
    const t = tasks[0];
    // Teacher typo: expected "31" instead of "30".
    await teacher.patch(`/api/test-cases/${t.testCaseIds[1]}`, { expectedOutput: '31' });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${t.id}/draft`, draftBody(JAVA_SUM));
    await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] });
    expect((await prisma.submission.findFirstOrThrow({ where: { studentId } })).overallStatus).toBe('WA');

    await teacher.patch(`/api/test-cases/${t.testCaseIds[1]}`, { expectedOutput: '30' });
    const res = await teacher.post(`/api/tasks/${t.id}/regrade`);
    expect(res.body).toEqual({ regraded: 1, changed: 1, failed: 0 });
    expect(await prisma.submission.findFirstOrThrow({ where: { studentId } })).toMatchObject({
      overallStatus: 'AC',
      score: 10,
    });

    // Regrading again with nothing changed reports no changes.
    expect((await teacher.post(`/api/tasks/${t.id}/regrade`)).body).toEqual({ regraded: 1, changed: 0, failed: 0 });
  });

  it('is refused for JS/TS/Python', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, { publish: false, tasks: [{ language: 'JS' }] });
    expect((await teacher.post(`/api/tasks/${exam.tasks[0].id}/regrade`)).status).toBe(400);
  });
});
