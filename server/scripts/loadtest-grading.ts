// Load test for server-side grading under realistic classroom conditions:
//   - Concurrent student logins (LOGIN_CONCURRENCY, default = STUDENTS)
//   - Configurable TLE/CE/WA fault mix (LOADTEST_FAULT_RATIO, default = 0.1)
//   - Simultaneous final submit by N students
//   - Concurrent Java preview runs during the rush (PREVIEW_CONCURRENCY, default = 10)
//   - Concurrent teacher GET /results polling during grading
//   - p50 / p95 / p99 latency & error rate reporting
//
// Usage:
//   1. Start a server against a throwaway *_test DB with JUDGE_URL set, e.g.:
//        DATABASE_URL=postgresql://wasm_exam:wasm_exam@localhost:5433/wasm_exam_load_test \
//        npx tsx scripts/e2e-prepare-db.ts
//        PORT=4300 JUDGE_URL=http://localhost:4001 DATABASE_URL=... node dist/index.js
//   2. BASE_URL=http://localhost:4300 STUDENTS=100 LOADTEST_FAULT_RATIO=0.1 \
//      npx tsx scripts/loadtest-grading.ts
const BASE = process.env.BASE_URL ?? 'http://localhost:4300';
const STUDENTS = Math.max(1, Number(process.env.STUDENTS ?? 100));
const TESTS_PER_TASK = Math.max(1, Number(process.env.TESTS_PER_TASK ?? 5));
const LANGUAGES = (process.env.LANGUAGES ?? 'C,JS,TS,PYTHON,JAVA')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const FAULT_RATIO = Math.min(
  1,
  Math.max(0, Number.isFinite(Number(process.env.LOADTEST_FAULT_RATIO)) ? Number(process.env.LOADTEST_FAULT_RATIO) : 0.1),
);
const LOGIN_CONCURRENCY = Math.max(1, Number(process.env.LOGIN_CONCURRENCY ?? STUDENTS));
const PREVIEW_CONCURRENCY = Math.max(0, Number(process.env.PREVIEW_CONCURRENCY ?? 10));
const TEACHER_POLL_INTERVAL_MS = Math.max(0, Number(process.env.TEACHER_POLL_INTERVAL_MS ?? 2000));
const PASSWORD = 'loadtest-pass-1';

type FaultKind = 'AC' | 'WA' | 'CE' | 'TLE';

const CODE: Record<string, string> = {
  C: '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  JS: "const [a,b]=readline().split(' ').map(Number); print(a+b);",
  TS: "const [a,b]: number[]=readline().split(' ').map(Number); console.log(a+b);",
  PYTHON: 'a,b=map(int,input().split())\nprint(a+b)',
  JAVA: 'void main(){ var s=new java.util.Scanner(System.in); IO.println(s.nextInt()+s.nextInt()); }',
};

const FAULT_CODE: Record<Exclude<FaultKind, 'AC'>, Record<string, string>> = {
  WA: {
    C: '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b+1);return 0;}',
    JS: "const [a,b]=readline().split(' ').map(Number); print(a+b+1);",
    TS: "const [a,b]: number[]=readline().split(' ').map(Number); console.log(a+b+1);",
    PYTHON: 'a,b=map(int,input().split())\nprint(a+b+1)',
    JAVA: 'void main(){ var s=new java.util.Scanner(System.in); IO.println(s.nextInt()+s.nextInt()+1); }',
  },
  CE: {
    C: 'int main(void){ syntax error here }',
    JS: 'const a = (;',
    TS: 'const a: number = (;',
    PYTHON: 'def broken(:\n  pass',
    JAVA: 'void main(){ syntax error here }',
  },
  TLE: {
    C: 'int main(void){ while(1){} return 0; }',
    JS: 'while(true){}',
    TS: 'while(true){}',
    PYTHON: 'while True:\n  pass',
    JAVA: 'void main(){ while(true){} }',
  },
};

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed as Record<string, unknown> | null };
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function formatLatencySummary(label: string, samples: number[], errors: number, unit: 'ms' | 's' = 'ms'): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.length + errors;
  const errPct = total > 0 ? ((errors / total) * 100).toFixed(1) : '0.0';
  const fmt = (v: number) => (unit === 's' ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);
  if (sorted.length === 0) {
    return `${label}: no successful samples (errors: ${errors}/${total}, ${errPct}%)`;
  }
  return (
    `${label}: p50 ${fmt(pct(sorted, 50))} / p95 ${fmt(pct(sorted, 95))} / p99 ${fmt(pct(sorted, 99))} / max ${fmt(sorted.at(-1)!)}` +
    ` (n=${sorted.length}, errors=${errors}/${total} [${errPct}%])`
  );
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function faultForStudent(index: number, faultCount: number): FaultKind {
  if (index >= faultCount) return 'AC';
  const kinds: Array<Exclude<FaultKind, 'AC'>> = ['WA', 'CE', 'TLE'];
  return kinds[index % kinds.length];
}

