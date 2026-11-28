import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildErrorExplainContext,
  buildErrorExplainSystemPrompt,
  ERROR_EXPLAIN_NO_CODE_RULE,
  extractCodeSnippet,
  hasExplainableError,
  type ErrorExplainContext,
} from './aiErrorExplainContext.ts';

function makeCtx(overrides: Partial<ErrorExplainContext> = {}): ErrorExplainContext {
  return {
    language: 'C',
    code: [
      '#include <stdio.h>',
      'int main(void) {',
      '  int a = 0;',
      '  printf("%d\\n", a)',
      '  return 0;',
      '}',
    ].join('\n'),
    compileStderr: "main.c:4:20: error: expected ';' after expression",
    verdict: {
      overallStatus: 'CE',
      score: 0,
      results: [],
    },
    ...overrides,
  };
}

describe('hasExplainableError', () => {
  it('returns false for null verdict or AC/WA without runtime errors', () => {
    assert.equal(hasExplainableError(null, null), false);
    assert.equal(
      hasExplainableError({ overallStatus: 'AC', score: 100, results: [] }, null),
      false,
    );
    assert.equal(
      hasExplainableError(
        {
          overallStatus: 'WA',
          score: 0,
          results: [{ testCaseId: '1', isSample: true, status: 'WA', actualOutput: 'wrong' }],
        },
        null,
      ),
      false,
    );
  });

  it('returns true for CE, TLE, MLE, and per-test RE/TLE/MLE', () => {
    assert.equal(
      hasExplainableError({ overallStatus: 'CE', score: 0, results: [] }, 'syntax error'),
      true,
    );
    assert.equal(
      hasExplainableError({ overallStatus: 'TLE', score: 0, results: [] }, null),
      true,
    );
    assert.equal(
      hasExplainableError({ overallStatus: 'MLE', score: 0, results: [] }, null),
      true,
    );
    assert.equal(
      hasExplainableError(
        {
          overallStatus: 'WA',
          score: 0,
          results: [{ testCaseId: 'h1', isSample: false, status: 'RE', actualOutput: 'SECRET' }],
        },
        null,
      ),
      true,
    );
  });
});

describe('buildErrorExplainContext', () => {
  it('includes compileStderr and line-numbered surrounding code for CE', () => {
    const text = buildErrorExplainContext(makeCtx());
    assert.ok(text.includes('コンパイル／構文エラー'));
    assert.ok(text.includes("expected ';' after expression"));
    assert.ok(text.includes('4:   printf("%d\\n", a)'));
  });

  it('truncates very long compileStderr to at most 2000 characters', () => {
    const text = buildErrorExplainContext(makeCtx({ compileStderr: 'E'.repeat(5000) }));
    assert.ok((text.match(/E/g)?.length ?? 0) <= 2000 + 5);
  });

  it('NEVER includes hidden test outputs or hidden hints even on RE/TLE/MLE', () => {
    const text = buildErrorExplainContext(
      makeCtx({
        compileStderr: null,
        verdict: {
          overallStatus: 'WA',
          score: 0,
          results: [
            {
              testCaseId: 's1',
              isSample: true,
              status: 'RE',
              actualOutput: 'SAMPLE_RE_OUTPUT',
            },
            {
              testCaseId: 'h1',
              isSample: false,
              status: 'RE',
              actualOutput: 'HIDDEN_SECRET_ACTUAL_OUTPUT',
              hint: 'HIDDEN_SECRET_HINT',
            },
            {
              testCaseId: 'h2',
              isSample: false,
              status: 'WA',
              actualOutput: 'HIDDEN_WA_OUTPUT',
              hint: 'HIDDEN_WA_HINT',
            },
          ],
        },
      }),
    );
    assert.ok(text.includes('SAMPLE_RE_OUTPUT'));
    assert.ok(text.includes('非公開テストケースで実行時エラー（RE）が発生しました'));
    assert.ok(!text.includes('HIDDEN_SECRET_ACTUAL_OUTPUT'));
    assert.ok(!text.includes('HIDDEN_SECRET_HINT'));
    assert.ok(!text.includes('HIDDEN_WA_OUTPUT'));
    assert.ok(!text.includes('HIDDEN_WA_HINT'));
  });

  it('extracts a narrow window around the referenced error line', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `int v${i + 1} = ${i + 1};`).join('\n');
    const snippet = extractCodeSnippet(lines, 'main.c:25:5: error: boom');
    assert.ok(snippet.includes('25: int v25 = 25;'));
    assert.ok(!snippet.includes('1: int v1 = 1;'));
    assert.ok(!snippet.includes('40: int v40 = 40;'));
  });
});

describe('buildErrorExplainSystemPrompt', () => {
  it('enforces NO_CODE_RULE on initial and retry attempts', () => {
    const first = buildErrorExplainSystemPrompt('C', 0);
    const retry = buildErrorExplainSystemPrompt('C', 1);
    assert.ok(first.includes(ERROR_EXPLAIN_NO_CODE_RULE));
    assert.ok(retry.includes(ERROR_EXPLAIN_NO_CODE_RULE));
    assert.ok(retry.includes('却下されました'));
  });
});
