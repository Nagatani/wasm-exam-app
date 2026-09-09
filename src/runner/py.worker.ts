// @ts-nocheck
// Pyodide (CPython -> WASM) running in a Web Worker. One worker is reused
// across the test cases of a run (Pyodide loads once, ~10MB from the CDN on
// first use); pyRunner.ts terminate()s and recreates it on timeout so an
// infinite loop can't wedge things. Pyodide is loaded from the jsDelivr CDN —
// if a deployment's cross-origin-isolation headers block that, self-host the
// pyodide dist and point PYODIDE_BASE_URL at it.

const PYODIDE_VERSION = 'v0.28.0';
const PYODIDE_BASE_URL = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;

let pyodidePromise = null;
function getPyodide() {
  if (!pyodidePromise) {
    importScripts(`${PYODIDE_BASE_URL}pyodide.js`);
    // eslint-disable-next-line no-undef
    pyodidePromise = loadPyodide({ indexURL: PYODIDE_BASE_URL });
  }
  return pyodidePromise;
}

// Redirects stdin/stdout/stderr, runs the student program in a fresh global
// namespace, and reports (ok, stdout, stderr) — a traceback goes to stderr and
// flips ok to false, matching how the C/JS runners report a runtime error.
const RUN_TEMPLATE = `
import sys, io, traceback
__out__, __err__ = io.StringIO(), io.StringIO()
__saved__ = (sys.stdin, sys.stdout, sys.stderr)
sys.stdin, sys.stdout, sys.stderr = io.StringIO(__stdin__), __out__, __err__
__ok__ = True
try:
    exec(compile(__src__, "<main>", "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
except BaseException:
    __ok__ = False
    traceback.print_exc()
finally:
    sys.stdin, sys.stdout, sys.stderr = __saved__
__result__ = [__ok__, __out__.getvalue(), __err__.getvalue()]
`;

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const py = await getPyodide();

    if (msg.op === 'prepare') {
      py.globals.set('__src__', msg.source ?? '');
      try {
        py.runPython('compile(__src__, "<main>", "exec")');
        self.postMessage({ op: 'prepare', ok: true, error: '' });
      } catch (err) {
        self.postMessage({ op: 'prepare', ok: false, error: String(err && err.message ? err.message : err) });
      } finally {
        py.globals.delete('__src__');
      }
      return;
    }

    // op === 'run'
    py.globals.set('__src__', msg.source ?? '');
    py.globals.set('__stdin__', typeof msg.stdin === 'string' ? msg.stdin : '');
    py.runPython(RUN_TEMPLATE);
    const proxy = py.globals.get('__result__');
    const [ok, stdout, stderr] = proxy.toJs();
    proxy.destroy();
    py.globals.delete('__src__');
    py.globals.delete('__stdin__');
    self.postMessage({ op: 'run', ok, stdout, stderr });
  } catch (err) {
    self.postMessage({
      op: msg.op || 'run',
      ok: false,
      stdout: '',
      stderr: String(err && err.message ? err.message : err),
      fatal: true,
    });
  }
};
