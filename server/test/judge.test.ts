import { describe, expect, it } from 'vitest';
import {
  judgeSubmission,
  type ClientTestCaseOutcome,
  type Comparison,
} from '../src/lib/judge';

const EXACT: Comparison = { mode: 'EXACT', floatTolerance: 1e-6 };

// Three test cases: one sample, two hidden. Every expected output is "ok".
const TEST_CASES = [
  { id: 't1', expectedOutput: 'ok', isSample: true },
  { id: 't2', expectedOutput: 'ok', isSample: false },
  { id: 't3', expectedOutput: 'ok', isSample: false },
];

function outcome(
  testCaseId: string,
  stdout = 'ok',
  stage: ClientTestCaseOutcome['stage'] = 'success',
): ClientTestCaseOutcome {
  return { testCaseId, stage, stdout };
}

function judge(outcomes: ClientTestCaseOutcome[], opts: { partial?: boolean; points?: number; cmp?: Comparison } = {}) {
  return judgeSubmission(
    TEST_CASES,
    opts.points ?? 10,
    { compileFailed: false, outcomes },
    opts.cmp ?? EXACT,
    opts.partial ?? false,
  );
}

describe('judgeSubmission: overall status', () => {
  it('all passing → AC with full points', () => {
    const v = judge([outcome('t1'), outcome('t2'), outcome('t3')]);
    expect(v.overallStatus).toBe('AC');
    expect(v.score).toBe(10);
    expect(v.results.map((r) => r.status)).toEqual(['AC', 'AC', 'AC']);
  });

  it('compile failure → CE, no results, 0 points even with partial credit', () => {
    const v = judgeSubmission(TEST_CASES, 10, { compileFailed: true, outcomes: [] }, EXACT, true);
    expect(v).toEqual({ overallStatus: 'CE', results: [], score: 0 });
  });

  it('a missing outcome counts as WA with empty output', () => {
    const v = judge([outcome('t1'), outcome('t2')]);
    expect(v.overallStatus).toBe('WA');
    expect(v.results[2]).toMatchObject({ testCaseId: 't3', status: 'WA', actualOutput: '' });
  });

  it('maps runtime stages to per-test statuses and keeps partial stdout', () => {
    const v = judge([
      outcome('t1', 'partial', 'runtime_error'),
      outcome('t2', '', 'tle'),
      outcome('t3', '', 'mle'),
    ]);
    expect(v.results.map((r) => r.status)).toEqual(['RE', 'TLE', 'MLE']);
    expect(v.results[0].actualOutput).toBe('partial');
  });

  it('RE rolls into overall WA (RE is not a SubmissionStatus)', () => {
    const v = judge([outcome('t1'), outcome('t2', '', 'runtime_error'), outcome('t3')]);
    expect(v.overallStatus).toBe('WA');
  });

  it('overall TLE only when every failing test is TLE', () => {
    expect(judge([outcome('t1'), outcome('t2', '', 'tle'), outcome('t3', '', 'tle')]).overallStatus).toBe('TLE');
    expect(judge([outcome('t1'), outcome('t2', '', 'tle'), outcome('t3', 'ng')]).overallStatus).toBe('WA');
  });

  it('overall MLE only when every failing test is MLE', () => {
    expect(judge([outcome('t1'), outcome('t2', '', 'mle'), outcome('t3')]).overallStatus).toBe('MLE');
    expect(judge([outcome('t1'), outcome('t2', '', 'mle'), outcome('t3', '', 'tle')]).overallStatus).toBe('WA');
  });

  it('ignores outcomes for unknown test case ids', () => {
    const v = judge([outcome('t1'), outcome('t2'), outcome('t3'), outcome('bogus', 'x')]);
    expect(v.overallStatus).toBe('AC');
    expect(v.results).toHaveLength(3);
  });

  it('uses the task comparison mode', () => {
    const outs = [outcome('t1', 'ok  \n'), outcome('t2', 'ok'), outcome('t3', 'ok')];
    expect(judge([outcome('t1', 'ok \nx'), outs[1], outs[2]]).overallStatus).toBe('WA');
    expect(judge(outs, { cmp: { mode: 'TRIM_TRAILING_WS', floatTolerance: 1e-6 } }).overallStatus).toBe('AC');
  });

  it('carries isSample through to results', () => {
    const v = judge([outcome('t1'), outcome('t2'), outcome('t3')]);
    expect(v.results.map((r) => r.isSample)).toEqual([true, false, false]);
  });
});

