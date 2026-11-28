import type { InitProgressReport } from '@mlc-ai/web-llm';
import {
  beginWebLlmGeneration,
  endWebLlmGeneration,
  GenerationAbortedError,
  loadWebLlmEngine,
} from './webllmEngine';
import {
  buildCodeReviewSystemPrompt,
  buildCodeReviewUserPrompt,
  type CodeReviewContext,
} from './aiCodeReviewContext';
import { LANGUAGE_LABEL } from '../lib/language';

export type { CodeReviewContext } from './aiCodeReviewContext';

export interface ReviewAcCodeOptions {
  onProgress?: (report: InitProgressReport) => void;
  onDelta?: (textSoFar: string) => void;
  signal?: AbortSignal;
}

const GENERATE_FAILURE_MESSAGE = 'コードレビューの生成に失敗しました。もう一度お試しください。';

/**
 * Streams a concise post-AC code review (readability, edge cases, complexity)
 * for a student's accepted solution in PRACTICE mode.
 */
export async function reviewAcCodeStream(
  ctx: CodeReviewContext,
  options?: ReviewAcCodeOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[ctx.language];
  const system = buildCodeReviewSystemPrompt(languageLabel);
  const user = buildCodeReviewUserPrompt(ctx, languageLabel);

  let accumulated = '';
  let abortedByEngine = false;

  beginWebLlmGeneration();
  try {
    const stream = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 450,
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
  return content;
}
