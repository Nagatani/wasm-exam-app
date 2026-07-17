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

export type RunCStage = 'compile_error' | 'runtime_error' | 'success';

export interface CompileResult {
  ok: boolean;
  wasmBinary: Uint8Array | null;
  stderr: string;
  exitCode: number | null;
}

export interface RunResult {
  ok: boolean;
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

// Infinite-loop / resource-limit protection is explicitly out of scope here —
// that's Phase 6 (TLE/MLE handling). This just runs the program to completion.
export async function runCompiledC(wasmBinary: Uint8Array, stdin: string): Promise<RunResult> {
  const program = await Wasmer.fromFile(wasmBinary);
  if (!program.entrypoint) {
    throw new Error('コンパイル結果にエントリーポイントが見つかりません。');
  }

  const runInstance = await program.entrypoint.run({ stdin });
  const runOutput = await runInstance.wait();

  return {
    ok: runOutput.ok,
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
    stage: runResult.ok ? 'success' : 'runtime_error',
    compileStderr: compileResult.stderr,
    stdout: runResult.stdout,
    stderr: runResult.stderr,
    exitCode: runResult.exitCode,
  };
}
