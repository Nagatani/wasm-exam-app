import type { InitProgressReport } from '@mlc-ai/web-llm';
import {
  beginWebLlmGeneration,
  endWebLlmGeneration,
  GenerationAbortedError,
  loadWebLlmEngine,
  requestStructuredJson,
} from './webllmEngine';
import type { ComparisonMode, Language } from '../types/exam';
import { LANGUAGE_LABEL } from '../lib/language';
import { COMPARISON_MODE_LABEL } from '../lib/compareOutput';

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

export interface ExistingTaskTestCase {
  input: string;
  expectedOutput: string;
  isSample: boolean;
}

export interface ExistingTaskContext {
  title: string;
  statementMarkdown: string;
  language: Language;
  comparisonMode?: ComparisonMode;
  testCases: ExistingTaskTestCase[];
  solutionCode: string;
  count?: number;
}

export interface ReviewTaskStatementOptions {
  onDelta?: (textSoFar: string) => void;
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

const EDGE_CASE_INPUTS_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    inputs: { type: 'array', items: { type: 'string' } },
  },
  required: ['inputs'],
});

const STARTER_CODE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    starterCode: { type: 'string' },
  },
  required: ['starterCode'],
});

const SOLUTION_CODE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    solutionCode: { type: 'string' },
  },
  required: ['solutionCode'],
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

function isEdgeCaseInputsResponse(v: unknown): v is { inputs: string[] } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.inputs) && o.inputs.every((x) => typeof x === 'string');
}

function isStarterCodeResponse(v: unknown): v is { starterCode: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.starterCode === 'string' && o.starterCode.trim().length > 0;
}

function isSolutionCodeResponse(v: unknown): v is { solutionCode: string } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.solutionCode === 'string' && o.solutionCode.trim().length > 0;
}

function formatExistingTestCases(testCases: ExistingTaskTestCase[], includeExpected: boolean): string {
  if (testCases.length === 0) return '(まだテストケースがありません)';
  return testCases
    .slice(0, 20)
    .map((tc, i) => {
      const label = `ケース${i + 1}${tc.isSample ? '（サンプル）' : ''}`;
      const inputText = tc.input.slice(0, 500) || '(空)';
      if (!includeExpected) {
        return `${label} 入力:\n${inputText}`;
      }
      const expectedText = tc.expectedOutput.slice(0, 500) || '(空)';
      return `${label}\n入力:\n${inputText}\n期待出力:\n${expectedText}`;
    })
    .join('\n\n');
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

  return requestStructuredJson<AiTaskDraft>({
    engine,
    system,
    user: input.prompt,
    schema: DRAFT_JSON_SCHEMA,
    validate: isAiTaskDraft,
    maxTokens: 2048,
    temperature: 0.7,
    signal,
  });
}

/**
 * Generates additional edge-case standard inputs for an existing task.
 * Deliberately returns inputs ONLY — never expected outputs. The caller
 * must execute the teacher's reference solution against each input via
 * `runClientSide` / `checkSolution` to derive verified expected outputs.
 */
export async function generateEdgeCaseInputs(
  taskContext: ExistingTaskContext,
  options?: GenerateTaskDraftOptions,
): Promise<string[]> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const count = Math.min(10, Math.max(1, taskContext.count ?? 3));
  const languageLabel = LANGUAGE_LABEL[taskContext.language];

  const system = `あなたはプログラミング演習のテストケース設計を手伝うアシスタントです。既存の問題文・既存テストケース・解答例（${languageLabel}）を確認し、既存テストケースではカバーできていない境界値・コーナーケースの「標準入力のみ」をちょうど${count}件生成してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${EDGE_CASE_INPUTS_SCHEMA}

ルール:
- inputs は標準入力の文字列配列で、ちょうど${count}件にすること。
- 既存のテストケースと重複する入力は避けること。
- 最小値・最大値・0・負数・単一要素・同値・空文字・境界条件など、問題仕様を満たす有効なエッジケースを選ぶこと。
- 期待される出力は絶対に生成しないこと（解答例の実実行から求めるため）。`;

  const user = `【タイトル】
${taskContext.title || '(未設定)'}

【問題文】
${taskContext.statementMarkdown || '(未設定)'}

【既存のテストケース入力】
${formatExistingTestCases(taskContext.testCases, false)}

【解答例（${languageLabel}）】
${taskContext.solutionCode.slice(0, 4000) || '(なし)'}`;

  const parsed = await requestStructuredJson<{ inputs: string[] }>({
    engine,
    system,
    user,
    schema: EDGE_CASE_INPUTS_SCHEMA,
    validate: isEdgeCaseInputsResponse,
    maxTokens: 800,
    temperature: 0.6,
    signal,
  });

  const existingSet = new Set(taskContext.testCases.map((tc) => tc.input));
  const seen = new Set<string>();
  const uniqueInputs: string[] = [];
  for (const raw of parsed.inputs) {
    if (existingSet.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    uniqueInputs.push(raw);
  }
  return uniqueInputs;
}

