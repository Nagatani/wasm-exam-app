import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCodeReviewSystemPrompt,
  buildCodeReviewUserPrompt,
  type CodeReviewContext,
} from './aiCodeReviewContext.ts';

describe('buildCodeReviewUserPrompt', () => {
  it('includes statementMarkdown and student AC code with language label', () => {
    const ctx: CodeReviewContext = {
      language: 'PYTHON',
      statementMarkdown: '2つの整数の和を出力せよ。',
      code: 'a, b = map(int, input().split())\nprint(a + b)',
    };
    const prompt = buildCodeReviewUserPrompt(ctx, 'Python');
    assert.ok(prompt.includes('2つの整数の和を出力せよ。'));
    assert.ok(prompt.includes('print(a + b)'));
    assert.ok(prompt.includes('Python'));
  });

  it('never includes hidden test expected outputs or extra properties passed at runtime', () => {
    const polluted = {
      language: 'C' as const,
      statementMarkdown: '正の整数Nの2倍を出力せよ。',
      code: 'int main(){return 0;}',
      // Simulate accidental extra fields with hidden test data or reference solution
      testCases: [
        { input: 'HIDDEN_IN', expectedOutput: 'HIDDEN_EXPECTED_SECRET', isSample: false },
      ],
      solutionCode: 'TEACHER_SECRET_SOLUTION',
    };
    const prompt = buildCodeReviewUserPrompt(polluted, 'C');
    assert.ok(!prompt.includes('HIDDEN_IN'));
    assert.ok(!prompt.includes('HIDDEN_EXPECTED_SECRET'));
    assert.ok(!prompt.includes('TEACHER_SECRET_SOLUTION'));
  });

  it('caps oversized statement and code inputs', () => {
    const prompt = buildCodeReviewUserPrompt(
      {
        language: 'JS',
        statementMarkdown: 'X'.repeat(5000),
        code: 'Y'.repeat(10000),
      },
      'JavaScript',
    );
    assert.ok((prompt.match(/X/g)?.length ?? 0) <= 3000);
    assert.ok((prompt.match(/Y/g)?.length ?? 0) <= 6000);
  });
});

describe('buildCodeReviewSystemPrompt', () => {
  it('instructs concise review covering readability, edge cases, and complexity', () => {
    const system = buildCodeReviewSystemPrompt('TypeScript');
    assert.ok(system.includes('TypeScript'));
    assert.ok(system.includes('可読性'));
    assert.ok(system.includes('境界条件'));
    assert.ok(system.includes('計算量'));
    assert.ok(system.includes('良い点'));
    assert.ok(system.includes('改善のヒント'));
  });
});
