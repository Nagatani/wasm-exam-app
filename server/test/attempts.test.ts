import { describe, expect, it } from 'vitest';
import {
  attemptDeadline,
  isRegradeCapable,
  isServerExec,
  judgeInputFromContainer,
  judgeLanguage,
} from '../src/lib/attempts';

const START = new Date('2026-09-25T10:00:00.000Z');
const at = (iso: string) => new Date(iso);

describe('attemptDeadline', () => {
  it('startedAt + time limit when there is no closesAt', () => {
    expect(attemptDeadline(START, 60)).toEqual(at('2026-09-25T11:00:00.000Z'));
    expect(attemptDeadline(START, 60, null)).toEqual(at('2026-09-25T11:00:00.000Z'));
  });

  it('clamps to closesAt when it comes first', () => {
    expect(attemptDeadline(START, 60, at('2026-09-25T10:30:00.000Z'))).toEqual(
      at('2026-09-25T10:30:00.000Z'),
    );
  });

  it('uses the time limit when closesAt is later', () => {
    expect(attemptDeadline(START, 60, at('2026-09-25T12:00:00.000Z'))).toEqual(
      at('2026-09-25T11:00:00.000Z'),
    );
  });

  it('extraMinutes extends the time limit', () => {
    expect(attemptDeadline(START, 60, null, 15)).toEqual(at('2026-09-25T11:15:00.000Z'));
  });

  it('extraMinutes also extends the personal closesAt', () => {
    // limit: 10:00 + 75m = 11:15; closesAt 10:30 + 15m = 10:45 → earlier wins.
    expect(attemptDeadline(START, 60, at('2026-09-25T10:30:00.000Z'), 15)).toEqual(
      at('2026-09-25T10:45:00.000Z'),
    );
  });

  it('a start after closesAt yields a deadline already in the past', () => {
    const late = at('2026-09-25T13:00:00.000Z');
    expect(attemptDeadline(late, 60, at('2026-09-25T12:00:00.000Z')).getTime()).toBeLessThan(late.getTime());
  });
});

describe('language routing', () => {
  it('only Java runs server-side in the exam flow', () => {
    expect(isServerExec('JAVA')).toBe(true);
    for (const lang of ['C', 'JS', 'TS', 'PYTHON'] as const) expect(isServerExec(lang)).toBe(false);
  });

  it('Java and C are regrade-capable, the rest are not', () => {
    expect(isRegradeCapable('JAVA')).toBe(true);
    expect(isRegradeCapable('C')).toBe(true);
    for (const lang of ['JS', 'TS', 'PYTHON'] as const) expect(isRegradeCapable(lang)).toBe(false);
  });

  it('judgeLanguage maps to the judge protocol value', () => {
    expect(judgeLanguage('C')).toBe('C');
    expect(judgeLanguage('JAVA')).toBe('JAVA');
  });
});

describe('judgeInputFromContainer', () => {
  const base = { stderr: '', exitCode: 0, timedOut: false, oom: false };

  it('compile failure → compileFailed with no outcomes', () => {
    expect(
      judgeInputFromContainer({ compile: { ok: false, stderr: 'error' }, results: [] }),
    ).toEqual({ compileFailed: true, outcomes: [] });
  });

  it('maps timedOut / oom / non-zero exit / success to stages', () => {
    const input = judgeInputFromContainer({
      compile: { ok: true, stderr: '' },
      results: [
        { ...base, id: 'a', stdout: 'ok' },
        { ...base, id: 'b', stdout: '', timedOut: true, exitCode: 137 },
        { ...base, id: 'c', stdout: '', oom: true, exitCode: 1 },
        { ...base, id: 'd', stdout: 'partial', exitCode: 1 },
      ],
    });
    expect(input.compileFailed).toBe(false);
    expect(input.outcomes).toEqual([
      { testCaseId: 'a', stage: 'success', stdout: 'ok' },
      { testCaseId: 'b', stage: 'tle', stdout: '' },
      { testCaseId: 'c', stage: 'mle', stdout: '' },
      { testCaseId: 'd', stage: 'runtime_error', stdout: 'partial' },
    ]);
  });

  it('timedOut wins over oom', () => {
    const input = judgeInputFromContainer({
      compile: { ok: true, stderr: '' },
      results: [{ ...base, id: 'x', stdout: '', timedOut: true, oom: true }],
    });
    expect(input.outcomes[0].stage).toBe('tle');
  });
});
