import { describe, expect, it } from 'vitest'
import { parseCompileErrors } from './compileErrors'

describe('parseCompileErrors', () => {
  it('returns nothing for empty stderr', () => {
    expect(parseCompileErrors('C', '')).toEqual([])
  })

  it('C (clang/gcc): every located diagnostic, with severity', () => {
    const stderr = [
      "/tmp/x/main.c:5:3: error: expected ';' after expression",
      '    x = 1',
      "main.c:7:10: warning: unused variable 'y' [-Wunused-variable]",
      'main.c:7:10: note: something',
      '1 error generated.',
    ].join('\n')
    expect(parseCompileErrors('C', stderr)).toEqual([
      { line: 5, column: 3, message: "expected ';' after expression", severity: 'error' },
      { line: 7, column: 10, message: "unused variable 'y' [-Wunused-variable]", severity: 'warning' },
      { line: 7, column: 10, message: 'something', severity: 'warning' },
    ])
  })

  it('Java (javac): whole-line markers', () => {
    expect(parseCompileErrors('JAVA', "Main.java:3: error: ';' expected\n  int x = 1\n")).toEqual([
      { line: 3, column: 1, endColumn: 1000, message: "';' expected", severity: 'error' },
    ])
  })

  it('JS/TS: first (line:col) hit, column converted to 1-based', () => {
    const markers = parseCompileErrors('TS', 'SyntaxError: Unexpected token (2:4)\nother (9:9)')
    expect(markers).toEqual([
      { line: 2, column: 5, message: 'SyntaxError: Unexpected token (2:4)', severity: 'error' },
    ])
  })

  it('JS without a location yields no marker', () => {
    expect(parseCompileErrors('JS', 'SyntaxError: Unexpected end of input')).toEqual([])
  })

  it('Python: last line number + the error message', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "<exec>", line 12, in <module>',
      '  File "<string>", line 3',
      '    print(x',
      '         ^',
      "SyntaxError: '(' was never closed",
    ].join('\n')
    expect(parseCompileErrors('PYTHON', tb)).toEqual([
      { line: 3, column: 1, endColumn: 1000, message: "SyntaxError: '(' was never closed", severity: 'error' },
    ])
  })

  it('ignores lines that only look similar', () => {
    expect(parseCompileErrors('C', 'foo.c:1:1: error: not the student file')).toEqual([])
  })
})
