// @ts-nocheck
// Executes ONE prepared JavaScript program against ONE stdin, in an isolated
// Web Worker. The caller (jsRunner.ts) spins up a fresh worker per test case
// and terminate()s it on timeout, so an infinite loop here can't freeze the
// page. Student stdout is collected via console.* / print() / write() and a
// readline()/read() pair exposes stdin — the same shape most browser judges
// use (no `process` / `require` in a worker).

self.onmessage = (e) => {
  const { code, stdin } = e.data;

  const raw = typeof stdin === 'string' ? stdin : '';
  const lines = raw.length ? raw.split('\n') : [];
  // "a\nb\n" -> ["a","b"] rather than ["a","b",""].
  if (raw.endsWith('\n')) lines.pop();
  let cursor = 0;
  const readline = () => (cursor < lines.length ? lines[cursor++] : '');
  const read = () => lines.slice(cursor).join('\n');

  let out = '';
  const write = (s) => {
    out += String(s);
  };
  const print = (...args) => {
    out += args.map((a) => (typeof a === 'string' ? a : stringify(a))).join(' ') + '\n';
  };
  const stringify = (v) => {
    try {
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    } catch {
      return String(v);
    }
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
      `"use strict";\n${code}`,
    );
    fn(readline, readline, read, print, write, consoleShim);
    self.postMessage({ ok: true, stdout: out, stderr: '' });
  } catch (err) {
    const stderr = err instanceof Error ? (err.stack ?? err.message) : String(err);
    self.postMessage({ ok: false, stdout: out, stderr });
  }
};
