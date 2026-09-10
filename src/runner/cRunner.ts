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

function loadClang(): Promise<Wasmer> {
  if (!clangPromise) {
    clangPromise = ensureInit().then(() => Wasmer.fromRegistry('clang/clang'));
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
    args: ['/project/main.c', '-o', '/project/main.wasm'],
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

// Runs the program with a wall-clock timeout. `@wasmer/sdk`'s `Instance` has
// no kill/abort API, so on timeout we detach the handle (`free()`) and return
// a `timedOut` result: the runaway program may keep occupying one worker from
// the SDK's *bounded* pool until the page is reloaded, but the tab no longer
// hangs and the judge gets a deterministic outcome. Memory limits (MLE) are
// still Phase 6.
export async function runCompiledC(
  wasmBinary: Uint8Array,
  stdin: string,
  timeoutMs: number = C_TIME_LIMIT_MS,
): Promise<RunResult> {
  const program = await Wasmer.fromFile(wasmBinary);
  if (!program.entrypoint) {
    throw new Error('コンパイル結果にエントリーポイントが見つかりません。');
  }

  const runInstance = await program.entrypoint.run({ stdin });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const finished = runInstance
    .wait()
    .then((output) => ({ output }) as const)
    .catch((err) => ({ err }) as const);

  const race = await Promise.race([finished, timeout]);
  if (timer) clearTimeout(timer);

  if (race === 'timeout') {
    try {
      runInstance.free();
    } catch {
      /* handle may already be gone */
    }
    void finished.catch(() => {}); // swallow the abandoned wait()'s eventual settle
    return {
      ok: false,
      timedOut: true,
      stdout: '',
      stderr: `実行時間が制限（${Math.round(timeoutMs / 1000)}秒）を超えました。`,
      exitCode: null,
    };
  }

  if ('err' in race) {
    throw race.err;
  }

  const runOutput = race.output;
  return {
    ok: runOutput.ok,
    timedOut: false,
    stdout: runOutput.stdout,
    stderr: runOutput.stderr,
    exitCode: runOutput.code,
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
