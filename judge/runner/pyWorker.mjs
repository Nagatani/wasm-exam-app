// Node worker thread hosting Pyodide — the judge-side counterpart of
// src/runner/py.worker.ts: loads the same Pyodide release (npm package, no
// network) once and serves `check` / `run` requests through the shared
// pyodideProgram.js. run.mjs reuses it across test cases and terminates +
// recreates it on timeout, exactly like pyRunner.ts does in the browser.
import { parentPort } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadPyodide } from 'pyodide';
import { checkPythonSyntax, runPythonProgram } from './shared/pyodideProgram.js';

const indexURL = path.dirname(createRequire(import.meta.url).resolve('pyodide/package.json')) + path.sep;
let pyodidePromise = null;

// Memory snapshot of a freshly initialised interpreter, made at image build
// time (makeSnapshot.mjs). Restoring it takes ~50ms instead of ~1.1s for a
// full boot, and — taken before any student code — it is the same pristine
// state a fresh load gives. Falls back to a full load if absent (e.g. running
// the runner on a dev host without building the snapshot).
function loadSnapshot() {
  try {
    return readFileSync(new URL('./pyodide-snapshot.bin', import.meta.url));
  } catch {
    return undefined;
  }
}

const snapshot = loadSnapshot();

parentPort.on('message', async (msg) => {
  try {
    pyodidePromise ??= loadPyodide({
      indexURL,
      stdout: () => {},
      stderr: () => {},
      ...(snapshot ? { _loadSnapshot: snapshot } : {}),
    });
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
