// Python client-side runner backed by Pyodide in a Web Worker (see
// py.worker.ts). The worker is reused across a run's test cases so Pyodide
// only loads once (~10MB from the CDN on first use); on a timeout it is
// terminate()d and a fresh one is created on the next call.

export interface PyPrepareResult {
  ok: boolean;
  error: string;
}

export interface PyRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// First call pulls the Pyodide runtime; later calls are fast.
const LOAD_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 15_000;

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./py.worker.ts', import.meta.url));
  }
  return worker;
}

function resetWorker(): void {
  worker?.terminate();
  worker = null;
}

// Kick off the Pyodide download early (e.g. when a Python task page opens) so
// the first real run isn't the thing that waits for it.
type PyState = 'idle' | 'loading' | 'ready' | 'error';
let pyState: PyState = 'idle';

// Whether the ~10MB Pyodide runtime has finished loading this page load.
export function pyRunnerState(): PyState {
  return pyState;
}

export function prewarmPyRunner(): void {
  if (pyState === 'loading' || pyState === 'ready') return;
  pyState = 'loading';
  void call({ op: 'prepare', source: 'pass' }, LOAD_TIMEOUT_MS).then((r) => {
    pyState = r.ok ? 'ready' : 'error';
  });
}

interface WorkerReply {
  op: string;
  ok?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  // Set by py.worker.ts's outer catch — an infrastructure-level failure
  // (Pyodide itself failed to load, typically a network/CDN problem) as
  // opposed to a student-code compile/runtime error. Used to show a distinct,
  // friendlier message instead of the raw browser error text.
  fatal?: boolean;
}

const RUNTIME_LOAD_FAILURE_MESSAGE =
  'Python 実行環境（Pyodide）の読み込みに失敗しました。ネットワーク環境を確認するか、しばらくしてから再度お試しください。';

function call(message: Record<string, unknown>, timeoutMs: number): Promise<WorkerReply> {
  const w = getWorker();
  return new Promise<WorkerReply>((resolve) => {
    const timer = setTimeout(() => {
      resetWorker();
      resolve({ op: String(message.op), timedOut: true });
    }, timeoutMs);

    const onMessage = (e: MessageEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      clearTimeout(timer);
      const reply = e.data as WorkerReply;
      // A `fatal` reply means Pyodide itself failed to load inside the
      // worker; unlike a normal ok:false (student code failed), the worker's
      // internal `pyodidePromise` can be left memoized-rejected, so keeping
      // this worker around would make every future call fail the same way
      // without ever retrying the load. Reset it so the next call gets a
      // fresh worker (and therefore an actual retry), matching the message's
      // "しばらくしてから再度お試しください".
      if (reply.fatal) resetWorker();
      resolve(reply);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      clearTimeout(timer);
      resetWorker();
      // A worker-level 'error' event (as opposed to a normal reply message)
      // means the worker crashed outright — treat it the same as py.worker.ts's
      // own `fatal` replies so `preparePy`/`runPyOnce` show the friendly
      // load-failure message instead of an empty/raw one. resetWorker() also
      // clears the memoized worker so the *next* call gets a fresh one to
      // retry against (unlike C's memoized clang promise — see cRunner.ts).
      resolve({ op: String(message.op), ok: false, fatal: true, stderr: e.message || '' });
    };

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(message);
  });
}

export async function preparePy(source: string): Promise<PyPrepareResult> {
  const reply = await call({ op: 'prepare', source }, LOAD_TIMEOUT_MS);
  if (reply.timedOut) {
    return { ok: false, error: 'Python 実行環境の読み込みがタイムアウトしました。再度お試しください。' };
  }
  if (reply.fatal) {
    return { ok: false, error: RUNTIME_LOAD_FAILURE_MESSAGE };
  }
  return { ok: reply.ok ?? false, error: reply.error ?? '' };
}

export async function runPyOnce(source: string, stdin: string): Promise<PyRunResult> {
  const reply = await call({ op: 'run', source, stdin }, RUN_TIMEOUT_MS);
  if (reply.timedOut) {
    return { ok: false, stdout: '', stderr: '実行時間の上限を超えました。', timedOut: true };
  }
  if (reply.fatal) {
    return { ok: false, stdout: '', stderr: RUNTIME_LOAD_FAILURE_MESSAGE, timedOut: false };
  }
  return {
    ok: reply.ok ?? false,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    timedOut: false,
  };
}
