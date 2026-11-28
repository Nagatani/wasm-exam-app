import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createExam,
  getBaseUrl,
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

// Two teachers: the first signup is TEACHER automatically, the second is
// promoted through the real admin route.
async function twoTeachers() {
  const { client: t1 } = await signupTeacher('teacher01');
  const { client: t2 } = await signup('teacher02');
  expect((await t1.post('/api/admin/promote-to-teacher', { targetStudentNumber: 'teacher02' })).status).toBe(200);
  return { t1, t2 };
}

async function tagTask(teacher: Client, taskId: string, tags: string[], isPublic: boolean) {
  const res = await teacher.patch(`/api/tasks/${taskId}`, { tags, isPublic });
  expect(res.status).toBe(200);
}

describe('task bank', () => {
  async function setup() {
    const { t1, t2 } = await twoTeachers();
    const e1 = await createExam(t1, {
      publish: false,
      tasks: [
        { title: '配列の合計', language: 'C' },
        { title: '文字列の反転', language: 'PYTHON' },
      ],
    });
    await tagTask(t1, e1.tasks[0].id, ['配列', 'ループ'], true);
    await tagTask(t1, e1.tasks[1].id, ['文字列'], false);
    const e2 = await createExam(t2, { publish: false, tasks: [{ title: '素数判定', language: 'JS' }] });
    await tagTask(t2, e2.tasks[0].id, ['ループ'], false);
    return { t1, t2, e1, e2 };
  }
  const titles = (res: { body: { tasks: { title: string }[] } }) => res.body.tasks.map((t) => t.title).sort();

  it('scope=all is the caller’s own tasks plus other teachers’ public ones', async () => {
    const { t1, t2 } = await setup();
    expect(titles(await t1.get('/api/task-bank'))).toEqual(['文字列の反転', '配列の合計'].sort());
    expect(titles(await t2.get('/api/task-bank'))).toEqual(['素数判定', '配列の合計'].sort());
  });

  it('scope=mine / scope=public', async () => {
    const { t2 } = await setup();
    expect(titles(await t2.get('/api/task-bank?scope=mine'))).toEqual(['素数判定']);
    expect(titles(await t2.get('/api/task-bank?scope=public'))).toEqual(['配列の合計']);
  });

  it('filters by title substring (case-insensitive), language and tags (match-any)', async () => {
    const { t1 } = await setup();
    expect(titles(await t1.get(`/api/task-bank?q=${encodeURIComponent('合計')}`))).toEqual(['配列の合計']);
    expect(titles(await t1.get('/api/task-bank?language=python'))).toEqual(['文字列の反転']);
    expect(titles(await t1.get(`/api/task-bank?tags=${encodeURIComponent('文字列,ループ')}`))).toEqual(
      ['文字列の反転', '配列の合計'].sort(),
    );
  });

  it('never returns statement, test cases or solutions — only summary rows', async () => {
    const { t2 } = await setup();
    const row = (await t2.get('/api/task-bank?scope=public')).body.tasks[0];
    expect(row).toMatchObject({ title: '配列の合計', mine: false, isPublic: true, testCaseCount: 2 });
    expect(row).not.toHaveProperty('testCases');
    expect(row).not.toHaveProperty('statementMarkdown');
    expect(row).not.toHaveProperty('solutions');
  });

  it('tag autocomplete only covers visible tasks', async () => {
    const { t2 } = await setup();
    // t1's private '文字列' tag must not leak to t2.
    expect((await t2.get('/api/task-bank/tags')).body.tags.sort()).toEqual(['ループ', '配列'].sort());
  });

  it('adding a bank result duplicates it (with test cases + solution) into the target exam', async () => {
    const { t1, t2, e1, e2 } = await setup();
    await t1.put(`/api/tasks/${e1.tasks[0].id}/solutions/c`, { code: 'int main(){}' });
    const res = await t2.post(`/api/tasks/${e1.tasks[0].id}/duplicate`, { examId: e2.examId });
    expect(res.status).toBe(201);
    expect(res.body.task).toMatchObject({
      examId: e2.examId,
      title: '配列の合計（コピー）',
      order: 1,
      tags: ['配列', 'ループ'],
    });
    expect(res.body.task.testCases).toHaveLength(2);
    expect(res.body.task.solutions).toEqual([expect.objectContaining({ language: 'C', code: 'int main(){}' })]);
    // The source is untouched.
    expect(await prisma.testCase.count({ where: { taskId: e1.tasks[0].id } })).toBe(2);
  });

  it('is teacher-only', async () => {
    await setup();
    const { client: student } = await signup('s001');
    expect((await student.get('/api/task-bank')).status).toBe(403);
  });
});

