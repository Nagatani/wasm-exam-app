// Runs one compiled C program (wasm32-wasi, built by the judge's clang with
// the same flags as the browser) with the process's own stdin/stdout/stderr.
// Judge.java spawns one of these per test case and kills it on timeout.
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';

const wasi = new WASI({ version: 'preview1', args: ['main'], env: {}, returnOnExit: true });
const module = await WebAssembly.compile(await readFile(process.argv[2]));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
