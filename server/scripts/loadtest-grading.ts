// Load test for server-side grading: N students final-submit the same exam
// at the same moment, and we measure how long until every attempt is graded.
//
//   1. start a server against a throwaway *_test DB with JUDGE_URL set, e.g.
//        DATABASE_URL=postgresql://wasm_exam:wasm_exam@localhost:5433/wasm_exam_load_test \
//        npx tsx scripts/e2e-prepare-db.ts
//        PORT=4300 JUDGE_URL=http://localhost:4001 DATABASE_URL=... node dist/index.js
//   2. BASE_URL=http://localhost:4300 STUDENTS=100 npx tsx scripts/loadtest-grading.ts
//
// Every student answers every task correctly, so each attempt must end with
// the full score — the run fails loudly otherwise.
const BASE = process.env.BASE_URL ?? 'http://localhost:4300';
const STUDENTS = Number(process.env.STUDENTS ?? 100);
const TESTS_PER_TASK = Number(process.env.TESTS_PER_TASK ?? 5);
const LANGUAGES = (process.env.LANGUAGES ?? 'C,JS,TS,PYTHON,JAVA').split(',');
const PASSWORD = 'loadtest-pass-1';

const CODE: Record<string, string> = {
  C: '#include <stdio.h>\nint main(void){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',
  JS: "const [a,b]=readline().split(' ').map(Number); print(a+b);",
  TS: "const [a,b]: number[]=readline().split(' ').map(Number); console.log(a+b);",
  PYTHON: 'a,b=map(int,input().split())\nprint(a+b)',
  JAVA: 'void main(){ var s=new java.util.Scanner(System.in); IO.println(s.nextInt()+s.nextInt()); }',
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
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
}

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const teacher = new Client();
  const t = await teacher.req('POST', '/api/auth/signup', { studentNumber: 'teacher01', password: PASSWORD });
  if (t.status !== 201) await teacher.req('POST', '/api/auth/login', { studentNumber: 'teacher01', password: PASSWORD });

  const { body: examBody } = await teacher.req('POST', '/api/exams', {
    title: `負荷試験 ${new Date().toISOString()}`,
    mode: 'EXAM',
    timeLimitMinutes: 60,
    maxAttempts: 1,
  });
  const examId: string = examBody.exam.id;
  const taskIds: Array<{ id: string; language: string }> = [];
  for (const [i, language] of LANGUAGES.entries()) {
    const { body } = await teacher.req('POST', `/api/exams/${examId}/tasks`, {
      order: i, title: `${language} の和`, statementMarkdown: 'x', points: 10, language,
    });
    const cases = Array.from({ length: TESTS_PER_TASK }, (_, k) => ({
      input: `${k} ${k * 3}`, expectedOutput: String(k * 4), isSample: k === 0,
    }));
    await teacher.req('POST', `/api/tasks/${body.task.id}/test-cases/bulk`, { cases });
    taskIds.push({ id: body.task.id, language });
  }
  await teacher.req('PATCH', `/api/exams/${examId}`, { status: 'PUBLISHED' });

  // Students + attempts + drafts (setup, not measured).
  const roster = Array.from({ length: STUDENTS + 1 }, (_, i) => ({
    studentNumber: `lt${String(i).padStart(4, '0')}`, displayName: `負荷${i}`,
  }));
  const bulk = await teacher.req('POST', '/api/students/bulk', { students: roster });
  const passwords = new Map<string, string>(
    (bulk.body.created ?? []).map((c: { studentNumber: string; initialPassword: string }) => [c.studentNumber, c.initialPassword]),
  );
  const students: Client[] = [];
  for (const r of roster) {
    const c = new Client();
    const pw = passwords.get(r.studentNumber);
    if (!pw) throw new Error(`no initial password for ${r.studentNumber} (reuse a fresh DB)`);
    const login = await c.req('POST', '/api/auth/login', { studentNumber: r.studentNumber, password: pw });
    if (login.status !== 200) throw new Error(`login ${r.studentNumber}: ${login.status}`);
    await c.req('POST', `/api/student/exams/${examId}/attempts`);
    for (const task of taskIds) {
      await c.req('PUT', `/api/student/tasks/${task.id}/draft`, {
        code: CODE[task.language], keystrokeCount: 1, pasteCount: 0, pastedCharCount: 0, timeSpentSeconds: 1,
      });
    }
    students.push(c);
  }
  // The extra last student keeps taking the exam and presses 実行 (a Java
  // preview) during the rush — interactive runs must not wait behind grading.
  const previewer = students.pop()!;
  const javaTask = taskIds.find((t) => t.language === 'JAVA');
  console.log(`setup: ${STUDENTS} students × ${taskIds.length} tasks (${LANGUAGES.join('/')}) × ${TESTS_PER_TASK} tests`);

  // Everyone presses 最終提出 at once.
  const t0 = performance.now();
  const submitLatency: number[] = [];
  const submits = await Promise.all(
    students.map(async (c) => {
      const s = performance.now();
      const r = await c.req('POST', `/api/student/exams/${examId}/submit`, { tasks: [] });
      submitLatency.push(performance.now() - s);
      return r.status;
    }),
  );
  const bad = submits.filter((s) => s !== 202);
  if (bad.length) throw new Error(`submit statuses: ${bad.join(',')}`);

  const previewLatency: number[] = [];
  const previews = javaTask
    ? (async () => {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const s = performance.now();
          const r = await previewer.req('POST', `/api/student/tasks/${javaTask.id}/run`, { code: CODE.JAVA });
          if (r.status !== 200) throw new Error(`preview status ${r.status}`);
          previewLatency.push(performance.now() - s);
        }
      })()
    : Promise.resolve();

  // Each student polls its result like the result page does (every 2s).
  const done: number[] = [];
  const scores: number[] = [];
  await Promise.all(
    students.map(async (c) => {
      for (;;) {
        const r = await c.req('GET', `/api/student/exams/${examId}/result`);
        if (r.body && !r.body.grading) {
          done.push(performance.now() - t0);
          scores.push(r.body.attempt?.score ?? -1);
          return;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
    }),
  );
  const total = performance.now() - t0;
  await previews;
  done.sort((a, b) => a - b);
  submitLatency.sort((a, b) => a - b);
  const full = taskIds.length * 10;
  const wrong = scores.filter((s) => s !== full).length;
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  console.log(`submit request: p50 ${Math.round(pct(submitLatency, 50))}ms / max ${Math.round(submitLatency.at(-1)!)}ms`);
  console.log(`graded (as seen by polling): p50 ${s(pct(done, 50))} / p90 ${s(pct(done, 90))} / max ${s(done.at(-1)!)}`);
  if (previewLatency.length) {
    console.log(`Java 実行 preview during the rush: ${previewLatency.map((ms) => `${Math.round(ms)}ms`).join(' / ')}`);
  }
  console.log(`all ${STUDENTS} graded in ${s(total)} — ${(STUDENTS * taskIds.length / (total / 1000)).toFixed(1)} task-gradings/s`);
  if (wrong) throw new Error(`${wrong} attempts did not get the full score ${full}`);
  console.log('all scores correct');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
