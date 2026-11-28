import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildMisconceptionSystemPrompt,
  buildMisconceptionUserPrompt,
  clusterAnonymizedSamples,
  sanitizeSubmissionForMisconception,
  type AnonymizedFailureSample,
} from './aiMisconceptionContext.ts';

describe('sanitizeSubmissionForMisconception', () => {
  it('strips studentNumber, displayName, studentId, and other PII fields', () => {
    const sample = sanitizeSubmissionForMisconception(
      {
        studentId: 'user-secret-123',
        studentNumber: '20260001',
        displayName: '山田 太郎',
        email: 'taro@example.edu',
        status: 'WA',
        language: 'C',
        code: '// 20260001 山田 太郎\nint main() { return 0; }',
        failingTestHints: ['行末の空白の違い', '20260001 用のメモ'],
      },
      ['20260001', '山田 太郎'],
    );

    assert.ok(sample !== null);
    assert.equal(sample.status, 'WA');
    assert.equal(sample.language, 'C');
    const serialized = JSON.stringify(sample);
    assert.ok(!serialized.includes('user-secret-123'));
    assert.ok(!serialized.includes('20260001'));
    assert.ok(!serialized.includes('山田 太郎'));
    assert.ok(!serialized.includes('taro@example.edu'));
    assert.ok(sample.code?.includes('[匿名]'));
  });

  it('rejects AC and unknown statuses', () => {
    assert.equal(sanitizeSubmissionForMisconception({ status: 'AC', code: 'x' }), null);
    assert.equal(sanitizeSubmissionForMisconception({ status: 'UNKNOWN', code: 'x' }), null);
    assert.equal(sanitizeSubmissionForMisconception({}), null);
  });
});

describe('clusterAnonymizedSamples', () => {
  it('clusters whitespace-equivalent code and sorts by frequency descending', () => {
    const samples: AnonymizedFailureSample[] = [
      { status: 'CE', code: 'int main() { missing }' },
      { status: 'WA', code: 'int main() {\n  printf("0");\n}' },
      { status: 'WA', code: 'int main() {   printf("0"); }' },
      { status: 'WA', code: 'int main() {\tprintf("0");\n}', failingTestHints: ['改行の違い'] },
    ];
    const clusters = clusterAnonymizedSamples(samples);
    assert.equal(clusters.length, 2);
    assert.equal(clusters[0].status, 'WA');
    assert.equal(clusters[0].count, 3);
    assert.deepEqual(clusters[0].failingTestHints, ['改行の違い']);
    assert.equal(clusters[1].status, 'CE');
    assert.equal(clusters[1].count, 1);
  });

  it('respects maxClusters and maxCodeChars', () => {
    const samples: AnonymizedFailureSample[] = Array.from({ length: 12 }, (_, i) => ({
      status: 'WA',
      code: `code_${i}_${'x'.repeat(1000)}`,
    }));
    const clusters = clusterAnonymizedSamples(samples, 5, 100);
    assert.equal(clusters.length, 5);
    for (const c of clusters) {
      assert.ok(c.code.length <= 100);
    }
  });
});

describe('buildMisconceptionUserPrompt', () => {
  it('includes task stats and clustered samples while never leaking PII', () => {
    const rawSubmissions = [
      {
        studentId: 'stu-1',
        studentNumber: 'S24001',
        displayName: '佐藤 花子',
        status: 'WA',
        language: 'PYTHON',
        code: '# S24001 佐藤 花子\nprint(input())',
        failingTestHints: ['末尾空白の不一致'],
      },
      {
        studentId: 'stu-2',
        studentNumber: 'S24002',
        displayName: '鈴木 一郎',
        status: 'CE',
        language: 'PYTHON',
        code: 'def main(\n  pass',
      },
    ];

    const sanitized = rawSubmissions
      .map((r) =>
        sanitizeSubmissionForMisconception(r, [r.studentNumber, r.displayName, r.studentId]),
      )
      .filter((s): s is AnonymizedFailureSample => s !== null);

    const prompt = buildMisconceptionUserPrompt(
      {
        taskTitle: '配列の最大値',
        language: 'PYTHON',
        totalStudents: 30,
        statusCounts: { AC: 20, WA: 5, CE: 3, TLE: 0, MLE: 0, unsubmitted: 2 },
        samples: sanitized,
      },
      'Python',
    );

    assert.ok(prompt.includes('配列の最大値'));
    assert.ok(prompt.includes('AC=20名'));
    assert.ok(prompt.includes('WA=5名'));
    assert.ok(prompt.includes('CE=3名'));
    assert.ok(prompt.includes('パターン1'));
    assert.ok(!prompt.includes('stu-1'));
    assert.ok(!prompt.includes('stu-2'));
    assert.ok(!prompt.includes('S24001'));
    assert.ok(!prompt.includes('S24002'));
    assert.ok(!prompt.includes('佐藤 花子'));
    assert.ok(!prompt.includes('鈴木 一郎'));

    const system = buildMisconceptionSystemPrompt();
    assert.ok(system.includes('匿名'));
  });
});
