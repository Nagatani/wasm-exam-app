import type { InitProgressReport } from '@mlc-ai/web-llm';
import {
  beginWebLlmGeneration,
  endWebLlmGeneration,
  GenerationAbortedError,
  loadWebLlmEngine,
} from './webllmEngine';
import {
  buildMisconceptionSystemPrompt,
  buildMisconceptionUserPrompt,
  type MisconceptionContextInput,
} from './aiMisconceptionContext';
import { LANGUAGE_LABEL } from '../lib/language';

export type {
  AnonymizedFailureSample,
  AnonymizedStatusCounts,
  MisconceptionContextInput,
} from './aiMisconceptionContext';

export interface SummarizeMisconceptionsOptions {
  onProgress?: (report: InitProgressReport) => void;
  onDelta?: (textSoFar: string) => void;
  signal?: AbortSignal;
}

const GENERATE_FAILURE_MESSAGE = 'つまずき傾向の分析に失敗しました。もう一度お試しください。';

/**
 * Streams an in-browser, strictly anonymized summary of common student
 * misconceptions for a task. Uses the shared WebLLM engine manager and never
 * sends student code or personal data to any external server.
 */
export async function summarizeMisconceptionsStream(
  input: MisconceptionContextInput,
  options?: SummarizeMisconceptionsOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = input.language ? LANGUAGE_LABEL[input.language] : undefined;
  const system = buildMisconceptionSystemPrompt();
  const user = buildMisconceptionUserPrompt(input, languageLabel);

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
      max_tokens: 700,
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
