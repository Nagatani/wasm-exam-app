// Runs ONE prepared JavaScript program against ONE stdin and returns
// { ok, stdout, stderr }. The caller provides isolation and the time limit
// (browser: a throwaway Web Worker; judge: a Node worker thread).
//
// Student stdout is collected via console.* / print() / write(), and a
// readline()/read() pair exposes stdin. Node-only globals are shadowed with
// undefined so a program behaves the same in the judge as in the browser
// (where they never existed).
export function runJsProgram(code, stdin) {
  const raw = typeof stdin === 'string' ? stdin : '';
  const lines = raw.length ? raw.split('\n') : [];
  // "a\nb\n" -> ["a","b"] rather than ["a","b",""].
  if (raw.endsWith('\n')) lines.pop();
  let cursor = 0;
  const readline = () => (cursor < lines.length ? lines[cursor++] : '');
  const read = () => lines.slice(cursor).join('\n');

  let out = '';
  const stringify = (v) => {
    try {
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    } catch {
      return String(v);
    }
  };
  const write = (s) => {
    out += String(s);
  };
  const print = (...args) => {
    out += args.map((a) => (typeof a === 'string' ? a : stringify(a))).join(' ') + '\n';
  };
  const consoleShim = { log: print, error: print, warn: print, info: print, debug: print };

  try {
    // Student code runs as a function body: top-level `return` is allowed,
    // top-level `await` is not (documented in the student UI).
    const fn = new Function(
      'readline',
      'readLine',
      'read',
      'print',
      'write',
      'console',
      'process',
      'require',
      'module',
      'exports',
      'Buffer',
      `"use strict";\n${code}`,
    );
    fn(readline, readline, read, print, write, consoleShim, undefined, undefined, undefined, undefined, undefined);
    return { ok: true, stdout: out, stderr: '' };
  } catch (err) {
    const stderr = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { ok: false, stdout: out, stderr };
  }
}