/**
 * Streams a concise Japanese review of an existing task's statement,
 * checking for ambiguity, missing constraints, and mismatches with
 * test cases or comparison mode. Advisory only — never auto-overwrites.
 */
export async function reviewTaskStatement(
  taskContext: ExistingTaskContext,
  options?: ReviewTaskStatementOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[taskContext.language];
  const comparisonLabel = taskContext.comparisonMode
    ? COMPARISON_MODE_LABEL[taskContext.comparisonMode]
    : '未指定';

  const system = `あなたはプログラミング課題の品質レビューを行うアシスタントです。教師が作成した問題文・テストケース・比較設定・解答例を突合し、生徒が誤解しやすい点や仕様の抜け漏れを簡潔に指摘してください。

確認観点:
1. 問題文の曖昧さ（入力形式・出力形式・改行や空白の扱い・端数処理など）
2. 制約の記載漏れ（値の範囲、個数、型、0 や負数の扱いなど）
3. 問題文とテストケース・比較設定・解答例の不整合

回答形式:
- 日本語の簡潔な箇条書き（3〜6点程度）で出力してください。
- 問題文全体の書き直しは行わず、確認すべき具体的なポイントだけを示してください。
- 大きな問題が見当たらない場合は、その旨を簡潔に伝えてください。`;

  const user = `【タイトル】
${taskContext.title || '(未設定)'}

【解答言語】${languageLabel}
【出力の比較方法】${comparisonLabel}

【問題文】
${taskContext.statementMarkdown || '(未設定)'}

【テストケース】
${formatExistingTestCases(taskContext.testCases, true)}

【解答例】
${taskContext.solutionCode.slice(0, 4000) || '(未登録)'}`;

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
    throw new Error('問題文チェックの生成に失敗しました。もう一度お試しください。', { cause: err });
  } finally {
    endWebLlmGeneration();
  }

  if (abortedByEngine || signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const content = accumulated.trim();
  if (!content) {
    throw new Error('問題文チェックの出力が空でした。もう一度お試しください。');
  }
  return content;
}

/**
 * Generates a clean student starter-code skeleton from an existing reference
 * solution, stripping out the core answer logic while preserving boilerplate.
 */
export async function generateStarterFromSolution(
  taskContext: ExistingTaskContext,
  options?: GenerateTaskDraftOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }
  if (!taskContext.solutionCode.trim()) {
    throw new Error('解答例コードが入力されていません。');
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[taskContext.language];

  const system = `あなたはプログラミング演習の教材作成を手伝うアシスタントです。教師の解答例コード（${languageLabel}）から、生徒に配布する初期テンプレートコード（starterCode）の骨組みを作成してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${STARTER_CODE_SCHEMA}

ルール:
- 必要な import / include、main 関数や関数のシグネチャ、基本的な入出力の枠組みは残して構いません。
- 核心となる解答ロジック・計算処理は必ず削除し、TODO コメントに置き換えてください（答えが漏れないようにすること）。
- ${languageLabel} として自然な構文・インデントにしてください。`;

  const user = `【タイトル】
${taskContext.title || '(未設定)'}

【問題文】
${taskContext.statementMarkdown || '(未設定)'}

【解答例コード（${languageLabel}）】
${taskContext.solutionCode.slice(0, 6000)}`;

  const parsed = await requestStructuredJson<{ starterCode: string }>({
    engine,
    system,
    user,
    schema: STARTER_CODE_SCHEMA,
    validate: isStarterCodeResponse,
    maxTokens: 800,
    temperature: 0.3,
    signal,
    validationErrorMessage: 'スターターコードの形式が正しくありませんでした。もう一度お試しください。',
  });
  return parsed.starterCode;
}

export interface RepairSolutionInput {
  language: Language;
  statementMarkdown: string;
  brokenSolutionCode: string;
  compileStderr: string;
}

/**
 * Single-attempt automatic repair of a generated solution that failed
 * compilation. Feeds `compileStderr` back to the model and asks it to fix
 * ONLY the solution code (leaving statement, starter, and inputs intact).
 */
