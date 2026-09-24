import { describe, expect, it } from 'vitest';
import { compareOutput as serverCompare } from '../src/lib/judge';
import { compareOutput as clientCompare } from '../../src/lib/compareOutput';
import { COMPARE_CASES } from './fixtures/compareOutputCases';

const DEFAULT_TOLERANCE = 1e-6;

describe('compareOutput (server, authoritative)', () => {
  it.each(COMPARE_CASES)('$name', (c) => {
    const floatTolerance = c.floatTolerance ?? DEFAULT_TOLERANCE;
    expect(serverCompare(c.expected, c.actual, { mode: c.mode, floatTolerance })).toBe(c.match);
  });
});

describe('compareOutput (client mirror in src/lib/compareOutput.ts)', () => {
  it.each(COMPARE_CASES)('$name', (c) => {
    const floatTolerance = c.floatTolerance ?? DEFAULT_TOLERANCE;
    expect(clientCompare(c.expected, c.actual, c.mode, floatTolerance)).toBe(c.match);
  });
});