describe('judgeSubmission: scoring', () => {
  it('all-or-nothing by default: 2/3 passing → 0', () => {
    const v = judge([outcome('t1'), outcome('t2'), outcome('t3', 'ng')]);
    expect(v.overallStatus).toBe('WA');
    expect(v.score).toBe(0);
  });

  it('partial credit: proportional and rounded (2/3 of 10 → 7)', () => {
    const v = judge([outcome('t1'), outcome('t2'), outcome('t3', 'ng')], { partial: true });
    expect(v.overallStatus).toBe('WA');
    expect(v.score).toBe(7);
  });

  it('partial credit: 1/3 of 10 → 3, 0/3 → 0, 3/3 → full', () => {
    expect(judge([outcome('t1'), outcome('t2', 'ng'), outcome('t3', 'ng')], { partial: true }).score).toBe(3);
    expect(judge([outcome('t1', 'ng'), outcome('t2', 'ng'), outcome('t3', 'ng')], { partial: true }).score).toBe(0);
    expect(judge([outcome('t1'), outcome('t2'), outcome('t3')], { partial: true }).score).toBe(10);
  });

  it('partial credit counts TLE/RE tests as not passed', () => {
    const v = judge([outcome('t1'), outcome('t2', '', 'tle'), outcome('t3', '', 'tle')], { partial: true, points: 9 });
    expect(v.overallStatus).toBe('TLE');
    expect(v.score).toBe(3);
  });

  it('partial credit with zero test cases → 0', () => {
    const v = judgeSubmission([], 10, { compileFailed: false, outcomes: [] }, EXACT, true);
    expect(v.score).toBe(0);
  });
});

describe('judgeSubmission: non-revealing WA hints', () => {
  function hintFor(expected: string, actual: string, cmp: Comparison = EXACT) {
    const v = judgeSubmission(
      [{ id: 'h', expectedOutput: expected, isSample: false }],
      1,
      { compileFailed: false, outcomes: [outcome('h', actual)] },
      cmp,
    );
    return v.results[0];
  }

  it('trailing whitespace difference', () => {
    expect(hintFor('a\nb', 'a \nb').hint).toBe('行末の空白や改行の違いの可能性があります。');
  });

  it('blank line difference (checked before the line-count fallback)', () => {
    expect(hintFor('a\nb', 'a\n\nb').hint).toBe('空行の有無や位置の違いの可能性があります。');
  });

  it('case difference', () => {
    expect(hintFor('YES', 'yes').hint).toBe('大文字・小文字の違いの可能性があります。');
  });

  it('line count difference as the last resort', () => {
    expect(hintFor('1\n2', '1 2').hint).toBe('出力の行数が期待と異なります。');
  });

  it('no hint for a genuinely wrong answer with the same shape', () => {
    const r = hintFor('42', '41');
    expect(r.status).toBe('WA');
    expect(r.hint).toBeUndefined();
  });

  it('no hint on AC', () => {
    expect(hintFor('ok', 'ok').hint).toBeUndefined();
  });

  it('no hint on RE/TLE/MLE or a missing outcome', () => {
    const v = judge([outcome('t1', 'OK', 'runtime_error'), outcome('t2', 'OK', 'tle')]);
    expect(v.results.map((r) => r.hint)).toEqual([undefined, undefined, undefined]);
  });

  it('skips the mode the task already uses and tries the next looser one', () => {
    // Under TRIM_TRAILING_WS this still fails (inner blank line); the hint
    // must come from IGNORE_BLANK_LINES, not re-report the trailing-ws one.
    const r = hintFor('a\nb', 'a  \n\nb', { mode: 'TRIM_TRAILING_WS', floatTolerance: 1e-6 });
    expect(r.hint).toBe('空行の有無や位置の違いの可能性があります。');
  });

  it('never includes the expected output in the hint', () => {
    const secret = 'SECRET_EXPECTED_VALUE';
    const r = hintFor(secret, secret.toLowerCase());
    expect(r.hint).toBeDefined();
    expect(r.hint).not.toContain(secret);
    expect(r.hint).not.toContain(secret.toLowerCase());
  });
});
