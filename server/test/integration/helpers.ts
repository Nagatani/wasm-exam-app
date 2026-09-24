import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { resetLoginRateLimit } from '../../src/lib/loginRateLimit';

export { prisma };

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: Server | null = null;
let baseUrl = '';

export function getBaseUrl(): string {
  return baseUrl;
}

export async function startServer(): Promise<void> {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

export async function stopServer(): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
  await prisma.$disconnect();
}

// Empties every application table (keeps the migrations table). Called
// before each test so tests never see each other's rows.
export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(`resetDb refused: DATABASE_URL does not point at a *_test database (${url}).`);
  }
  // In-memory login lockouts live in the same process as the app under test.
  resetLoginRateLimit();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------------------
// HTTP client with a per-user cookie jar
// ---------------------------------------------------------------------------

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

export class Client {
  private cookie = '';

  async request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const isForm = body instanceof FormData;
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        // FormData sets its own multipart content-type (with boundary).
        ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      // A cleared cookie (logout) comes back with an empty value.
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    // Decode by hand: res.text() silently strips a leading UTF-8 BOM, which
    // the CSV export deliberately sends (see server/src/lib/csv.ts).
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed as T, text, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T = any>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body ?? {});
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body ?? {});
  }
  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }
  upload<T = any>(path: string, form: FormData) {
    return this.request<T>('POST', path, form);
  }
}

export const PASSWORD = 'password123';

// Signs up a new account and returns a logged-in client. The very first
// signup on an empty database becomes TEACHER (server/src/routes/auth.ts),
// so call `signupTeacher()` first in a test that needs one.
export async function signup(studentNumber: string): Promise<{ client: Client; userId: string }> {
  const client = new Client();
  const res = await client.post('/api/auth/signup', { studentNumber, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${res.text}`);
  return { client, userId: res.body.user.id };
}

export async function signupTeacher(studentNumber = 'teacher01') {
  const r = await signup(studentNumber);
  const role = (await prisma.user.findUniqueOrThrow({ where: { id: r.userId } })).role;
  if (role !== 'TEACHER') throw new Error('signupTeacher must be the first signup in a test');
  return r;
}

// ---------------------------------------------------------------------------
// Fixtures built through the real teacher API
// ---------------------------------------------------------------------------

export interface TaskSpec {
  title?: string;
  points?: number;
  language?: 'C' | 'JAVA' | 'JS' | 'TS' | 'PYTHON';
  allowPartialCredit?: boolean;
  // [input, expectedOutput, isSample]
  cases?: Array<[string, string, boolean]>;
}

export const DEFAULT_CASES: Array<[string, string, boolean]> = [
  ['1 2', '3', true],
  ['10 20', '30', false],
];

export async function createExam(
  teacher: Client,
  opts: {
    title?: string;
    mode?: 'EXAM' | 'PRACTICE';
    timeLimitMinutes?: number | null;
    maxAttempts?: number | null;
    opensAt?: string | null;
    closesAt?: string | null;
    courseId?: string | null;
    publish?: boolean;
    tasks?: TaskSpec[];
  } = {},
): Promise<{ examId: string; tasks: Array<{ id: string; testCaseIds: string[] }> }> {
  const mode = opts.mode ?? 'EXAM';
  const created = await teacher.post('/api/exams', {
    title: opts.title ?? 'テスト試験',
    mode,
    timeLimitMinutes: mode === 'PRACTICE' ? null : (opts.timeLimitMinutes ?? 60),
    maxAttempts: opts.maxAttempts === undefined ? 1 : opts.maxAttempts,
    opensAt: opts.opensAt ?? null,
    closesAt: opts.closesAt ?? null,
    courseId: opts.courseId ?? null,
  });
  if (created.status !== 201) throw new Error(`create exam failed: ${created.status} ${created.text}`);
  const examId: string = created.body.exam.id;

  const tasks: Array<{ id: string; testCaseIds: string[] }> = [];
  const specs = opts.tasks ?? [{}];
  for (const [i, spec] of specs.entries()) {
    const t = await teacher.post(`/api/exams/${examId}/tasks`, {
      order: i,
      title: spec.title ?? `問題${i + 1}`,
      points: spec.points ?? 10,
      language: spec.language ?? 'JS',
    });
    if (t.status !== 201) throw new Error(`create task failed: ${t.status} ${t.text}`);
    const taskId: string = t.body.task.id;
    if (spec.allowPartialCredit) {
      await teacher.patch(`/api/tasks/${taskId}`, { allowPartialCredit: true });
    }
    const cases = spec.cases ?? DEFAULT_CASES;
    const bulk = await teacher.post(`/api/tasks/${taskId}/test-cases/bulk`, {
      cases: cases.map(([input, expectedOutput, isSample]) => ({ input, expectedOutput, isSample })),
    });
    if (bulk.status !== 201) throw new Error(`bulk test cases failed: ${bulk.status} ${bulk.text}`);
    tasks.push({ id: taskId, testCaseIds: bulk.body.testCases.map((tc: { id: string }) => tc.id) });
  }

  if (opts.publish ?? true) {
    const p = await teacher.patch(`/api/exams/${examId}`, { status: 'PUBLISHED' });
    if (p.status !== 200) throw new Error(`publish failed: ${p.status} ${p.text}`);
  }
  return { examId, tasks };
}

// A client-exec outcome list where every test case printed `stdout`
// (or the matching entry of an array).
export function outcomes(testCaseIds: string[], stdout: string | string[]) {
  return testCaseIds.map((id, i) => ({
    testCaseId: id,
    stage: 'success' as const,
    stdout: Array.isArray(stdout) ? stdout[i] : stdout,
  }));
}

export function draftBody(code: string) {
  return { code, keystrokeCount: 5, pasteCount: 0, pastedCharCount: 0, timeSpentSeconds: 30 };
}