async function main() {
  const teacher = new Client();
  const t = await teacher.req('POST', '/api/auth/signup', { studentNumber: 'teacher01', password: PASSWORD });
  if (t.status !== 201) {
    const l = await teacher.req('POST', '/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD });
    if (l.status !== 200) throw new Error(`teacher login failed: ${l.status}`);
  }

  const { body: examBody } = await teacher.req('POST', '/api/exams', {
    title: `負荷試験 ${new Date().toISOString()}`,
    mode: 'EXAM',
    timeLimitMinutes: 60,
    maxAttempts: 1,
  });
  const examObj = examBody?.exam as { id: string } | undefined;
  if (!examObj?.id) throw new Error('failed to create exam');
  const examId = examObj.id;
  const taskIds: Array<{ id: string; language: string }> = [];
  for (const [i, language] of LANGUAGES.entries()) {
    const { body } = await teacher.req('POST', `/api/exams/${examId}/tasks`, {
      order: i,
      title: `${language} の和`,
      statementMarkdown: 'x',
      points: 10,
      language,
    });
    const taskObj = body?.task as { id: string } | undefined;
    if (!taskObj?.id) throw new Error(`failed to create task for ${language}`);
    const taskId = taskObj.id;
    const cases = Array.from({ length: TESTS_PER_TASK }, (_, k) => ({
      input: `${k} ${k * 3}`,
      expectedOutput: String(k * 4),
      isSample: k === 0,
    }));
    await teacher.req('POST', `/api/tasks/${taskId}/test-cases/bulk`, { cases });
    taskIds.push({ id: taskId, language });
  }
  await teacher.req('PATCH', `/api/exams/${examId}`, { status: 'PUBLISHED' });

  const javaTask = taskIds.find((t) => t.language === 'JAVA');
  const previewCount = javaTask ? PREVIEW_CONCURRENCY : 0;
  const totalUsers = STUDENTS + previewCount;

  const roster = Array.from({ length: totalUsers }, (_, i) => ({
    studentNumber: `lt${String(i).padStart(4, '0')}`,
    displayName: `負荷${i}`,
  }));
  const bulk = await teacher.req('POST', '/api/students/bulk', { students: roster });
  const created = (bulk.body?.created ?? []) as Array<{ studentNumber: string; initialPassword: string }>;
  const passwords = new Map<string, string>(created.map((c) => [c.studentNumber, c.initialPassword]));

  // Phase 1: Concurrent login rush (measured).
  const loginLatencies: number[] = [];
  let loginErrors = 0;
  const loggedInClients = await mapConcurrent(roster, LOGIN_CONCURRENCY, async (r) => {
    const c = new Client();
    const pw = passwords.get(r.studentNumber);
    if (!pw) throw new Error(`no initial password for ${r.studentNumber} (reuse a fresh DB)`);
    const s = performance.now();
    const login = await c.req('POST', '/api/auth/login', { studentNumber: r.studentNumber, password: pw });
    if (login.status !== 200) {
      loginErrors += 1;
      throw new Error(`login ${r.studentNumber}: ${login.status}`);
    }
    loginLatencies.push(performance.now() - s);
    return c;
  });

  // Setup attempts and drafts (with configured fault mix on the first task).
  const faultCount = Math.round(STUDENTS * FAULT_RATIO);
  const submitters: Array<{ client: Client; fault: FaultKind }> = [];
  for (let i = 0; i < STUDENTS; i++) {
    submitters.push({ client: loggedInClients[i], fault: faultForStudent(i, faultCount) });
  }
  const previewers = loggedInClients.slice(STUDENTS);

  await mapConcurrent(loggedInClients, 20, async (c, idx) => {
    const attemptRes = await c.req('POST', `/api/student/exams/${examId}/attempts`);
    if (attemptRes.status !== 200 && attemptRes.status !== 201) {
      throw new Error(`start attempt failed for idx=${idx}: ${attemptRes.status}`);
    }
    const fault: FaultKind = idx < STUDENTS ? faultForStudent(idx, faultCount) : 'AC';
    for (const [taskIdx, task] of taskIds.entries()) {
      const code =
        fault !== 'AC' && taskIdx === 0
          ? (FAULT_CODE[fault][task.language] ?? CODE[task.language])
          : CODE[task.language];
      const draftRes = await c.req('PUT', `/api/student/tasks/${task.id}/draft`, {
        code,
        keystrokeCount: 1,
        pasteCount: 0,
        pastedCharCount: 0,
        timeSpentSeconds: 1,
      });
      if (draftRes.status !== 200) {
        throw new Error(`draft save failed for idx=${idx}: ${draftRes.status}`);
      }
    }
  });

  console.log(
    `setup: ${STUDENTS} students (faults=${faultCount}, ratio=${(FAULT_RATIO * 100).toFixed(0)}%) × ` +
      `${taskIds.length} tasks (${LANGUAGES.join('/')}) × ${TESTS_PER_TASK} tests, ` +
      `javaPreviews=${previewCount}, loginConcurrency=${LOGIN_CONCURRENCY}`,
  );
  console.log(formatLatencySummary('login rush', loginLatencies, loginErrors, 'ms'));

  // Phase 2: Simultaneous final submit + concurrent Java previews + concurrent teacher results polling.
  const t0 = performance.now();
  const submitLatencies: number[] = [];
  let submitErrors = 0;

  let gradingFinished = false;
  const teacherLatencies: number[] = [];
  let teacherErrors = 0;
  const teacherPoller =
    TEACHER_POLL_INTERVAL_MS > 0
      ? (async () => {
          while (!gradingFinished) {
            const s = performance.now();
            try {
              const r = await teacher.req('GET', `/api/exams/${examId}/results`);
              if (r.status === 200) {
                teacherLatencies.push(performance.now() - s);
              } else {
                teacherErrors += 1;
              }
            } catch {
              teacherErrors += 1;
            }
            await new Promise((r) => setTimeout(r, TEACHER_POLL_INTERVAL_MS));
          }
        })()
      : Promise.resolve();

  const submits = await Promise.all(
    submitters.map(async ({ client }) => {
      const s = performance.now();
      const r = await client.req('POST', `/api/student/exams/${examId}/submit`, { tasks: [] });
      if (r.status === 202) {
        submitLatencies.push(performance.now() - s);
      } else {
        submitErrors += 1;
      }
      return r.status;
    }),
  );
  const bad = submits.filter((s) => s !== 202);
  if (bad.length) throw new Error(`submit statuses: ${bad.join(',')}`);

  const previewLatencies: number[] = [];
  let previewErrors = 0;
  const previews =
    javaTask && previewers.length > 0
      ? (async () => {
          await new Promise((r) => setTimeout(r, 1500));
          await Promise.all(
            previewers.map(async (previewer) => {
              const s = performance.now();
              try {
                const r = await previewer.req('POST', `/api/student/tasks/${javaTask.id}/run`, {
                  code: CODE.JAVA,
                });
                if (r.status === 200) {
                  previewLatencies.push(performance.now() - s);
                } else {
                  previewErrors += 1;
                }
              } catch {
                previewErrors += 1;
              }
            }),
          );
        })()
      : Promise.resolve();

  // Poll student results until all attempts finish grading.
  const doneLatencies: number[] = [];
  let pollErrors = 0;
  const outcomes: Array<{ fault: FaultKind; score: number }> = [];
  await Promise.all(
    submitters.map(async ({ client, fault }) => {
      for (;;) {
        const r = await client.req('GET', `/api/student/exams/${examId}/result`);
        if (r.status !== 200) {
          pollErrors += 1;
        } else if (r.body && !r.body.grading) {
          doneLatencies.push(performance.now() - t0);
          const attempt = r.body.attempt as { score?: number } | null | undefined;
          outcomes.push({ fault, score: attempt?.score ?? -1 });
          return;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    }),
  );
  const total = performance.now() - t0;
  gradingFinished = true;
  await Promise.all([previews, teacherPoller]);

  const full = taskIds.length * 10;
  const acWrong = outcomes.filter((o) => o.fault === 'AC' && o.score !== full).length;
  const faultUnexpectedFull = outcomes.filter((o) => o.fault !== 'AC' && o.score === full).length;

  console.log(formatLatencySummary('submit request', submitLatencies, submitErrors, 'ms'));
  console.log(formatLatencySummary('graded (polling)', doneLatencies, pollErrors, 's'));
  if (javaTask && previewers.length > 0) {
    console.log(formatLatencySummary('Java preview rush', previewLatencies, previewErrors, 'ms'));
  }
  if (TEACHER_POLL_INTERVAL_MS > 0) {
    console.log(formatLatencySummary('teacher GET /results', teacherLatencies, teacherErrors, 'ms'));
  }
  console.log(
    `all ${STUDENTS} graded in ${(total / 1000).toFixed(2)}s — ` +
      `${((STUDENTS * taskIds.length) / (total / 1000)).toFixed(1)} task-gradings/s`,
  );

  if (acWrong > 0) {
    throw new Error(`${acWrong} AC attempts did not get the full score ${full}`);
  }
  if (faultUnexpectedFull > 0) {
    throw new Error(`${faultUnexpectedFull} fault attempts unexpectedly got the full score ${full}`);
  }
  console.log(`all scores verified (AC=${STUDENTS - faultCount}, faults=${faultCount})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
