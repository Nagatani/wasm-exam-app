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

export interface RunCResult {
  stage: RunCStage;
  compileStderr: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// Infinite-loop / resource-limit protection is explicitly out of scope here —
// that's Phase 6 (TLE/MLE handling). This just compiles and runs to completion.
export async function compileAndRunC(sourceCode: string, stdin: string): Promise<RunCResult> {
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
      stage: 'compile_error',
      compileStderr: compileOutput.stderr,
      stdout: '',
      stderr: '',
      exitCode: compileOutput.code,
    };
  }

  const wasmBinary = await project.readFile('main.wasm');
  const program = await Wasmer.fromFile(wasmBinary);
  if (!program.entrypoint) {
    throw new Error('コンパイル結果にエントリーポイントが見つかりません。');
  }

  const runInstance = await program.entrypoint.run({ stdin });
  const runOutput = await runInstance.wait();

  return {
    stage: runOutput.ok ? 'success' : 'runtime_error',
    compileStderr: compileOutput.stderr,
    stdout: runOutput.stdout,
    stderr: runOutput.stderr,
    exitCode: runOutput.code,
  };
}
