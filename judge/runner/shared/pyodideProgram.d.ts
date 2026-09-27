// `py` is a loaded Pyodide instance (typed loosely: the browser loads it via
// importScripts, the judge via the npm package).
export declare function checkPythonSyntax(py: unknown, source: string): { ok: boolean; error: string };
export declare function runPythonProgram(
  py: unknown,
  source: string,
  stdin: string,
): { ok: boolean; stdout: string; stderr: string; oom: boolean };
