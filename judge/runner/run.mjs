// Judge-side runner for JS / TS / Python. Judge.java writes one request as
// JSON to stdin and reads one response from stdout:
//   request:  { language: 'JS'|'TS'|'PYTHON', code, tests: [{ id, stdin }] }
//   response: { compile: { ok, stderr }, results: [{ id, stdout, stderr,
//               exitCode, timedOut, oom, timeMs }] }
// (the same shape Judge.java returns for Java/C). Everything that decides a
// program's outcome — stdin helpers, output formatting, TS transform, the
// Python exec template, the per-test time limit, and the worker lifecycle
// (fresh worker per JS test; one reused Pyodide worker, recreated after a
// timeout) — mirrors src/runner/* in the browser, mostly via ./shared.
import { Worker } from 'node:worker_threads';
import { prepareJsSource } from './shared/jsPrepare.js';
import { RUN_TIME_LIMIT_MS } from './shared/limits.js';

// Same as pyRunner.ts's LOAD_TIMEOUT_MS (first Pyodide load).
const PY_LOAD_TIMEOUT_MS = 90_000;
// Judge-only safety net (the browser has no equivalent): cap a JS worker's
// heap so one runaway program can't take the whole container down.
const JS_WORKER_HEAP_MB = 256;
// Per-stream output cap (Judge.java applies the same 64KB cap; trimming here
// keeps the JSON response small enough to never be truncated in transit).
const MAX_STREAM_CHARS = 64 * 1024;

const request = JSON.parse(await readStdin());
const response = await handle(request);
process.stdout.write(JSON.stringify(response));

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function handle({ language, code, tests }) {
  if (language === 'JS' || language === 'TS') return runJs(language, code, tests);
  if (language === 'PYTHON') return runPython(code, tests);
  throw new Error(`unsupported language: ${language}`);
}

async function runJs(language, code, tests) {
  // Loaded only for JS/TS (~20ms of CPU a Python request doesn't need).
  const { transform } = await import('sucrase');
  const prepared = prepareJsSource(code, language, transform);
  if (!prepared.ok) return { compile: { ok: false, stderr: prepared.error }, results: [] };
  const limit = RUN_TIME_LIMIT_MS[language];
  const results = [];
  for (const test of tests) {
    const started = performance.now();
    const outcome = await new Promise((resolve) => {
      const worker = new Worker(new URL('./jsWorker.mjs', import.meta.url), {
        workerData: { code: prepared.js, stdin: test.stdin },
        resourceLimits: { maxOldGenerationSizeMb: JS_WORKER_HEAP_MB },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve({ ok: false, stdout: '', stderr: '実行時間の上限を超えました。', timedOut: true });
      }, limit);
      worker.once('message', (r) => {
        clearTimeout(timer);
        void worker.terminate();
        resolve({ ...r, timedOut: false });
      });
      worker.once('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, stdout: '', stderr: String(err?.message ?? err), timedOut: false });
      });
    });
    results.push(toResult(test.id, outcome, started));
  }
  return { compile: { ok: true, stderr: '' }, results };
}

async function runPython(code, tests) {
  let worker = null;
  let nextId = 0;
  const getWorker = () => (worker ??= new Worker(new URL('./pyWorker.mjs', import.meta.url)));
  const reset = () => {
    if (worker) void worker.terminate();
    worker = null;
  };
  // One request/response on the (possibly new) worker, with a timeout that
  // kills it — pyRunner.ts's call().
  const call = (message, timeoutMs) => {
    const w = getWorker();
    const id = ++nextId;
    return new Promise((resolve) => {
      const onMessage = (reply) => {
        if (reply.id !== id) return;
        cleanup();
        if (reply.fatal) reset();
        resolve(reply);
      };
      const onError = (err) => {
        cleanup();
        reset();
        resolve({ fatal: true, error: String(err?.message ?? err) });
      };
      const timer = setTimeout(() => {
        cleanup();
        reset();
        resolve({ timedOut: true });
      }, timeoutMs);
      function cleanup() {
        clearTimeout(timer);
        w.off('message', onMessage);
        w.off('error', onError);
      }
      w.on('message', onMessage);
      w.on('error', onError);
      w.postMessage({ ...message, id });
    });
  };

  try {
    const check = await call({ op: 'check', source: code }, PY_LOAD_TIMEOUT_MS);
    if (check.timedOut || check.fatal) {
      throw new Error(`Pyodide failed to load: ${check.error ?? 'timeout'}`);
    }
    if (!check.ok) return { compile: { ok: false, stderr: check.error }, results: [] };

    const results = [];
    for (const test of tests) {
      const started = performance.now();
      const reply = await call({ op: 'run', source: code, stdin: test.stdin }, RUN_TIME_LIMIT_MS.PYTHON);
      const outcome = reply.timedOut
        ? { ok: false, stdout: '', stderr: '実行時間の上限を超えました。', timedOut: true }
        : reply.fatal
          ? { ok: false, stdout: '', stderr: reply.error, timedOut: false }
          : { ...reply, timedOut: false };
      results.push(toResult(test.id, outcome, started));
    }
    return { compile: { ok: true, stderr: '' }, results };
  } finally {
    reset();
  }
}

function toResult(id, outcome, started) {
  return {
    id,
    stdout: (outcome.stdout ?? '').slice(0, MAX_STREAM_CHARS),
    stderr: (outcome.stderr ?? '').slice(0, MAX_STREAM_CHARS),
    exitCode: outcome.timedOut ? null : outcome.ok ? 0 : 1,
    timedOut: !!outcome.timedOut,
    oom: !!outcome.oom,
    timeMs: Math.round(performance.now() - started),
  };
}
