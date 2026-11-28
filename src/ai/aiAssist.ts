import type { InitProgressReport } from '@mlc-ai/web-llm';
import {
  beginWebLlmGeneration,
  endWebLlmGeneration,
  GenerationAbortedError,
  loadWebLlmEngine,
} from './webllmEngine';
import type { Language } from '../types/exam';
import { LANGUAGE_LABEL } from '../lib/language';

export interface AiTaskDraftInput {
  language: Language;
  prompt: string;
  testCaseCount: number;
}

export interface AiTaskDraft {
  statementMarkdown: string;
  starterCode: string;
  solutionCode: string;
  testCaseInputs: string[];
}

export interface GenerateTaskDraftOptions {
  onProgress?: (report: InitProgressReport) => void;
  signal?: AbortSignal;
}

const DRAFT_JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    statementMarkdown: { type: 'string' },
    starterCode: { type: 'string' },
    solutionCode: { type: 'string' },
    testCaseInputs: { type: 'array', items: { type: 'string' } },
  },
  required: ['statementMarkdown', 'starterCode', 'solutionCode', 'testCaseInputs'],
});

function isAiTaskDraft(v: unknown): v is AiTaskDraft {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.statementMarkdown === 'string' &&
    typeof o.starterCode === 'string' &&
    typeof o.solutionCode === 'string' &&
    Array.isArray(o.testCaseInputs) &&
    o.testCaseInputs.every((x) => typeof x === 'string')
  );
}

// Deliberately does NOT ask the model for expected outputs — small models
// asked to "compute" a program's output by hand are unreliable at it. The
// caller (AiAssistPanel) instead runs `solutionCode` for real against each
// of `testCaseInputs` via the existing runClientSide()/judge path and uses
// *that* as the expected output, the same way the teacher's own "解答例で
// テストケースを検証" already validates hand-written cases against a
// solution (see SolutionCheckPanel in TaskEditorPage.tsx).
export async function generateTaskDraft(
  input: AiTaskDraftInput,
  options?: GenerateTaskDraftOptions,
): Promise<AiTaskDraft> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[input.language];

  const system = `あなたはプログラミング演習の問題作成を手伝うアシスタントです。教師の指示に基づき、${languageLabel}で解く1つのプログラミング課題の下書きを作成してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${DRAFT_JSON_SCHEMA}

各フィールドの内容:
- statementMarkdown: 生徒向けの問題文（Markdown、日本語）。入力・出力の形式を明記すること。
- starterCode: 生徒に配布する初期テンプレートコード（${languageLabel}）。関数や main の骨組みだけを含め、解答そのものは書かないこと。
- solutionCode: 上記の問題を実際に解く、完全に動作する正しい${languageLabel}のコード。標準入力から読み取り、標準出力に結果を書き、そのままコンパイル・実行できること。
- testCaseInputs: ちょうど${input.testCaseCount}件の標準入力の値（文字列の配列）。境界値を含む多様なケースにすること。期待される出力はここに含めないこと（別の手段で求めるため）。`;

  beginWebLlmGeneration();
  let completion;
  try {
    completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.prompt },
      ],
      response_format: { type: 'json_object', schema: DRAFT_JSON_SCHEMA },
      temperature: 0.7,
    });
  } finally {
    endWebLlmGeneration();
  }

  if (signal?.aborted || completion.choices[0]?.finish_reason === 'abort') {
    throw new GenerationAbortedError();
  }

  const content = completion.choices[0]?.message?.content ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AIの出力を解析できませんでした。もう一度お試しください。');
  }
  if (!isAiTaskDraft(parsed)) {
    throw new Error('AIの出力の形式が正しくありませんでした。もう一度お試しください。');
  }
  return parsed;
}
