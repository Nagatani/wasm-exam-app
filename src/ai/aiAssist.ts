import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  prebuiltAppConfig,
  type InitProgressReport,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm';
import type { Language } from '../types/exam';
import { LANGUAGE_LABEL } from '../lib/language';

// A single small, coder-tuned model — a deliberate choice over letting the
// teacher pick from WebLLM's full catalog: this app doesn't need every
// model, just one with a reasonable balance of download size vs. Japanese
// instruction-following quality for generating problem statements, test
// case inputs, and reference solutions. See docs/roadmap.md for the
// reasoning; revisit only if this one proves too weak/heavy in practice.
export const AI_ASSIST_MODEL_ID = 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC';

export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// The model record's own `vram_required_MB` as a rough stand-in for the
// download size a teacher should expect — WebLLM doesn't separately expose
// "bytes on the wire", and VRAM footprint of a q4-quantized model tracks its
// on-disk/cache size closely enough for a "about how big" caption.
export function aiAssistModelSizeLabel(): string {
  const record = prebuiltAppConfig.model_list.find((m) => m.model_id === AI_ASSIST_MODEL_ID);
  if (!record?.vram_required_MB) return '数GB程度';
  return `約${(record.vram_required_MB / 1024).toFixed(1)}GB`;
}

export type AiAssistState = 'idle' | 'loading' | 'ready' | 'error';
let state: AiAssistState = 'idle';
let enginePromise: Promise<MLCEngineInterface> | null = null;

export function aiAssistState(): AiAssistState {
  return state;
}

const LOAD_FAILURE_MESSAGE =
  'AIモデルの読み込みに失敗しました。ネットワーク環境を確認するか、しばらくしてから再度お試しください。';

// Downloads (first call only — memoized like cRunner.ts's clang promise) and
// initializes the model in a dedicated worker. Never called automatically:
// unlike the C/Python runtimes every student implicitly needs, this is a
// multi-hundred-MB-to-multi-GB download only a teacher who opted in (see
// aiAssistSettings.ts) should ever trigger.
export function loadAiAssistModel(
  onProgress?: (report: InitProgressReport) => void,
): Promise<MLCEngineInterface> {
  if (!enginePromise) {
    if (!isWebGpuSupported()) {
      state = 'error';
      return Promise.reject(
        new Error('このブラウザはAI作問サポート（WebGPU）に対応していません。'),
      );
    }
    state = 'loading';
    const worker = new Worker(new URL('./aiAssist.worker.ts', import.meta.url), {
      type: 'module',
    });
    enginePromise = CreateWebWorkerMLCEngine(worker, AI_ASSIST_MODEL_ID, {
      initProgressCallback: onProgress,
    }).then(
      (engine) => {
        state = 'ready';
        return engine;
      },
      (err) => {
        state = 'error';
        enginePromise = null;
        console.error('AI assist model load failed:', err);
        throw new Error(LOAD_FAILURE_MESSAGE);
      },
    );
  }
  return enginePromise;
}

// navigator.storage.estimate() is a browser-wide figure (every origin's
// cached data, not just this model), but it's the only thing the platform
// exposes without hand-rolling a Cache/IndexedDB walk — good enough for a
// "here's roughly how much this browser is using" caption. `null` when the
// API isn't available (e.g. private browsing in some browsers).
export async function estimateStorageUsageBytes(): Promise<number | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage } = await navigator.storage.estimate();
  return usage ?? null;
}

// Unloads the live engine (if any) and deletes every cache entry WebLLM
// wrote for this model (weights, wasm, tokenizer/config) — the counterpart
// to the "モデルを削除してオフにする" button in UserDrawer. Resets local
// state so the next loadAiAssistModel() call re-downloads from scratch.
export async function clearAiAssistCache(): Promise<void> {
  if (enginePromise) {
    try {
      const engine = await enginePromise;
      await engine.unload();
    } catch {
      /* the engine may have failed to load in the first place — clear regardless */
    }
  }
  await deleteModelAllInfoInCache(AI_ASSIST_MODEL_ID);
  enginePromise = null;
  state = 'idle';
}

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
export async function generateTaskDraft(input: AiTaskDraftInput): Promise<AiTaskDraft> {
  const engine = await loadAiAssistModel();
  const languageLabel = LANGUAGE_LABEL[input.language];

  const system = `あなたはプログラミング演習の問題作成を手伝うアシスタントです。教師の指示に基づき、${languageLabel}で解く1つのプログラミング課題の下書きを作成してください。

必ず次のJSONスキーマに従ったJSONオブジェクトのみを出力してください。説明文・前置き・コードブロックの \`\`\` 記法は一切使わないでください: ${DRAFT_JSON_SCHEMA}

各フィールドの内容:
- statementMarkdown: 生徒向けの問題文（Markdown、日本語）。入力・出力の形式を明記すること。
- starterCode: 生徒に配布する初期テンプレートコード（${languageLabel}）。関数や main の骨組みだけを含め、解答そのものは書かないこと。
- solutionCode: 上記の問題を実際に解く、完全に動作する正しい${languageLabel}のコード。標準入力から読み取り、標準出力に結果を書き、そのままコンパイル・実行できること。
- testCaseInputs: ちょうど${input.testCaseCount}件の標準入力の値（文字列の配列）。境界値を含む多様なケースにすること。期待される出力はここに含めないこと（別の手段で求めるため）。`;

  const completion = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input.prompt },
    ],
    response_format: { type: 'json_object', schema: DRAFT_JSON_SCHEMA },
    temperature: 0.7,
  });

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
