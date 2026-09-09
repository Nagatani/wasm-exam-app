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
export function prewarmPyRunner(): void {
  getWorker().postMessage({ op: 'prepare', source: 'pass' });
}

interface WorkerReply {
  op: string;
  ok?: boolean;
  error?: string;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
}

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
      resolve(e.data as WorkerReply);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      clearTimeout(timer);
      resetWorker();
      resolve({ op: String(message.op), ok: false, stderr: e.message || 'worker error' });
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
  return { ok: reply.ok ?? false, error: reply.error ?? '' };
}

export async function runPyOnce(source: string, stdin: string): Promise<PyRunResult> {
  const reply = await call({ op: 'run', source, stdin }, RUN_TIMEOUT_MS);
  if (reply.timedOut) {
    return { ok: false, stdout: '', stderr: '実行時間の上限を超えました。', timedOut: true };
  }
  return {
    ok: reply.ok ?? false,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    timedOut: false,
  };
}
