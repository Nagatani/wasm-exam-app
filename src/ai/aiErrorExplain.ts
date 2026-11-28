import type { InitProgressReport, MLCEngineInterface } from '@mlc-ai/web-llm';
import {
  beginWebLlmGeneration,
  endWebLlmGeneration,
  GenerationAbortedError,
  loadWebLlmEngine,
} from './webllmEngine';
import {
  buildErrorExplainContext,
  buildErrorExplainSystemPrompt,
  type ErrorExplainContext,
} from './aiErrorExplainContext';
import { looksLikeCode } from './aiHintContext';
import { LANGUAGE_LABEL } from '../lib/language';

export {
  hasExplainableError,
  type ErrorExplainContext,
} from './aiErrorExplainContext';

export interface ExplainErrorOptions {
  onProgress?: (report: InitProgressReport) => void;
  onDelta?: (textSoFar: string) => void;
  signal?: AbortSignal;
}

const GENERATE_FAILURE_MESSAGE = 'エラー解説の生成に失敗しました。もう一度お試しください。';
const CONTAINS_CODE_MESSAGE =
  'AIの解説にコードの一部が含まれていた可能性があるため表示を取り消しました。もう一度お試しください。';
const MAX_ATTEMPTS = 2;

async function requestErrorExplainOnce(
  engine: MLCEngineInterface,
  ctx: ErrorExplainContext,
  attempt: number,
  options?: ExplainErrorOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[ctx.language];
  const system = buildErrorExplainSystemPrompt(languageLabel, attempt);
  const user = buildErrorExplainContext(ctx);

  let accumulated = '';
  let abortedByEngine = false;

  beginWebLlmGeneration();
  try {
    const stream = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 350,
      stream: true,
    });

    for await (const chunk of stream) {
      if (signal?.aborted) {
        abortedByEngine = true;
        break;
      }
      const choice = chunk.choices[0];
      const delta = choice?.delta?.content;
      if (delta) {
        accumulated += delta;
        options?.onDelta?.(accumulated);
      }
      if (choice?.finish_reason === 'abort') {
        abortedByEngine = true;
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      throw new GenerationAbortedError();
    }
    throw new Error(GENERATE_FAILURE_MESSAGE, { cause: err });
  } finally {
    endWebLlmGeneration();
  }

  if (abortedByEngine || signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const content = accumulated.trim();
  if (!content) {
    throw new Error(GENERATE_FAILURE_MESSAGE);
  }
  if (looksLikeCode(content)) {
    throw new Error(CONTAINS_CODE_MESSAGE);
  }
  return content;
}

/**
 * Streams a beginner-friendly Japanese explanation of a compiler or runtime
 * error (CE / RE / TLE / MLE) in PRACTICE mode without leaking fix code or
 * hidden test outputs.
 */
export async function explainErrorStream(
  ctx: ErrorExplainContext,
  options?: ExplainErrorOptions,
): Promise<string> {
  if (options?.signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      options?.onDelta?.('');
    }
    try {
      return await requestErrorExplainOnce(engine, ctx, attempt, options);
    } catch (err) {
      if (err instanceof GenerationAbortedError) {
        throw err;
      }
      lastError = err;
      if (!(err instanceof Error) || err.message !== CONTAINS_CODE_MESSAGE) {
        throw err;
      }
    }
  }
  throw lastError;
}
