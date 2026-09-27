// Node worker thread hosting Pyodide — the judge-side counterpart of
// src/runner/py.worker.ts: loads the same Pyodide release (npm package, no
// network) once and serves `check` / `run` requests through the shared
// pyodideProgram.js. run.mjs reuses it across test cases and terminates +
// recreates it on timeout, exactly like pyRunner.ts does in the browser.
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadPyodide } from 'pyodide';
import { checkPythonSyntax, runPythonProgram } from './shared/pyodideProgram.js';

const indexURL = path.dirname(createRequire(import.meta.url).resolve('pyodide/package.json')) + path.sep;
let pyodidePromise = null;

parentPort.on('message', async (msg) => {
  try {
    pyodidePromise ??= loadPyodide({ indexURL, stdout: () => {}, stderr: () => {} });
    const py = await pyodidePromise;
    if (msg.op === 'check') {
      parentPort.postMessage({ id: msg.id, ...checkPythonSyntax(py, msg.source) });
    } else {
      parentPort.postMessage({ id: msg.id, ...runPythonProgram(py, msg.source, msg.stdin) });
    }
  } catch (err) {
    parentPort.postMessage({ id: msg.id, fatal: true, error: String(err && err.message ? err.message : err) });
  }
});
