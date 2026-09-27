// The Python half of the shared runner: given an already-loaded Pyodide
// instance (browser: py.worker.ts from the CDN; judge: Node + the pyodide npm
// package of the same version), check or run one program. Both sides call
// exactly these functions, so stdin handling, the fresh-globals exec, the
// traceback → stderr / ok=false mapping and MemoryError → oom are identical.

// Redirects stdin/stdout/stderr, runs the student program in a fresh global
// namespace, and reports (ok, stdout, stderr, oom) — a traceback goes to
// stderr and flips ok to false, matching how the C/JS runners report a
// runtime error; MemoryError additionally sets oom (→ MLE).
const RUN_TEMPLATE = `
import sys, io, traceback
__out__, __err__ = io.StringIO(), io.StringIO()
__saved__ = (sys.stdin, sys.stdout, sys.stderr)
sys.stdin, sys.stdout, sys.stderr = io.StringIO(__stdin__), __out__, __err__
__ok__ = True
__oom__ = False
try:
    exec(compile(__src__, "<main>", "exec"), {"__name__": "__main__"})
except SystemExit:
    pass
except MemoryError:
    __ok__ = False
    __oom__ = True
    traceback.print_exc()
except BaseException:
    __ok__ = False
    traceback.print_exc()
finally:
    sys.stdin, sys.stdout, sys.stderr = __saved__
__result__ = [__ok__, __out__.getvalue(), __err__.getvalue(), __oom__]
`;

// Syntax check only (a SyntaxError here is reported as a compile error).
export function checkPythonSyntax(py, source) {
  py.globals.set('__src__', source ?? '');
  try {
    py.runPython('compile(__src__, "<main>", "exec")');
    return { ok: true, error: '' };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    py.globals.delete('__src__');
  }
}

export function runPythonProgram(py, source, stdin) {
  py.globals.set('__src__', source ?? '');
  py.globals.set('__stdin__', typeof stdin === 'string' ? stdin : '');
  try {
    py.runPython(RUN_TEMPLATE);
    const proxy = py.globals.get('__result__');
    const [ok, stdout, stderr, oom] = proxy.toJs();
    proxy.destroy();
    return { ok, stdout, stderr, oom };
  } finally {
    py.globals.delete('__src__');
    py.globals.delete('__stdin__');
  }
}
