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
  it('flags a task with no test cases / no sample / 0 points', async () => {
    const { client: teacher } = await signupTeacher();
    const exam = await createExam(teacher, {
      publish: false,
      tasks: [{ title: 'OK' }, { title: '空', points: 0, cases: [['1', '1', false]] }],
    });
    const res = await teacher.get(`/api/exams/${exam.examId}/publish-check`);
    expect(res.status).toBe(200);
    const messages: string[] = res.body.issues.map((i: { message: string }) => i.message);
    expect(messages.some((m) => m.includes('空'))).toBe(true);
    expect(messages.some((m) => m.includes('OK'))).toBe(false);
  });
});

describe('statement image upload', () => {
  const PNG = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const form = (bytes: Uint8Array, type: string, name = 'a.png') => {
    const f = new FormData();
    f.append('file', new Blob([bytes], { type }), name);
    return f;
  };

  it('stores an image under a server-chosen name and serves it back byte-identical', async () => {
    const { client: teacher } = await signupTeacher();
    const res = await teacher.upload('/api/uploads', form(PNG, 'image/png', '../../evil.php'));
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    const served = await fetch(getBaseUrl() + res.body.url);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
  });

  it('rejects non-images, oversized files, a missing file, and non-teachers', async () => {
    const { client: teacher } = await signupTeacher();
    expect((await teacher.upload('/api/uploads', form(PNG, 'text/plain', 'a.txt'))).status).toBe(400);
    expect((await teacher.upload('/api/uploads', form(new Uint8Array(5 * 1024 * 1024 + 1), 'image/png'))).status).toBe(400);
    expect((await teacher.upload('/api/uploads', new FormData())).status).toBe(400);
    const { client: student } = await signup('s001');
    expect((await student.upload('/api/uploads', form(PNG, 'image/png'))).status).toBe(403);
  });
});
