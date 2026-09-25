// Runs one compiled C program (WASI .wasm) per message, in its own Web Worker
// with its own @wasmer/sdk instance. This exists so a runaway program can be
// killed: the SDK's Instance has no kill API, but the main thread can
// terminate() this whole worker — and with it the SDK's thread pool — on
// timeout (see runCompiledC in cRunner.ts). Compilation stays on the main
// thread, where the ~106MB clang package is loaded once.
import { init, Wasmer } from '@wasmer/sdk';

let initPromise: ReturnType<typeof init> | null = null;

interface RunRequest {
  id: number;
  wasmBinary: Uint8Array;
  stdin: string;
}

self.onmessage = async (e: MessageEvent<RunRequest>) => {
  const { id, wasmBinary, stdin } = e.data;
  try {
    initPromise ??= init();
    await initPromise;
    const program = await Wasmer.fromFile(wasmBinary);
    if (!program.entrypoint) {
      throw new Error('コンパイル結果にエントリーポイントが見つかりません。');
    }
    const instance = await program.entrypoint.run({ stdin });
    const output = await instance.wait();
    self.postMessage({ id, ok: output.ok, stdout: output.stdout, stderr: output.stderr, exitCode: output.code });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
