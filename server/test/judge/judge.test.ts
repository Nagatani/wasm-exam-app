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
} from '../integration/helpers';
import { resetGradingQueue, resumePendingGrading, waitForGradingIdle } from '../../src/lib/grading';

// Real compile + run through the sandboxed judge container: Java for the
// preview/practice flow and check-solution, and — since 2026-09-26 — the
// server-side grading of every language (final submit / auto-finalize /
// regrade) with the browser's runtimes. Needs `docker compose up -d judge` —
// see test/judge/globalSetup.ts.

beforeAll(startServer);
afterAll(stopServer);
beforeEach(async () => {
  resetGradingQueue();
  await resetDb();
});

// Final submit → 202 GRADING → wait for the background grader → result.
async function submitAndGrade(student: Client, examId: string) {
  const res = await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] });
  expect(res.status).toBe(202);
  expect(res.body.attempt.status).toBe('GRADING');
  await waitForGradingIdle();
  const result = await student.get(`/api/student/exams/${examId}/result`);
  expect(result.body.grading).toBe(false);
  return result.body;
}

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
const JS_SUM = "const [a, b] = readline().split(' ').map(Number);\nprint(a + b);";
const TS_SUM = "const [a, b]: number[] = readline().split(' ').map(Number);\nconsole.log(a + b);";
const PY_SUM = 'a, b = map(int, input().split())\nprint(a + b)';

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

  it('reports each test case’s run time measured in the judge', async () => {
    const { student, tasks } = await javaSetup();
    const res = await student.post(`/api/student/tasks/${tasks[0].id}/run`, { code: JAVA_SUM });
    expect(res.body.verdict.overallStatus).toBe('AC');
    for (const r of res.body.verdict.results as { timeMs?: number }[]) {
      expect(r.timeMs).toEqual(expect.any(Number));
      expect(r.timeMs).toBeGreaterThan(0); // includes JVM startup
      expect(r.timeMs).toBeLessThan(15_000);
    }
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
    const result = await submitAndGrade(student, examId);
    expect(result.perTask.map((p: { status: string }) => p.status)).toEqual(['AC', 'WA']);
    expect(result.attempt.score).toBe(10);
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
    await waitForGradingIdle();
    const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { studentId } });
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

  it('runs against ad-hoc inputs (AI作問サポート draft) even with no saved test cases', async () => {
    const { teacher, tasks } = await javaSetup({ publish: false });
    await prisma.testCase.deleteMany();
    const url = `/api/tasks/${tasks[0].id}/check-solution`;
    expect((await teacher.post(url, { code: JAVA_SUM })).status).toBe(400); // no test cases, no inputs
    const res = await teacher.post(url, { code: JAVA_SUM, inputs: ['2 5', '100 -1'] });
    expect(res.status).toBe(200);
    expect(res.body.outcomes.map((o: { testCaseId: string; stdout: string }) => [o.testCaseId, o.stdout.trim()])).toEqual([
      ['0', '7'],
      ['1', '99'],
    ]);
    expect(await prisma.testCase.count()).toBe(0);
  });

  it('is refused for a browser-executed language', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, { publish: false, tasks: [{ language: 'PYTHON' }] });
    expect((await teacher.post(`/api/tasks/${exam.tasks[0].id}/check-solution`, { code: 'print(3)' })).status).toBe(400);
  });
});

describe('teacher: regrade', () => {
  for (const [language, code] of [
    ['C', C_SUM],
    ['JS', JS_SUM],
    ['TS', TS_SUM],
    ['PYTHON', PY_SUM],
    ['JAVA', JAVA_SUM],
  ] as const) {
    it(`${language}: a corrected test case is applied to existing submissions`, async () => {
      const { client: teacher } = await signupTeacher();
      const { client: student, userId: studentId } = await signup('s001');
      const { examId, tasks } = await createExam(teacher, { tasks: [{ language, points: 10 }] });
      const t = tasks[0];
      // Teacher typo: expected "31" instead of "30".
      await teacher.patch(`/api/test-cases/${t.testCaseIds[1]}`, { expectedOutput: '31' });
      await student.post(`/api/student/exams/${examId}/attempts`);
      await student.put(`/api/student/tasks/${t.id}/draft`, draftBody(code));
      await submitAndGrade(student, examId);
      expect((await prisma.submission.findFirstOrThrow({ where: { studentId } })).overallStatus).toBe('WA');

      await teacher.patch(`/api/test-cases/${t.testCaseIds[1]}`, { expectedOutput: '30' });
      const res = await teacher.post(`/api/tasks/${t.id}/regrade`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ regraded: 1, changed: 1, failed: 0 });
      expect(await prisma.submission.findFirstOrThrow({ where: { studentId } })).toMatchObject({
        overallStatus: 'AC',
        score: 10,
      });
      // The attempt total is recomputed too.
      expect((await prisma.examAttempt.findFirstOrThrow({ where: { studentId } })).score).toBe(10);
      // Regrading again with nothing changed reports no changes.
      expect((await teacher.post(`/api/tasks/${t.id}/regrade`)).body).toEqual({ regraded: 1, changed: 0, failed: 0 });
    });
  }
});

