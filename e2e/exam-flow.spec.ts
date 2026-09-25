import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// End-to-end: a teacher-authored JavaScript exam taken by a student in a real
// browser — login, runtime gate, Monaco, in-browser Web Worker execution,
// server-side judging, draft save, final submit — then the teacher's results.
// JavaScript keeps it fast (no clang / Pyodide download).

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'password123';
const EXAM_TITLE = 'E2E 確認テスト';
const PRACTICE_TITLE = 'E2E 演習セット';
const SOLUTION = "const [a, b] = readline().split(' ').map(Number);\nprint(a + b);\n";

async function seed(request: APIRequestContext) {
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  // Fresh database: the first signup becomes the teacher.
  await post('/api/auth/signup', { studentNumber: 'teacher01', password: PASSWORD });
  const { exam } = await post('/api/exams', {
    title: EXAM_TITLE,
    mode: 'EXAM',
    timeLimitMinutes: 30,
    maxAttempts: 1,
  });
  const { task } = await post(`/api/exams/${exam.id}/tasks`, {
    order: 0,
    title: '2つの整数の和',
    statementMarkdown: '空白区切りの2つの整数を読み、その和を出力してください。',
    points: 10,
    language: 'JS',
  });
  await post(`/api/tasks/${task.id}/test-cases`, { input: '1 2', expectedOutput: '3', isSample: true, order: 0 });
  await post(`/api/tasks/${task.id}/test-cases`, { input: '10 20', expectedOutput: '30', isSample: false, order: 1 });
  const res = await request.patch(`/api/exams/${exam.id}`, { data: { status: 'PUBLISHED' } });
  expect(res.ok()).toBeTruthy();

  // A practice set with one task, for the practice-mode spec.
  const { exam: practice } = await post('/api/exams', { title: PRACTICE_TITLE, mode: 'PRACTICE' });
  const { task: pTask } = await post(`/api/exams/${practice.id}/tasks`, {
    order: 0,
    title: '和を求める（演習）',
    statementMarkdown: '空白区切りの2つの整数の和を出力してください。',
    points: 10,
    language: 'JS',
    starterCode: '// ここに書く\n',
  });
  await post(`/api/tasks/${pTask.id}/test-cases`, { input: '4 5', expectedOutput: '9', isSample: true, order: 0 });
  expect((await request.patch(`/api/exams/${practice.id}`, { data: { status: 'PUBLISHED' } })).ok()).toBeTruthy();
  // The student account (a separate cookie jar is used for the UI login).
  await request.post('/api/auth/logout');
  await post('/api/auth/signup', { studentNumber: 's001', password: PASSWORD });
  return { examId: exam.id as string, practiceId: practice.id as string };
}

async function login(page: Page, studentNumber: string) {
  await page.goto('/login');
  await page.getByLabel('学籍番号').fill(studentNumber);
  await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'ログイン' }).click();
}

let examId = '';
let practiceId = '';

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  ({ examId, practiceId } = await seed(request));
  await request.dispose();
});

test('a student takes the exam from login to final submit', async ({ page }) => {
  await login(page, 's001');
  await expect(page.getByRole('heading', { name: '生徒ダッシュボード' })).toBeVisible();

  const row = page.locator('li', { hasText: EXAM_TITLE });
  await row.getByRole('button', { name: '受験する' }).click();

  // Task page: put the answer into Monaco (typing into it directly is
  // unreliable because of auto-indent / auto-close — see CLAUDE.md).
  await expect(page.getByText('問題 1: 2つの整数の和')).toBeVisible();
  await page.waitForFunction(() => (window as any).monaco?.editor.getModels().length > 0);
  await page.evaluate((code) => (window as any).monaco.editor.getModels()[0].setValue(code), SOLUTION);

  await page.getByRole('button', { name: /コンパイル＆テスト実行/ }).click();
  await expect(page.getByText('AC（全テストケース正解）')).toBeVisible();

  await page.getByRole('button', { name: '下書き保存', exact: true }).click();
  await expect(page.getByText('● 保存しました')).toBeVisible();

  await page.getByRole('button', { name: '試験を提出する' }).click();
  await expect(page.getByRole('heading', { name: '提出前の確認' })).toBeVisible();
  await expect(page.getByText('保存済み')).toBeVisible();
  await page.getByRole('button', { name: '最終提出する' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '提出する' }).click();

  await expect(page.getByText('提出完了')).toBeVisible();
  await expect(page.getByText('合計: 10 / 10 点')).toBeVisible();
  // maxAttempts 1 → no retake offered.
  await expect(page.getByRole('button', { name: 'もう一度受験する' })).toHaveCount(0);
});

test('the teacher sees the graded result and the submitted code', async ({ page }) => {
  await login(page, 'teacher01');
  await expect(page.getByRole('heading', { name: '教師ダッシュボード' })).toBeVisible();
  await page.goto(`/teacher/exams/${examId}/results`);

  const row = page.locator('tr', { hasText: 's001' }).first();
  await expect(row).toContainText('10');
  await row.getByRole('button', { name: '設問別の詳細を開く' }).click();
  await page.getByRole('button', { name: '提出コードと結果を表示' }).click();
  await expect(page.getByText('readline().split')).toBeVisible();
  // Hidden test case is judged too (and visible to the teacher).
  await expect(page.getByText('1 回目の受験の提出')).toBeVisible();
});

test('practice mode: unsaved code survives a reload and can be restored, then submitted', async ({ page }) => {
  await login(page, 's001');
  await page.getByRole('link', { name: PRACTICE_TITLE }).click();
  await page.getByRole('link', { name: /和を求める（演習）/ }).click();

  await page.waitForFunction(() => (window as any).monaco?.editor.getModels().length > 0);
  await page.evaluate((code) => (window as any).monaco.editor.getModels()[0].setValue(code), SOLUTION);
  // The browser-local backup is written after a short debounce.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wasm-exam-backup:')).length))
    .toBe(1);

  page.on('dialog', (d) => d.accept()); // beforeunload "leave site?" prompt
  await page.reload();
  await expect(page.getByText('保存されていない編集内容が残っています')).toBeVisible();
  // Monaco loads asynchronously (from a CDN) — on a slow runner the banner
  // can appear before the editor exists.
  await page.waitForFunction(() => (window as any).monaco?.editor.getModels().length > 0);
  await page.getByRole('button', { name: '復元する' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).monaco.editor.getModels()[0].getValue()))
    .toBe(SOLUTION);

  await page.getByRole('button', { name: '提出する', exact: true }).click();
  await expect(page.getByText('AC（全テストケース正解）')).toBeVisible();
  // Submitted → the backup is no longer needed.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wasm-exam-backup:')).length))
    .toBe(0);
});

test('the teacher sees practice activity and the student’s submission history', async ({ page }) => {
  await login(page, 'teacher01');
  await expect(page.getByRole('heading', { name: '教師ダッシュボード' })).toBeVisible();
  await page.goto(`/teacher/exams/${practiceId}`);
  await page.getByRole('link', { name: '演習の状況を見る' }).click();

  await expect(page.getByRole('heading', { name: `演習の状況: ${PRACTICE_TITLE}` })).toBeVisible();
  // s001 solved the only task with one submission (previous spec).
  await expect(page.getByText('1 / 1 人（提出 1 回）')).toBeVisible();
  const row = page.locator('tr', { hasText: 's001' });
  await row.getByRole('button', { name: /✓ 1回/ }).click();
  const history = page.getByRole('region', { name: '提出履歴' });
  await expect(history).toContainText('s001');
  await expect(history).toContainText('AC');
  await expect(history.getByText('readline().split')).toBeVisible();
});
