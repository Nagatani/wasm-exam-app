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
  'IGNORE_CASE',
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
    // Defaulted (not required) so a file exported before this field existed
    // still validates.
    aiHintEnabled: z.boolean().default(false),
    aiHintMaxStage: z.number().int().min(1).max(3).default(3),
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

// Exam-level portable JSON export/import shape (exam metadata + all tasks).
// Used by GET /api/exams/:examId/export and POST /api/exams/import.
export const PORTABLE_EXAM_SCHEMA = 'wasm-exam/v1';

const portableExamMetaSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().nullable().default(null),
    mode: z.enum(['EXAM', 'PRACTICE']).default('EXAM'),
    timeLimitMinutes: z.number().int().positive().nullable().default(null),
    maxAttempts: z.number().int().positive().nullable().default(1),
    defaultLanguage: languageSchema.default('C'),
  })
  .superRefine((data, ctx) => {
    if (data.mode !== 'PRACTICE' && data.timeLimitMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '制限時間は1分以上で入力してください。',
        path: ['timeLimitMinutes'],
      });
    }
  });

export const portableExamSchema = z.object({
  format: z.literal(PORTABLE_EXAM_SCHEMA),
  exam: portableExamMetaSchema,
  tasks: z.array(portableTaskSchema).max(200),
});

export type PortableExam = z.infer<typeof portableExamSchema>;

export interface PortableExamSource {
  title: string;
  description: string | null;
  mode: 'EXAM' | 'PRACTICE';
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  defaultLanguage: PortableTask['language'];
  tasks: Array<{
    title: string;
    statementMarkdown: string;
    language: PortableTask['language'];
    starterCode: string | null;
    points: number;
    comparisonMode: PortableTask['comparisonMode'];
    floatTolerance: number;
    allowPartialCredit: boolean;
    tags: string[];
    aiHintEnabled: boolean;
    aiHintMaxStage: number;
    testCases: Array<{
      input: string;
      expectedOutput: string;
      isSample: boolean;
      order: number;
      timeLimitMs: number;
      memoryLimitMb: number;
    }>;
    solutions: Array<{
      language: PortableTask['language'];
      code: string;
    }>;
  }>;
}

export function toPortableExam(src: PortableExamSource): PortableExam {
  return {
    format: PORTABLE_EXAM_SCHEMA,
    exam: {
      title: src.title,
      description: src.description,
      mode: src.mode,
      timeLimitMinutes: src.mode === 'PRACTICE' ? null : src.timeLimitMinutes,
      maxAttempts: src.mode === 'PRACTICE' ? null : src.maxAttempts,
      defaultLanguage: src.defaultLanguage,
    },
    tasks: src.tasks.map((t) => ({
      title: t.title,
      statementMarkdown: t.statementMarkdown,
      language: t.language,
      starterCode: t.starterCode,
      points: t.points,
      comparisonMode: t.comparisonMode,
      floatTolerance: t.floatTolerance,
      allowPartialCredit: t.allowPartialCredit,
      tags: t.tags,
      aiHintEnabled: t.aiHintEnabled,
      aiHintMaxStage: t.aiHintMaxStage,
      testCases: t.testCases.map((tc) => ({
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isSample: tc.isSample,
        order: tc.order,
        timeLimitMs: tc.timeLimitMs,
        memoryLimitMb: tc.memoryLimitMb,
      })),
      solutions: t.solutions.map((s) => ({
        language: s.language,
        code: s.code,
      })),
    })),
  };
}

export function parsePortableExam(raw: unknown) {
  return portableExamSchema.safeParse(raw);
}
