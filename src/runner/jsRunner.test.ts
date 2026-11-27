import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareJs } from './jsRunner.ts';
import { parseCompileErrors } from '../lib/compileErrors.ts';

describe('prepareJs', () => {
  it('passes valid JavaScript through unchanged', () => {
    const src = 'const a = 1;\nprint(a);\n';
    assert.deepEqual(prepareJs(src, 'JS'), { ok: true, js: src, error: '' });
  });

  it('a JS syntax error carries (line:col) so the editor can mark it', () => {
    const res = prepareJs('const x = 1;\nx +* 2;\n', 'JS');
    assert.equal(res.ok, false);
    assert.match(res.error, /\(2:\d+\)$/);
    const [marker] = parseCompileErrors('JS', res.error);
    assert.equal(marker.line, 2);
    assert.equal(marker.severity, 'error');
  });

  it('keeps V8 as the authority: rejected even where sucrase is lenient, just without a position', () => {
    const res = prepareJs('await foo();\n', 'JS');
    assert.equal(res.ok, false);
    assert.doesNotMatch(res.error, /\(\d+:\d+\)/);
  });

  it('TS: type-strips, and a syntax error already has its position', () => {
    assert.ok(prepareJs('const n: number = 1;\n', 'TS').js.includes('const n = 1'));
    const bad = prepareJs('const n: number = ;\n', 'TS');
    assert.equal(bad.ok, false);
    assert.equal(parseCompileErrors('TS', bad.error)[0].line, 1);
  });
});
