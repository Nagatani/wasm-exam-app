import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { type JudgeInput } from './judge';
import { isJudgeConfigured, runOnJudge, JudgeError } from './judgeClient';
import { withJudgeSlot, QueueRejectedError } from './executionQueue';
import { isServerExec } from './attempts';

// Shared by the exam flow (server/src/routes/student.ts) and practice mode
// (server/src/routes/practice.ts) — both need to turn a student's request
// body into a judge-able { compileFailed, outcomes } input the exact same
// way, dispatching on whether the task's language runs in the browser
// (client reports outcomes) or in the judge container (server runs it).
// Extracted so neither flow reimplements or drifts from the other.

export const MAX_CODE_LENGTH = 200_000;

export const outcomeSchema = z.object({
  testCaseId: z.string(),
  stage: z.enum(['success', 'runtime_error', 'tle', 'mle']),
  stdout: z.string(),
});

export const clientExecSchema = z.object({
  compileFailed: z.boolean(),
  outcomes: z.array(outcomeSchema),
});
export const serverExecSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LENGTH),
});

export class RunRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type TaskWithTestCases = Prisma.TaskGetPayload<{ include: { testCases: true } }>;

export interface ResolvedOutcomes {
  judgeInput: JudgeInput;
  compileStderr: string;
}

export async function resolveOutcomes(
  body: unknown,
  task: TaskWithTestCases,
  userId: string,
): Promise<ResolvedOutcomes> {
  if (!isServerExec(task.language)) {
    const parsed = clientExecSchema.safeParse(body);
    if (!parsed.success) {
      throw new RunRequestError(400, parsed.error.issues[0]?.message ?? 'invalid_request');
    }
    return {
      judgeInput: { compileFailed: parsed.data.compileFailed, outcomes: parsed.data.outcomes },
      compileStderr: '',
    };
  }

  if (!isJudgeConfigured()) {
    throw new RunRequestError(503, 'この言語の実行環境が現在利用できません。');
  }
  const parsed = serverExecSchema.safeParse(body);
  if (!parsed.success) {
    throw new RunRequestError(400, parsed.error.issues[0]?.message ?? 'invalid_request');
  }

  const tests = task.testCases.map((tc) => ({
    id: tc.id,
    stdin: tc.input,
    timeLimitMs: tc.timeLimitMs,
    memoryLimitMb: tc.memoryLimitMb,
  }));

  let judgeResult;
  try {
    judgeResult = await withJudgeSlot(userId, () => runOnJudge({ code: parsed.data.code, tests }));
  } catch (err) {
    if (err instanceof QueueRejectedError) {
      throw new RunRequestError(429, err.message);
    }
    if (err instanceof JudgeError) {
      throw new RunRequestError(
        502,
        '実行環境でエラーが発生しました。しばらくして再度お試しください。',
      );
    }
    throw err;
  }

  if (!judgeResult.compile.ok) {
    return {
      judgeInput: { compileFailed: true, outcomes: [] },
      compileStderr: judgeResult.compile.stderr,
    };
  }

  const outcomes = judgeResult.results.map((r) => ({
    testCaseId: r.id,
    stage: r.timedOut
      ? ('tle' as const)
      : r.oom
        ? ('mle' as const)
        : (r.exitCode ?? 1) !== 0
          ? ('runtime_error' as const)
          : ('success' as const),
    stdout: r.stdout,
  }));

  return { judgeInput: { compileFailed: false, outcomes }, compileStderr: '' };
}
