import { init, Wasmer, Directory } from '@wasmer/sdk';

// Both the SDK init and the ~100MB clang/clang WASIX package fetch are
// memoized module-wide: they only need to happen once per page load no
// matter how many times a student clicks "run".
let initPromise: ReturnType<typeof init> | null = null;
let clangPromise: Promise<Wasmer> | null = null;

function ensureInit(): ReturnType<typeof init> {
  if (!initPromise) {
    initPromise = init();
  }
  return initPromise;
}

export type RunnerReadiness = 'idle' | 'loading' | 'ready' | 'error';
let clangState: RunnerReadiness = 'idle';

// Whether the ~106MB clang toolchain has been fetched/initialised this page
// load (so a warm-up UI can show progress before the student starts an exam).
export function cRunnerState(): RunnerReadiness {
  return clangState;
}

function loadClang(): Promise<Wasmer> {
  if (!clangPromise) {
    clangState = 'loading';
    clangPromise = ensureInit()
      .then(() => Wasmer.fromRegistry('clang/clang'))
      .then(
        (w) => {
          clangState = 'ready';
          return w;
        },
        (err) => {
          clangState = 'error';
          // The SDK/registry's own rejection reason is internal/technical
          // (a fetch failure, a WASI init error, ...) — replace it with one
          // friendly, actionable message so it doesn't leak raw SDK text to
          // students. This is a *load* failure, distinct from a compile
          // error in the student's own code (compileC below still throws its
          // own message for that case).
          //
          // clangPromise stays memoized even on rejection (by design — see
          // its declaration), so a *retry within the same page* re-awaits
          // this same failed promise instead of re-fetching; the message
          // therefore points at reloading, not just "click run again".
          console.error('clang toolchain load failed:', err);
          throw new Error(
            'C の実行環境（clang）の読み込みに失敗しました。ページを再読み込みしてから再度お試しください。',
          );
        },
      );
  }
  return clangPromise;
}

// Kick off the SDK init + ~100MB clang toolchain download ahead of time (e.g.
// on the student dashboard / when a task page mounts) so the first real
// compile isn't the thing that pays for it. Safe to call repeatedly — the
// underlying promise is memoized — and failures are swallowed here since this
// is only an optimization; the actual compile path surfaces real errors.
export function prewarmCRunner(): void {
  loadClang().catch(() => {});
}

export type RunCStage = 'compile_error' | 'runtime_error' | 'success';

// Wall-clock cap for a single C program run, in line with the JS (10s) and
// Python (15s) runners. Per-test-case configurable limits are a separate
// Phase 6 concern (currently Java-only); C is a fixed constant like the other
// client languages.
export const C_TIME_LIMIT_MS = 10_000;

// Linear-memory cap for compiled C programs (see compileC).
export const C_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

export interface CompileResult {
  ok: boolean;
  wasmBinary: Uint8Array | null;
  stderr: string;
  exitCode: number | null;
}

export interface RunResult {
  ok: boolean;
  // The run hit the wall-clock limit and was abandoned. `clientRunner` maps
  // this to a `tle` outcome → `TLE` verdict. A memory cap (MLE) for C is still
  // Phase 6.
  timedOut: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunCResult {
  stage: RunCStage;
  compileStderr: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// Compiles once; the resulting wasmBinary can be run against many different
// stdin values via runCompiledC without paying the compile cost again — used
// by the student judge, which runs one program against every test case.
export async function compileC(sourceCode: string): Promise<CompileResult> {
  const clang = await loadClang();
  if (!clang.entrypoint) {
    throw new Error('clang パッケージにエントリーポイントが見つかりません。');
  }

  const project = new Directory();
  await project.writeFile('main.c', sourceCode);

  const compileInstance = await clang.entrypoint.run({
    // Cap the program's linear memory at 256MB (the judge's default
    // memoryLimitMb), so a runaway allocation fails (malloc → NULL, or a
    // trap) instead of growing toward 4GB in the student's browser. It can't
    // be told apart from other crashes reliably, so it surfaces as RE, not MLE.
    args: ['/project/main.c', '-o', '/project/main.wasm', `-Wl,--max-memory=${C_MEMORY_LIMIT_BYTES}`],
    mount: { '/project': project },
  });
  const compileOutput = await compileInstance.wait();

  if (!compileOutput.ok) {
    return {
      ok: false,
      wasmBinary: null,
      stderr: compileOutput.stderr,
      exitCode: compileOutput.code,
    };
  }

  const wasmBinary = await project.readFile('main.wasm');
  return { ok: true, wasmBinary, stderr: compileOutput.stderr, exitCode: compileOutput.code };
}

// Runs the program with a wall-clock timeout in a dedicated worker
// (cRun.worker.ts). `@wasmer/sdk`'s `Instance` has no kill/abort API, so a
// runaway program used to keep a thread of the SDK's pool busy — burning a
// CPU core — until the page was reloaded. Now the whole worker (and its SDK
// thread pool) is terminate()d on timeout and a fresh one is created for the
// next run; the worker is otherwise reused across test cases, so the SDK is
// only initialised again after a timeout. Memory limits (MLE) are still
// Phase 6.
let runWorker: Worker | null = null;
let nextRunId = 0;

function getRunWorker(): Worker {
  runWorker ??= new Worker(new URL('./cRun.worker.ts', import.meta.url), { type: 'module' });
  return runWorker;
}

function killRunWorker(): void {
  runWorker?.terminate();
  runWorker = null;
}

interface RunReply {
  id: number;
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  error?: string;
}

export async function runCompiledC(
  wasmBinary: Uint8Array,
  stdin: string,
  timeoutMs: number = C_TIME_LIMIT_MS,
): Promise<RunResult> {
  const worker = getRunWorker();
  const id = ++nextRunId;

  const reply = await new Promise<RunReply | 'timeout'>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      killRunWorker();
      resolve('timeout');
    }, timeoutMs);
    const onMessage = (e: MessageEvent<RunReply>) => {
      if (e.data.id !== id) return;
      cleanup();
      resolve(e.data);
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      killRunWorker();
      resolve({ id, error: e.message || 'C の実行環境でエラーが発生しました。' });
    };
    function cleanup() {
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    // Copy, not transfer: the caller runs the same binary for every test case.
    worker.postMessage({ id, wasmBinary, stdin });
  });

  if (reply === 'timeout') {
    return {
      ok: false,
      timedOut: true,
      stdout: '',
      stderr: `実行時間が制限（${Math.round(timeoutMs / 1000)}秒）を超えました。`,
      exitCode: null,
    };
  }
  if (reply.error !== undefined) {
    throw new Error(reply.error);
  }
  return {
    ok: reply.ok ?? false,
    timedOut: false,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    exitCode: reply.exitCode ?? null,
  };
}

// Convenience wrapper for single-shot compile+run use cases (e.g. SandboxPage).
export async function compileAndRunC(sourceCode: string, stdin: string): Promise<RunCResult> {
  const compileResult = await compileC(sourceCode);

  if (!compileResult.ok || !compileResult.wasmBinary) {
    return {
      stage: 'compile_error',
      compileStderr: compileResult.stderr,
      stdout: '',
      stderr: '',
      exitCode: compileResult.exitCode,
    };
  }

  const runResult = await runCompiledC(compileResult.wasmBinary, stdin);

  return {
    stage: runResult.ok && !runResult.timedOut ? 'success' : 'runtime_error',
    compileStderr: compileResult.stderr,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
  };
}