describe('server-side grading (all languages, browser-equal runtimes)', () => {
  it('grades every language from the saved drafts after a final submit', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, studentId } = await signup('s001').then((r) => ({ client: r.client, studentId: r.userId }));
    const { examId, tasks } = await createExam(teacher, {
      tasks: [
        { language: 'C', points: 10 },
        { language: 'JS', points: 10 },
        { language: 'TS', points: 10 },
        { language: 'PYTHON', points: 10 },
        { language: 'PYTHON', points: 7 }, // wrong answer
        { language: 'JS', points: 3 }, // never drafted → 未提出
      ],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    const drafts = [C_SUM, JS_SUM, TS_SUM, PY_SUM, 'print(0)'];
    for (const [i, code] of drafts.entries()) {
      await student.put(`/api/student/tasks/${tasks[i].id}/draft`, draftBody(code));
    }
    const before = Date.now();
    const submit = await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] });
    expect(submit.status).toBe(202);
    // Locked immediately (submit time = the click), result pending.
    const attempt = await prisma.examAttempt.findFirstOrThrow({ where: { studentId } });
    expect(attempt.status).toBe('GRADING');
    expect(attempt.submittedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const pending = (await student.get(`/api/student/exams/${examId}/result`)).body;
    if (pending.grading) expect(pending.canRetake).toBe(false);

    await waitForGradingIdle();
    const result = (await student.get(`/api/student/exams/${examId}/result`)).body;
    expect(result.perTask.map((p: { status: string | null }) => p.status)).toEqual(['AC', 'AC', 'AC', 'AC', 'WA', null]);
    expect(result.attempt.score).toBe(40);
    // The browser never reported anything; the teacher sees the judge's output.
    const subs = await prisma.submission.findMany({ where: { studentId } });
    expect(subs).toHaveLength(5);
  });

  it('C runs as wasm32-wasi like the browser (long and pointers are 4 bytes)', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student } = await signup('s001');
    const { examId, tasks } = await createExam(teacher, {
      tasks: [{ language: 'C', points: 10, cases: [['', '4 4 16', true]] }],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(
      `/api/student/tasks/${tasks[0].id}/draft`,
      draftBody('#include <stdio.h>\nint main(void){ printf("%zu %zu %zu\\n", sizeof(long), sizeof(void*), sizeof(long double)); return 0; }'),
    );
    const result = await submitAndGrade(student, examId);
    expect(result.perTask[0].status).toBe('AC');
  });

  it('uses the browser-equal limits and verdicts: TLE, RE, MLE', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId: studentId } = await signup('s001');
    const { examId, tasks } = await createExam(teacher, {
      tasks: [
        { language: 'JS', cases: [['', 'x', true]] },
        { language: 'PYTHON', cases: [['', 'x', true]] },
        { language: 'PYTHON', cases: [['', 'x', true]] },
        { language: 'C', cases: [['', 'x', true]] },
      ],
    });
    await student.post(`/api/student/exams/${examId}/attempts`);
    const drafts = ['for (;;) {}', 'raise ValueError("boom")', 'x = [0] * (10 ** 9)', '#include <stdlib.h>\nint main(void){ abort(); }'];
    for (const [i, code] of drafts.entries()) {
      await student.put(`/api/student/tasks/${tasks[i].id}/draft`, draftBody(code));
    }
    const result = await submitAndGrade(student, examId);
    // Per-test RE rolls into an overall WA (as in the browser flow).
    expect(result.perTask.map((p: { status: string }) => p.status)).toEqual(['TLE', 'WA', 'MLE', 'WA']);
    const subs = await prisma.submission.findMany({ where: { studentId }, include: { task: true } });
    const byOrder = new Map(subs.map((s) => [s.task.order, s.results as Array<{ status: string; timeMs?: number }>]));
    expect(byOrder.get(0)![0].status).toBe('TLE');
    expect(byOrder.get(0)![0].timeMs).toBeGreaterThanOrEqual(10_000); // the browser's 10s JS limit
    expect(byOrder.get(1)![0].status).toBe('RE');
    expect(byOrder.get(3)![0].status).toBe('RE');
  });

  it('an attempt left in GRADING (server restart) is picked up again on startup', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId: studentId } = await signup('s001');
    const { examId, tasks } = await createExam(teacher, { tasks: [{ language: 'JS', points: 10 }] });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody(JS_SUM));
    // Simulate a crash right after the submit locked the attempt.
    await prisma.examAttempt.updateMany({ where: { studentId }, data: { status: 'GRADING', submittedAt: new Date() } });
    expect(await resumePendingGrading()).toBe(1);
    await waitForGradingIdle();
    expect(await prisma.examAttempt.findFirstOrThrow({ where: { studentId } })).toMatchObject({
      status: 'SUBMITTED',
      score: 10,
    });
  });

  it('a new attempt can’t start while the previous one is grading, and 差し戻し mid-grading writes nothing', async () => {
    const { client: teacher } = await signupTeacher();
    const { client: student, userId: studentId } = await signup('s001');
    const { examId, tasks } = await createExam(teacher, { maxAttempts: null, tasks: [{ language: 'PYTHON' }] });
    await student.post(`/api/student/exams/${examId}/attempts`);
    await student.put(`/api/student/tasks/${tasks[0].id}/draft`, draftBody(PY_SUM));
    expect((await student.post(`/api/student/exams/${examId}/submit`, { tasks: [] })).status).toBe(202);
    const dash = (await student.get('/api/student/exams')).body.exams[0];
    if (dash.grading) {
      expect(dash.canStart).toBe(false);
      expect((await student.post(`/api/student/exams/${examId}/attempts`)).status).toBe(409);
    }
    await teacher.delete(`/api/exams/${examId}/students/${studentId}/results`);
    await waitForGradingIdle();
    expect(await prisma.examAttempt.count()).toBe(0);
    expect(await prisma.submission.count()).toBe(0);
  });
});

