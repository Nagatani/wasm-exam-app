import { describe, expect, it } from 'vitest';
import type { $Enums } from '@prisma/client';
import type { OverallStatus, PerTestCaseResult as ServerResult, PerTestCaseStatus } from '../src/lib/judge';
import type {
  PerTestCaseResult as StudentResult,
  PerTestCaseStatus as StudentStatus,
  OverallStatus as StudentOverall,
} from '../../src/types/student';
import type {
  ComparisonMode as FrontendComparisonMode,
  Language as FrontendLanguage,
  SubmissionDetailResult,
  SubmissionOverallStatus,
} from '../../src/types/exam';

// The server and the frontend are separate npm projects with no shared
// package, so a few wire types are declared on both sides by hand (see
// CLAUDE.md "Non-revealing WA hints"). These compile-time assertions make
// `npm run typecheck:test` (and CI) fail the moment one copy drifts — e.g. a
// field or enum value added on one side only. Nothing here runs meaningfully
// at runtime; the `it` just gives vitest something to report.

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
function assertType<_T extends true>(): void {}

// Per-test-case judge result: server lib/judge.ts ↔ student run preview ↔
// teacher submission detail.
assertType<Equals<ServerResult, StudentResult>>();
assertType<Equals<ServerResult, SubmissionDetailResult>>();
assertType<Equals<PerTestCaseStatus, StudentStatus>>();

// Overall verdicts: judge.ts ↔ Prisma enum ↔ both frontend copies.
assertType<Equals<OverallStatus, $Enums.SubmissionStatus>>();
assertType<Equals<OverallStatus, StudentOverall>>();
assertType<Equals<OverallStatus, SubmissionOverallStatus>>();

// DB enums mirrored as frontend string unions.
assertType<Equals<$Enums.ComparisonMode, FrontendComparisonMode>>();
assertType<Equals<$Enums.Language, FrontendLanguage>>();

describe('server ↔ frontend wire types', () => {
  it('are kept identical (checked at compile time by typecheck:test)', () => {
    expect(true).toBe(true);
  });
});