describe('export / import', () => {
  it('round-trips a task into another exam, always arriving private', async () => {
    const { client: teacher } = await signupTeacher();
    const src = await createExam(teacher, {
      publish: false,
      tasks: [{ title: '輸出元', language: 'PYTHON', points: 7, cases: [['1', '2', true], ['3', '4', false]] }],
    });
    const taskId = src.tasks[0].id;
    await teacher.patch(`/api/tasks/${taskId}`, {
      tags: ['共有'],
      isPublic: true,
      comparisonMode: 'FLOAT',
      floatTolerance: 0.01,
      allowPartialCredit: true,
      aiHintEnabled: true,
      aiHintMaxStage: 2,
    });
    await teacher.put(`/api/tasks/${taskId}/solutions/python`, { code: 'print(2)' });

    const exported = await teacher.get(`/api/tasks/${taskId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const file = JSON.parse(exported.text);
    expect(file.format).toBe('wasm-exam-task/v1');
    expect(file.tasks).toHaveLength(1);

    const dest = await createExam(teacher, { publish: false, tasks: [{ title: '既存' }] });
    const imported = await teacher.post(`/api/exams/${dest.examId}/tasks/import`, file);
    expect(imported.status).toBe(201);
    const t = imported.body.tasks[0];
    expect(t).toMatchObject({
      examId: dest.examId,
      order: 1,
      title: '輸出元',
      language: 'PYTHON',
      points: 7,
      comparisonMode: 'FLOAT',
      floatTolerance: 0.01,
      allowPartialCredit: true,
      aiHintEnabled: true,
      aiHintMaxStage: 2,
      tags: ['共有'],
      isPublic: false, // never inherits the source's public flag
    });
    expect(t.testCases.map((tc: { input: string; isSample: boolean }) => [tc.input, tc.isSample])).toEqual([
      ['1', true],
      ['3', false],
    ]);
    expect(t.solutions).toEqual([expect.objectContaining({ language: 'PYTHON', code: 'print(2)' })]);
  });

  it('rejects a malformed file and one with duplicate solution languages', async () => {
    const { client: teacher } = await signupTeacher();
    const dest = await createExam(teacher, { publish: false });
    expect((await teacher.post(`/api/exams/${dest.examId}/tasks/import`, { format: 'nope', tasks: [] })).status).toBe(400);

    const exported = JSON.parse((await teacher.get(`/api/tasks/${dest.tasks[0].id}/export`)).text);
    exported.tasks[0].solutions = [
      { language: 'JS', code: 'a' },
      { language: 'JS', code: 'b' },
    ];
    expect((await teacher.post(`/api/exams/${dest.examId}/tasks/import`, exported)).status).toBe(400);
    expect(await prisma.task.count({ where: { examId: dest.examId } })).toBe(1);
  });

  it('round-trips a full exam via export/import as DRAFT with private tasks and cleared schedule', async () => {
    const { client: teacher } = await signupTeacher();
    const src = await createExam(teacher, {
      title: '期末試験2026',
      maxAttempts: 2,
      opensAt: new Date(Date.now() + 3600_000).toISOString(),
      closesAt: new Date(Date.now() + 7200_000).toISOString(),
      tasks: [
        {
          title: '問題A',
          language: 'PYTHON',
          points: 40,
          cases: [
            ['1 2', '3', true],
            ['10 20', '30', false],
          ],
        },
        {
          title: '問題B',
          language: 'JS',
          points: 60,
          cases: [['hello', 'HELLO', true]],
        },
      ],
    });
    await teacher.patch(`/api/exams/${src.examId}`, {
      description: '全2問です。',
      defaultLanguage: 'PYTHON',
    });
    await teacher.patch(`/api/tasks/${src.tasks[0].id}`, {
      statementMarkdown: '![図](/uploads/sample-diagram.png)\n2数の和を求めよ。',
      tags: ['基礎', '算術'],
      isPublic: true,
      allowPartialCredit: true,
    });
    await teacher.put(`/api/tasks/${src.tasks[0].id}/solutions/python`, {
      code: 'print(sum(map(int, input().split())))',
    });
    await teacher.put(`/api/tasks/${src.tasks[1].id}/solutions/js`, {
      code: 'print(readline().toUpperCase());',
    });

    const exported = await teacher.get(`/api/exams/${src.examId}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const file = JSON.parse(exported.text);
    expect(file.format).toBe('wasm-exam/v1');
    expect(file.exam).toMatchObject({
      title: '期末試験2026',
      description: '全2問です。',
      mode: 'EXAM',
      timeLimitMinutes: 60,
      maxAttempts: 2,
      defaultLanguage: 'PYTHON',
    });
    expect(file.tasks).toHaveLength(2);

    const imported = await teacher.post('/api/exams/import', file);
    expect(imported.status).toBe(201);
    expect(imported.body.hasUploadReferences).toBe(true);
    expect(imported.body.exam).toMatchObject({
      title: '期末試験2026',
      status: 'DRAFT',
      taskCount: 2,
    });

    const newExam = await prisma.exam.findUniqueOrThrow({
      where: { id: imported.body.exam.id },
      include: {
        tasks: {
          orderBy: { order: 'asc' },
          include: { testCases: { orderBy: { order: 'asc' } }, solutions: true },
        },
      },
    });
    expect(newExam).toMatchObject({
      title: '期末試験2026',
      description: '全2問です。',
      mode: 'EXAM',
      status: 'DRAFT',
      timeLimitMinutes: 60,
      maxAttempts: 2,
      defaultLanguage: 'PYTHON',
      opensAt: null,
      closesAt: null,
      courseId: null,
    });
    expect(newExam.tasks).toHaveLength(2);
    expect(newExam.tasks[0]).toMatchObject({
      order: 0,
      title: '問題A',
      language: 'PYTHON',
      points: 40,
      tags: ['基礎', '算術'],
      isPublic: false,
      allowPartialCredit: true,
    });
    expect(newExam.tasks[0].testCases.map((tc) => [tc.input, tc.expectedOutput, tc.isSample])).toEqual([
      ['1 2', '3', true],
      ['10 20', '30', false],
    ]);
    expect(newExam.tasks[0].solutions).toEqual([
      expect.objectContaining({ language: 'PYTHON', code: 'print(sum(map(int, input().split())))' }),
    ]);
    expect(newExam.tasks[1].isPublic).toBe(false);
    expect(newExam.tasks[1].solutions).toEqual([
      expect.objectContaining({ language: 'JS', code: 'print(readline().toUpperCase());' }),
    ]);
  });

  it('rejects a malformed exam import file without creating an exam', async () => {
    const { client: teacher } = await signupTeacher();
    const before = await prisma.exam.count();
    expect((await teacher.post('/api/exams/import', { format: 'wrong', exam: {}, tasks: [] })).status).toBe(400);
    expect(await prisma.exam.count()).toBe(before);
  });
});

describe('exam duplication', () => {
  it('copies metadata + every task, but resets to DRAFT and clears the schedule', async () => {
    const { client: teacher } = await signupTeacher();
    const src = await createExam(teacher, {
      title: '中間試験',
      maxAttempts: 3,
      opensAt: new Date(Date.now() + 3600_000).toISOString(),
      closesAt: new Date(Date.now() + 7200_000).toISOString(),
      tasks: [{ title: 'Q1' }, { title: 'Q2' }],
    });
    const res = await teacher.post(`/api/exams/${src.examId}/duplicate`);
    expect(res.status).toBe(201);
    const copyId: string = res.body.exam.id;
    const copy = await prisma.exam.findUniqueOrThrow({
      where: { id: copyId },
      include: { tasks: { orderBy: { order: 'asc' }, include: { testCases: true } } },
    });
    expect(copy).toMatchObject({
      title: '中間試験（コピー）',
      status: 'DRAFT',
      maxAttempts: 3,
      timeLimitMinutes: 60,
      opensAt: null,
      closesAt: null,
    });
    expect(copy.tasks.map((t) => t.title)).toEqual(['Q1', 'Q2']);
    expect(copy.tasks.every((t) => t.testCases.length === 2)).toBe(true);
  });
});

describe('publish check', () => {
  it('flags a task with no test cases / no sample / 0 points and attaches taskId', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, {
      publish: false,
      tasks: [{ title: 'OK' }, { title: '空', points: 0, cases: [['1', '1', false]] }],
    });
    // Populate statementMarkdown + matching solution so 'OK' has no task-level issues.
    await teacher.patch(`/api/tasks/${exam.tasks[0].id}`, { statementMarkdown: '2数の和を出力せよ。' });
    await teacher.put(`/api/tasks/${exam.tasks[0].id}/solutions/js`, { code: 'print(3);' });

    const res = await teacher.get(`/api/exams/${exam.examId}/publish-check`);
    expect(res.status).toBe(200);
    const issues: Array<{ level: string; message: string; taskId?: string }> = res.body.issues;
    expect(issues.some((i) => i.message.includes('空') && i.taskId === exam.tasks[1].id)).toBe(true);
    expect(issues.some((i) => i.message.includes('OK'))).toBe(false);
  });

  it('warns on missing solution, empty statement, duplicate inputs, and errors on missing /uploads images', async () => {
    const { client: teacher } = await signupTeacher();
    const PNG = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const uploaded = await teacher.upload('/api/uploads', PNG, 'image/png');
    expect(uploaded.status).toBe(201);
    const existingUrl: string = uploaded.body.url;

    const exam = await createExam(teacher, {
      mode: 'PRACTICE',
      publish: false,
      tasks: [
        {
          title: '不備あり',
          language: 'PYTHON',
          cases: [
            ['1 2', '3', true],
            ['1 2', '3', false],
          ],
        },
        {
          title: '画像あり',
          language: 'JS',
          cases: [['1', '1', true]],
        },
      ],
    });
    const [badTask, imgTask] = exam.tasks;
    // Give badTask a solution in a *different* language (JS != PYTHON) so PYTHON is still missing.
    await teacher.put(`/api/tasks/${badTask.id}/solutions/js`, { code: 'print(1)' });
    // Give imgTask a valid statement with one existing image and one missing image, plus a JS solution.
    await teacher.patch(`/api/tasks/${imgTask.id}`, {
      statementMarkdown: `図1: ![](${existingUrl})\n図2: ![欠損](/uploads/nonexistent-file.png)\n図3: ![不正](/uploads/../secret.png)`,
    });
    await teacher.put(`/api/tasks/${imgTask.id}/solutions/js`, { code: 'print(1)' });

    const res = await teacher.get(`/api/exams/${exam.examId}/publish-check`);
    expect(res.status).toBe(200);
    const issues: Array<{ level: string; message: string; taskId?: string }> = res.body.issues;

    const badIssues = issues.filter((i) => i.taskId === badTask.id);
    expect(badIssues.some((i) => i.level === 'warn' && i.message.includes('問題文が空'))).toBe(true);
    expect(badIssues.some((i) => i.level === 'warn' && i.message.includes('解答例が登録されていません'))).toBe(true);
    expect(badIssues.some((i) => i.level === 'warn' && i.message.includes('入力が重複'))).toBe(true);

    const imgIssues = issues.filter((i) => i.taskId === imgTask.id);
    expect(imgIssues.some((i) => i.message.includes(existingUrl))).toBe(false);
    expect(imgIssues.some((i) => i.level === 'error' && i.message.includes('nonexistent-file.png'))).toBe(true);
    expect(imgIssues.some((i) => i.level === 'error' && i.message.includes('../secret.png'))).toBe(true);
  });

  it('warns once that browser-executed languages are not server-graded without a judge (EXAM only)', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, {
      publish: false,
      tasks: [{ language: 'C' }, { language: 'PYTHON' }, { language: 'PYTHON' }],
    });
    const issues: Array<{ level: string; message: string }> = (
      await teacher.get(`/api/exams/${exam.examId}/publish-check`)
    ).body.issues;
    const judgeWarnings = issues.filter((i) => i.message.includes('judge'));
    expect(judgeWarnings).toHaveLength(1);
    expect(judgeWarnings[0].level).toBe('warn');
    expect(judgeWarnings[0].message).toContain('C / Python');

    // Practice sets are graded in the browser by design — no warning.
    const practice = await createExam(teacher, { mode: 'PRACTICE', publish: false, tasks: [{ language: 'JS' }] });
    const practiceIssues: Array<{ message: string }> = (
      await teacher.get(`/api/exams/${practice.examId}/publish-check`)
    ).body.issues;
    expect(practiceIssues.some((i) => i.message.includes('judge'))).toBe(false);
  });
});

