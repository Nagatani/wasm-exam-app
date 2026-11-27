import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCompileErrors } from './compileErrors.ts';

describe('parseCompileErrors', () => {
  it('returns nothing for empty stderr', () => {
    assert.deepEqual(parseCompileErrors('C', ''), []);
  });

  it('C (clang/gcc): every located diagnostic, with severity', () => {
    const stderr = [
      "/tmp/x/main.c:5:3: error: expected ';' after expression",
      '    x = 1',
      "main.c:7:10: warning: unused variable 'y' [-Wunused-variable]",
      'main.c:7:10: note: something',
      '1 error generated.',
    ].join('\n');
    assert.deepEqual(parseCompileErrors('C', stderr), [
      { line: 5, column: 3, message: "expected ';' after expression", severity: 'error' },
      { line: 7, column: 10, message: "unused variable 'y' [-Wunused-variable]", severity: 'warning' },
      { line: 7, column: 10, message: 'something', severity: 'warning' },
    ]);
  });

  it('Java (javac): whole-line markers', () => {
    assert.deepEqual(parseCompileErrors('JAVA', "Main.java:3: error: ';' expected\n  int x = 1\n"), [
      { line: 3, column: 1, endColumn: 1000, message: "';' expected", severity: 'error' },
    ]);
  });

  it('JS/TS: first (line:col) hit, column converted to 1-based', () => {
    const markers = parseCompileErrors('TS', 'SyntaxError: Unexpected token (2:4)\nother (9:9)');
    assert.deepEqual(markers, [
      { line: 2, column: 5, message: 'SyntaxError: Unexpected token (2:4)', severity: 'error' },
    ]);
  });

  it('JS without a location yields no marker', () => {
    assert.deepEqual(parseCompileErrors('JS', 'SyntaxError: Unexpected end of input'), []);
  });

  it('Python: last line number + the error message', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "<exec>", line 12, in <module>',
      '  File "<string>", line 3',
      '    print(x',
      '         ^',
      "SyntaxError: '(' was never closed",
    ].join('\n');
    assert.deepEqual(parseCompileErrors('PYTHON', tb), [
      { line: 3, column: 1, endColumn: 1000, message: "SyntaxError: '(' was never closed", severity: 'error' },
    ]);
  });

  it('ignores lines that only look similar', () => {
    assert.deepEqual(parseCompileErrors('C', 'foo.c:1:1: error: not the student file'), []);
  });
});
