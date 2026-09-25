import { describe, expect, it } from 'vitest';
import { prepareJs } from './jsRunner';
import { parseCompileErrors } from '../lib/compileErrors';

describe('prepareJs', () => {
  it('passes valid JavaScript through unchanged', () => {
    const src = 'const a = 1;\nprint(a);\n';
    expect(prepareJs(src, 'JS')).toEqual({ ok: true, js: src, error: '' });
  });

  it('a JS syntax error carries (line:col) so the editor can mark it', () => {
    const res = prepareJs('const x = 1;\nx +* 2;\n', 'JS');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/\(2:\d+\)$/);
    const [marker] = parseCompileErrors('JS', res.error);
    expect(marker).toMatchObject({ line: 2, severity: 'error' });
  });

  it('keeps V8 as the authority: rejected even where sucrase is lenient, just without a position', () => {
    const res = prepareJs('await foo();\n', 'JS');
    expect(res.ok).toBe(false);
    expect(res.error).not.toMatch(/\(\d+:\d+\)/);
  });

  it('TS: type-strips, and a syntax error already has its position', () => {
    expect(prepareJs('const n: number = 1;\n', 'TS').js).toContain('const n = 1');
    const bad = prepareJs('const n: number = ;\n', 'TS');
    expect(bad.ok).toBe(false);
    expect(parseCompileErrors('TS', bad.error)[0]).toMatchObject({ line: 1 });
  });
});
