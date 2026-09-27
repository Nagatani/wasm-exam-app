// @ts-nocheck
import { checkPythonSyntax, runPythonProgram } from '../../judge/runner/shared/pyodideProgram.js';
// Pyodide (CPython -> WASM) running in a Web Worker. One worker is reused
// across the test cases of a run (Pyodide loads once, ~10MB from the CDN on
// first use); pyRunner.ts terminate()s and recreates it on timeout so an
// infinite loop can't wedge things. Where Pyodide is loaded from (jsDelivr by
// default, or a self-hosted copy via VITE_PYODIDE_BASE_URL) is decided by
// pyRunner.ts and arrives as `baseUrl` on every message — this is a classic
// worker, so it can't read import.meta.env itself.

let pyodidePromise = null;
function getPyodide(baseUrl) {
  if (!pyodidePromise) {
    importScripts(`${baseUrl}pyodide.js`);
    // eslint-disable-next-line no-undef
    pyodidePromise = loadPyodide({ indexURL: baseUrl });
  }
  return pyodidePromise;
}

// Checking / running a program is shared with the judge (see
// judge/runner/shared/pyodideProgram.js) so both treat it identically.

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const py = await getPyodide(msg.baseUrl);

    if (msg.op === 'prepare') {
      const { ok, error } = checkPythonSyntax(py, msg.source ?? '');
      self.postMessage({ op: 'prepare', id: msg.id, ok, error });
      return;
    }

    // op === 'run'
    const { ok, stdout, stderr, oom } = runPythonProgram(py, msg.source ?? '', msg.stdin);
    self.postMessage({ op: 'run', id: msg.id, ok, stdout, stderr, oom });
  } catch (err) {
    self.postMessage({
      op: msg.op || 'run',
      id: msg.id,
      ok: false,
      stdout: '',
      stderr: String(err && err.message ? err.message : err),
      fatal: true,
    });
  }
};
