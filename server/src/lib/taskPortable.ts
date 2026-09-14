import { z } from 'zod';
import { languageSchema } from './language';

// JSON export/import shape for a task (statement, test cases, reference
// solutions). Used by both GET /api/tasks/:taskId/export (writes this) and
// POST /api/exams/:examId/tasks/import (validates this) — the shared schema
// keeps the two from drifting apart. Always wrapped as a `tasks` array, even
// for a single-task export, so a future bulk export (e.g. a whole exam) can
// reuse the same envelope without a breaking format change.
export const PORTABLE_TASK_FORMAT = 'wasm-exam-task/v1';

const comparisonModeSchema = z.enum([
  'EXACT',
  'TRIM_TRAILING_WS',
  'IGNORE_BLANK_LINES',
  'FLOAT',
]);

const portableTestCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
  isSample: z.boolean(),
  order: z.number().int(),
  timeLimitMs: z.number().int().positive(),
  memoryLimitMb: z.number().int().positive(),
});

const portableSolutionSchema = z.object({
  language: languageSchema,
  code: z.string(),
});

export const portableTaskSchema = z
  .object({
    title: z.string().min(1),
    statementMarkdown: z.string(),
    language: languageSchema,
    starterCode: z.string().nullable(),
    points: z.number().int().nonnegative(),
    comparisonMode: comparisonModeSchema,
    floatTolerance: z.number().positive(),
    allowPartialCredit: z.boolean(),
    tags: z.array(z.string()).default([]),
    testCases: z.array(portableTestCaseSchema),
    solutions: z.array(portableSolutionSchema),
  })
  // `Solution` is @@unique([taskId, language]) — reject a file that would
  // violate that at insert time rather than letting Prisma 500 partway
  // through creating the task.
  .refine((t) => new Set(t.solutions.map((s) => s.language)).size === t.solutions.length, {
    message: '同じ言語の解答例が複数含まれています。',
    path: ['solutions'],
  });

export const portableTaskFileSchema = z.object({
  format: z.literal(PORTABLE_TASK_FORMAT),
  tasks: z.array(portableTaskSchema).min(1).max(200),
});

export type PortableTask = z.infer<typeof portableTaskSchema>;