describe('verification bundle', () => {
  it('returns ordered tasks with test cases and matching-language solutionCode (teacher-only)', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, {
      publish: false,
      tasks: [
        { title: '問1', language: 'PYTHON', cases: [['1 2', '3', true], ['4 5', '9', false]] },
        { title: '問2', language: 'JS', cases: [['10', '20', true]] },
      ],
    });
    await teacher.put(`/api/tasks/${exam.tasks[0].id}/solutions/python`, { code: 'print(sum(map(int, input().split())))' });
    await teacher.put(`/api/tasks/${exam.tasks[0].id}/solutions/js`, { code: '// wrong language' });

    const res = await teacher.get(`/api/exams/${exam.examId}/verification-bundle`);
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);
    expect(res.body.tasks[0]).toMatchObject({
      id: exam.tasks[0].id,
      order: 0,
      title: '問1',
      language: 'PYTHON',
      comparisonMode: 'EXACT',
      solutionCode: 'print(sum(map(int, input().split())))',
    });
    expect(res.body.tasks[0].testCases).toHaveLength(2);
    expect(res.body.tasks[0].testCases[0]).toMatchObject({
      input: '1 2',
      expectedOutput: '3',
      isSample: true,
    });
    expect(res.body.tasks[1]).toMatchObject({
      id: exam.tasks[1].id,
      order: 1,
      title: '問2',
      language: 'JS',
      solutionCode: null,
    });

    // Non-teachers are rejected.
    const { client: student } = await signup('s001');
    expect((await student.get(`/api/exams/${exam.examId}/verification-bundle`)).status).toBe(403);
    // Unknown exam returns 404.
    expect((await teacher.get('/api/exams/nonexistent-id/verification-bundle')).status).toBe(404);
  });
});

describe('statement image upload', () => {
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  it('stores an image under a server-chosen name and serves it back byte-identical', async () => {
    const { client: teacher } = await signupTeacher();
    const res = await teacher.upload('/api/uploads', PNG, 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    const served = await fetch(getBaseUrl() + res.body.url);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('rejects non-images, oversized files, an empty body, and non-teachers', async () => {
    const { client: teacher } = await signupTeacher();
    expect((await teacher.upload('/api/uploads', PNG, 'text/plain')).status).toBe(400);
    expect((await teacher.upload('/api/uploads', new Uint8Array(5 * 1024 * 1024 + 1), 'image/png')).status).toBe(400);
    expect((await teacher.upload('/api/uploads', new Uint8Array(0), 'image/png')).status).toBe(400);
    expect((await teacher.upload('/api/uploads')).status).toBe(400);
    const { client: student } = await signup('s001');
    expect((await student.upload('/api/uploads', PNG, 'image/png')).status).toBe(403);
  });
});
