import type { Language } from '../types/exam';
import type { EditorMarker } from '../components/CodeEditor';

// Best-effort parse of a compiler / syntax-checker's stderr into editor
// markers. Each language's toolchain formats locations differently; anything
// we can't place is simply left out (the full stderr is still shown as text).

export function parseCompileErrors(language: Language, stderr: string): EditorMarker[] {
  if (!stderr) return [];
  const lines = stderr.split('\n');
  const markers: EditorMarker[] = [];

  if (language === 'C') {
    // clang: `main.c:12:5: error: expected ';' ...` (path may be prefixed)
    const re = /(?:^|[/\s])main\.c:(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/;
    for (const l of lines) {
      const m = l.match(re);
      if (m) {
        markers.push({
          line: Number(m[1]),
          column: Number(m[2]),
          message: m[4].trim(),
          severity: m[3] === 'error' ? 'error' : 'warning',
        });
      }
    }
    return markers;
  }

  if (language === 'JAVA') {
    // javac: `Main.java:5: error: ';' expected` (no column)
    const re = /Main\.java:(\d+):\s*(error|warning):\s*(.*)$/;
    for (const l of lines) {
      const m = l.match(re);
      if (m) {
        markers.push({
          line: Number(m[1]),
          column: 1,
          endColumn: 1000,
          message: m[3].trim(),
          severity: m[2] === 'error' ? 'error' : 'warning',
        });
      }
    }
    return markers;
  }

  if (language === 'JS' || language === 'TS') {
    // sucrase / V8 SyntaxError: `... (line:col)` — take the first hit.
    for (const l of lines) {
      const m = l.match(/\((\d+):(\d+)\)/);
      if (m) {
        markers.push({
          line: Number(m[1]),
          column: Number(m[2]) + 1,
          message: l.trim(),
          severity: 'error',
        });
        break;
      }
    }
    return markers;
  }

  if (language === 'PYTHON') {
    // CPython SyntaxError traceback: `  File "<string>", line 3` + `XxxError: msg`
    let line: number | null = null;
    let message = '構文エラー';
    for (const l of lines) {
      const lm = l.match(/line (\d+)/);
      if (lm) line = Number(lm[1]);
      const em = l.match(/^\s*([A-Za-z]*(?:Error|Warning)):\s*(.*)$/);
      if (em) message = `${em[1]}: ${em[2]}`.trim();
    }
    if (line !== null) {
      markers.push({ line, column: 1, endColumn: 1000, message, severity: 'error' });
    }
    return markers;
  }

  return markers;
}
