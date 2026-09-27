import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Server-side grading parity (runs only with E2E_JUDGE_URL, i.e. a judge):
// the same programs are run by the browser ("実行" preview) and by the judge
// (final submit), and must get the same verdicts and byte-identical output.
// The programs deliberately touch behaviour that differs between runtimes if
// they aren't matched: C type sizes (wasm32 vs native), JS output
// formatting of objects/floats, Python float/bigint/rounding.

test.skip(!process.env.E2E_JUDGE_URL, 'set E2E_JUDGE_URL (a running judge) to test server-side grading');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'password123';
const TITLE = 'E2E 判定一致テスト';

const CASES = [
  {
    language: 'C',
    title: 'C の型サイズ',
    code: '#include <stdio.h>\nint main(void) { long x = 2147483647; x = x + 1; printf("%zu %zu %ld\\n", sizeof(long), sizeof(void *), x); return 0; }\n',
    // wasm32: long is 4 bytes, so the addition wraps.
    expected: '4 4 -2147483648',
  },
  {
    language: 'JS',
    title: 'JS の出力形式',
    code: 'print({ a: 1, b: [1, 2] }, 1 / 3, 0.1 + 0.2, [1, "x"]);\n',
    expected: '{"a":1,"b":[1,2]} 0.3333333333333333 0.30000000000000004 [1,"x"]',
  },
  {
    language: 'PYTHON',
    title: 'Python の数値',
    code: 'print(1 / 3, 10 ** 20, round(2.5), round(3.5), 7 // -2)\n',
    expected: '0.3333333333333333 100000000000000000000 2 4 -4',
  },
] as const;

async function apiLogin(request: APIRequestContext, studentNumber: string) {
  const login = await request.post('/api/auth/login', { data: { studentNumber, password: PASSWORD } });
  if (!login.ok()) await request.post('/api/auth/signup', { data: { studentNumber, password: PASSWORD } });
}

async function setEditorCode(page: Page, code: string) {
  await page.waitForFunction(() => (window as any).monaco?.editor.getModels().length > 0);
  await expect
    .poll(async () => {
      await page.evaluate((c) => {
        const model = (window as any).monaco.editor.getModels()[0];
        if (model.getValue() !== c) model.setValue(c);
      }, code);
      await page.waitForTimeout(300);
      return page.evaluate(() => (window as any).monaco.editor.getModels()[0].getValue());
    })
    .toBe(code);
}

let examId = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  await apiLogin(request, 'teacher01'); // the first account on a fresh DB → teacher
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const { exam } = await post('/api/exams', { title: TITLE, mode: 'EXAM', timeLimitMinutes: 30, maxAttempts: 1 });
  examId = exam.id;
  for (const [i, c] of CASES.entries()) {
    const { task } = await post(`/api/exams/${exam.id}/tasks`, {
      order: i,
      title: c.title,
      statementMarkdown: '出力するだけの問題です。',
      points: 10,
      language: c.language,
    });
    await post(`/api/tasks/${task.id}/test-cases`, { input: '', expectedOutput: c.expected, isSample: true, order: 0 });
  }
  expect((await request.patch(`/api/exams/${exam.id}`, { data: { status: 'PUBLISHED' } })).ok()).toBeTruthy();
  await request.post('/api/auth/logout');
  await apiLogin(request, 'parity01');
  await request.dispose();
});

test('the browser preview and the judge agree on C / JS / Python', async ({ page }) => {
  test.setTimeout(600_000); // first clang (~106MB) + Pyodide downloads
  await page.goto('/login');
  await page.getByLabel('学籍番号').fill('parity01');
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await expect(page.getByRole('heading', { name: '生徒ダッシュボード' })).toBeVisible();

  // Start the exam directly (the dashboard's runtime gate would wait for
  // clang/Pyodide first; the task page downloads them on demand anyway).
  await page.evaluate(async (id) => {
    await fetch(`/api/student/exams/${id}/attempts`, { method: 'POST', credentials: 'include' });
  }, examId);
  const exam = await page.evaluate(async (id) => (await fetch(`/api/student/exams/${id}`)).json(), examId);

  for (const [i, c] of CASES.entries()) {
    await page.goto(`/student/exams/${examId}/tasks/${exam.exam.tasks[i].id}`);
    await setEditorCode(page, c.code);
    // Browser preview: must be AC with exactly the expected output.
    await page.getByRole('button', { name: /コンパイル＆テスト実行/ }).click();
    await expect(page.getByText('AC（全テストケース正解）')).toBeVisible({ timeout: 540_000 });
    await page.getByRole('button', { name: '下書き保存', exact: true }).click();
    await expect(page.getByText('● 保存しました')).toBeVisible();
  }

  // Final submit → graded on the judge in the background.
  await page.getByRole('button', { name: '試験を提出する' }).click();
  await page.getByRole('button', { name: '最終提出する' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '提出する' }).click();
  await expect(page.getByText('提出完了')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('合計: 30 / 30 点')).toBeVisible();
});

test('the judge’s stored output is byte-identical to the browser’s expected output', async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  await request.post('/api/auth/login', { data: { studentNumber: 'teacher01', password: PASSWORD } });
  const results = await (await request.get(`/api/exams/${examId}/results`)).json();
  const student = results.students.find((s: { studentNumber: string }) => s.studentNumber === 'parity01');
  const detail = await (await request.get(`/api/exams/${examId}/students/${student.id}/submission-detail`)).json();
  for (const [i, c] of CASES.entries()) {
    const t = detail.tasks[i];
    expect(t.overallStatus, c.title).toBe('AC');
    expect(t.results[0].actualOutput.trimEnd(), c.title).toBe(c.expected);
  }
  await request.dispose();
});