export async function repairSolutionCode(
  input: RepairSolutionInput,
  options?: GenerateTaskDraftOptions,
): Promise<string> {
  const signal = options?.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const engine = await loadWebLlmEngine(options?.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const languageLabel = LANGUAGE_LABEL[input.language];

  const system = `あなたはプログラミング演習の解答例を修正するアシスタントです。与えられた${languageLabel}の解答例コードにコンパイルエラー（または構文エラー）が発生しました。エラー内容を確認し、問題文の仕様を満たしつつそのままコンパイル・実行できる修正済みの解答例コードのみを出力してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${SOLUTION_CODE_SCHEMA}`;

  const user = `【問題文】
${input.statementMarkdown.slice(0, 3000) || '(未設定)'}

【コンパイルエラーのあった解答例（${languageLabel}）】
${input.brokenSolutionCode.slice(0, 5000)}

【コンパイルエラー内容】
${input.compileStderr.slice(0, 2000)}`;

  const parsed = await requestStructuredJson<{ solutionCode: string }>({
    engine,
    system,
    user,
    schema: SOLUTION_CODE_SCHEMA,
    validate: isSolutionCodeResponse,
    maxTokens: 1200,
    temperature: 0.2,
    signal,
    validationErrorMessage: '修正後の解答例コードの形式が正しくありませんでした。もう一度お試しください。',
  });
  return parsed.solutionCode;
}

/**
 * Generates a variation (類題) of an existing task — preserving core algorithm
 * and difficulty while changing the scenario, conditions, or numeric framing.
 * Deliberately returns test inputs ONLY; the caller verifies `solutionCode` by
 * executing it to obtain expected outputs.
 */
export async function generateVariationDraft(
  taskContext: ExistingTaskContext,
  variationInstruction: string,
  options?: GenerateTaskDraftOptions | ((report: InitProgressReport) => void),
): Promise<AiTaskDraft> {
  const resolvedOptions: GenerateTaskDraftOptions =
    typeof options === 'function' ? { onProgress: options } : (options ?? {});
  const signal = resolvedOptions.signal;
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }
  if (!taskContext.statementMarkdown.trim()) {
    throw new Error('類題を作成するには、元の問題文が入力されている必要があります。');
  }

  const engine = await loadWebLlmEngine(resolvedOptions.onProgress);
  if (signal?.aborted) {
    throw new GenerationAbortedError();
  }

  const testCaseCount = Math.min(10, Math.max(1, taskContext.count ?? 4));
  const languageLabel = LANGUAGE_LABEL[taskContext.language];
  const instructionText = variationInstruction.trim();

  const system = `あなたはプログラミング演習の類題（バリエーション問題）を作成するアシスタントです。既存のプログラミング課題をもとに、使用するアルゴリズムや難易度の水準を保ちつつ、題材・設定・条件・数値などを変えた新しい${languageLabel}の類題を作成してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${DRAFT_JSON_SCHEMA}

各フィールドの内容:
- statementMarkdown: 新しい類題の生徒向け問題文（Markdown、日本語）。元の問題と丸写しにならず、入力・出力の形式と制約を明記すること。
- starterCode: 生徒に配布する初期テンプレートコード（${languageLabel}）。関数や main の骨組みだけを含め、解答そのものは書かないこと。
- solutionCode: 新しい類題を実際に解く、完全に動作する正しい${languageLabel}のコード。標準入力から読み取り、標準出力に結果を書き、そのままコンパイル・実行できること。
- testCaseInputs: ちょうど${testCaseCount}件の標準入力の値（文字列の配列）。境界値を含む多様なケースにすること。期待される出力はここに含めないこと（別の手段で求めるため）。`;

  const user = `【元のタイトル】
${taskContext.title || '(未設定)'}

【元の問題文】
${taskContext.statementMarkdown.slice(0, 3500)}

【元の解答例（${languageLabel}）】
${taskContext.solutionCode.slice(0, 4000) || '(未登録)'}

【類題作成の指示】
${instructionText || '元の問題と同等の難易度・学習目標を保ちながら、題材や条件を変えた新しい類題を作成してください。'}`;

  return requestStructuredJson<AiTaskDraft>({
    engine,
    system,
    user,
    schema: DRAFT_JSON_SCHEMA,
    validate: isAiTaskDraft,
    maxTokens: 2048,
    temperature: 0.7,
    signal,
  });
}
