import { useRef, useState } from 'react';
import {
  generateEdgeCaseInputs,
  generateStarterFromSolution,
  generateTaskDraft,
  generateVariationDraft,
  repairSolutionCode,
  reviewTaskStatement,
  type ExistingTaskContext,
} from '../ai/aiAssist';
import {
  getWebLlmState,
  interruptGenerate,
  isGenerationAbortedError,
  loadWebLlmEngine,
} from '../ai/webllmEngine';
import { isServerExec, LANGUAGE_LABEL } from '../lib/language';
import { runClientSide } from '../runner/clientRunner';
import { checkSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import type { ComparisonMode, Language } from '../types/exam';

export interface AiAssistApplyDraft {
  statementMarkdown: string;
  starterCode: string;
  solutionCode: string;
  testCases: { input: string; expectedOutput: string }[];
}

export interface AiAssistExistingTask {
  title: string;
  statementMarkdown: string;
  language: Language;
  comparisonMode: ComparisonMode;
  testCases: { input: string; expectedOutput: string; isSample: boolean }[];
  solutionCode: string;
}

interface VerifiedCase {
  input: string;
  expectedOutput: string;
}

class SolutionCompileError extends Error {
  readonly stderr: string;
  constructor(stderr: string) {
    super(
      `解答例のコンパイル/検証に失敗しました。解答例を確認してから再度お試しください。（${stderr.slice(0, 200)}）`,
    );
    this.name = 'SolutionCompileError';
    this.stderr = stderr;
  }
}

interface GeneratedDraft {
  statementMarkdown: string;
  starterCode: string;
  solutionCode: string;
  verified: VerifiedCase[];
  // Inputs the solution couldn't be verified against (compile failure /
  // runtime error / timeout on that specific input) — never applied with a
  // guessed expected output, just reported so the teacher knows fewer test
  // cases were produced than requested.
  excludedCount: number;
  // Java runs on the server-side judge (check-solution with ad-hoc inputs,
  // 2026-09-26). Only when the judge is unavailable do its test cases arrive
  // with an empty expectedOutput the teacher must fill in themselves — never
  // a value invented by the LLM. `unverifiedReason` says why.
  unverifiedJava: boolean;
  unverifiedReason?: string;
  autoRepaired?: boolean;
}

interface GeneratedEdgeCases {
  verified: VerifiedCase[];
  excludedCount: number;
  unverifiedJava: boolean;
  unverifiedReason?: string;
}

type AssistMode = 'draft' | 'variation' | 'edge-cases' | 'review' | 'starter';
type Phase = 'idle' | 'loading-model' | 'generating' | 'verifying' | 'ready' | 'error';

const MODE_TABS: { id: AssistMode; label: string }[] = [
  { id: 'draft', label: '新規下書き生成' },
  { id: 'variation', label: '類題を生成' },
  { id: 'edge-cases', label: 'エッジケース入力追加' },
  { id: 'review', label: '問題文チェック' },
  { id: 'starter', label: 'スターター生成' },
];

/**
 * Collapsible AI authoring assistant panel for TaskEditorPage.
 * Supports four modes:
 * 1. 新規下書き生成 — full draft from a short prompt, with real-execution verification.
 * 2. エッジケース入力追加 — generates additional boundary inputs only, verified
 *    against the current solution code before selective apply.
 * 3. 問題文チェック — streaming advisory review of statement / constraints / test cases.
 * 4. スターター生成 — generates a clean starter-code skeleton from the current solution.
 *
 * TaskEditorPage only mounts this (lazily — see its own import) once it has
 * already confirmed AI作問サポート is enabled for this browser (see
 * aiAssistSettings.ts); this component doesn't re-check that itself.
 */
export function AiAssistPanel({
  taskId,
  language,
  hasExistingContent,
  existingTask,
  getCurrentSolutionCode,
  onApply,
  onAddTestCases,
  onApplyStarterCode,
}: {
  taskId: string;
  language: Language;
  hasExistingContent: boolean;
  existingTask: AiAssistExistingTask;
  getCurrentSolutionCode?: () => string;
  onApply: (draft: AiAssistApplyDraft) => Promise<void>;
  onAddTestCases: (testCases: { input: string; expectedOutput: string }[]) => Promise<void>;
  onApplyStarterCode: (starterCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistMode>('draft');
  const [prompt, setPrompt] = useState('');
  const [testCaseCount, setTestCaseCount] = useState(4);
  const [variationInstruction, setVariationInstruction] = useState('');
  const [variationTestCaseCount, setVariationTestCaseCount] = useState(4);
  const [edgeCaseCount, setEdgeCaseCount] = useState(3);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abortedMessage, setAbortedMessage] = useState<string | null>(null);

  // Draft mode state
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [draftSelected, setDraftSelected] = useState<boolean[]>([]);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  // Edge-case mode state
  const [edgeCases, setEdgeCases] = useState<GeneratedEdgeCases | null>(null);
  const [edgeSelected, setEdgeSelected] = useState<boolean[]>([]);

  // Statement review mode state
  const [reviewText, setReviewText] = useState('');
  const [reviewStreaming, setReviewStreaming] = useState(false);

  // Starter generation mode state
  const [generatedStarter, setGeneratedStarter] = useState<string | null>(null);
  const [confirmStarterOverwrite, setConfirmStarterOverwrite] = useState(false);

  const [applying, setApplying] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const serverExec = isServerExec(language);
  const busy = phase === 'loading-model' || phase === 'generating' || phase === 'verifying';
  const canAbort = phase === 'loading-model' || phase === 'generating';

  function resolveSolutionCode(): string {
    return (getCurrentSolutionCode?.() ?? existingTask.solutionCode).trim();
  }

  function buildTaskContext(count?: number): ExistingTaskContext {
    return {
      title: existingTask.title,
      statementMarkdown: existingTask.statementMarkdown,
      language,
      comparisonMode: existingTask.comparisonMode,
      testCases: existingTask.testCases,
      solutionCode: getCurrentSolutionCode?.() ?? existingTask.solutionCode,
      count,
    };
  }

  function handleAbort() {
    abortControllerRef.current?.abort();
    interruptGenerate();
  }

  function handleSwitchMode(nextMode: AssistMode) {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    setError(null);
    setAbortedMessage(null);
    setConfirmOverwrite(false);
    setConfirmStarterOverwrite(false);
  }

  async function verifyInputsWithSolution(
    solutionCode: string,
    inputs: string[],
  ): Promise<{
    verified: VerifiedCase[];
    excludedCount: number;
    unverifiedJava: boolean;
    unverifiedReason?: string;
  }> {
    if (inputs.length === 0) {
      return { verified: [], excludedCount: 0, unverifiedJava: false };
    }
    let result;
    if (serverExec) {
      try {
        result = await checkSolution(taskId, solutionCode, inputs);
      } catch (err) {
        return {
          verified: inputs.map((input) => ({ input, expectedOutput: '' })),
          excludedCount: 0,
          unverifiedJava: true,
          unverifiedReason: err instanceof ApiError ? err.message : undefined,
        };
      }
    } else {
      const testCases = inputs.map((input, i) => ({ id: String(i), input }));
      result = await runClientSide(language, solutionCode, testCases, () => {});
    }
    if (result.compileFailed) {
      throw new SolutionCompileError(result.compileStderr);
    }
    const verified: VerifiedCase[] = [];
    for (const [i, input] of inputs.entries()) {
      const outcome = result.outcomes.find((o) => o.testCaseId === String(i));
      if (outcome?.stage === 'success') {
        verified.push({ input, expectedOutput: outcome.stdout });
      }
    }
    return {
      verified,
      excludedCount: inputs.length - verified.length,
      unverifiedJava: false,
    };
  }

  async function verifyGeneratedSolutionWithAutoRepair(
    solutionCode: string,
    statementMarkdown: string,
    inputs: string[],
    signal: AbortSignal,
  ): Promise<{
    solutionCode: string;
    verified: VerifiedCase[];
    excludedCount: number;
    unverifiedJava: boolean;
    unverifiedReason?: string;
    autoRepaired: boolean;
  }> {
    try {
      const verification = await verifyInputsWithSolution(solutionCode, inputs);
      return { solutionCode, ...verification, autoRepaired: false };
    } catch (err) {
      if (!(err instanceof SolutionCompileError) || signal.aborted) {
        throw err;
      }
      setPhase('generating');
      setProgressText('解答例のコンパイルに失敗したため、自動修正を試みています...');
      const repairedCode = await repairSolutionCode(
        {
          language,
          statementMarkdown,
          brokenSolutionCode: solutionCode,
          compileStderr: err.stderr,
        },
        { signal },
      );
      setPhase('verifying');
      setProgressText('修正後の解答例を再検証しています...');
      const verification = await verifyInputsWithSolution(repairedCode, inputs);
      return { solutionCode: repairedCode, ...verification, autoRepaired: true };
    }
  }

  async function ensureModelLoaded(controller: AbortController): Promise<boolean> {
    if (getWebLlmState() !== 'ready') {
      setPhase('loading-model');
      await loadWebLlmEngine((report) => setProgressText(report.text));
    }
    if (controller.signal.aborted) {
      setAbortedMessage('生成を中断しました。');
      setPhase('idle');
      return false;
    }
    return true;
  }

  async function handleGenerateDraft() {
    if (prompt.trim() === '') return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setDraft(null);
    setDraftSelected([]);
    setConfirmOverwrite(false);
    try {
      if (!(await ensureModelLoaded(controller))) return;
      setPhase('generating');
      setProgressText('下書きを生成しています...');
      const generated = await generateTaskDraft(
        { language, prompt, testCaseCount },
        { signal: controller.signal },
      );

      setPhase('verifying');
      setProgressText('解答例を実行してテストケースの期待値を求めています...');
      const verification = await verifyGeneratedSolutionWithAutoRepair(
        generated.solutionCode,
        generated.statementMarkdown,
        generated.testCaseInputs,
        controller.signal,
      );
      setDraft({
        statementMarkdown: generated.statementMarkdown,
        starterCode: generated.starterCode,
        ...verification,
      });
      setDraftSelected(verification.verified.map(() => true));
      setPhase('ready');
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('下書きの生成を中断しました。');
        setPhase('idle');
      } else {
        setError(err instanceof Error ? err.message : 'AIでの下書き生成に失敗しました。');
        setPhase('error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setProgressText('');
    }
  }

  async function handleGenerateVariation() {
    if (!existingTask.statementMarkdown.trim()) {
      setError('類題を生成するには、元の問題文が入力されている必要があります。');
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setDraft(null);
    setDraftSelected([]);
    setConfirmOverwrite(false);
    try {
      if (!(await ensureModelLoaded(controller))) return;
      setPhase('generating');
      setProgressText('現在の問題をもとに類題を生成しています...');
      const generated = await generateVariationDraft(
        buildTaskContext(variationTestCaseCount),
        variationInstruction,
        { signal: controller.signal },
      );

      setPhase('verifying');
      setProgressText('類題の解答例を実行してテストケースの期待値を求めています...');
      const verification = await verifyGeneratedSolutionWithAutoRepair(
        generated.solutionCode,
        generated.statementMarkdown,
        generated.testCaseInputs,
        controller.signal,
      );
      setDraft({
        statementMarkdown: generated.statementMarkdown,
        starterCode: generated.starterCode,
        ...verification,
      });
      setDraftSelected(verification.verified.map(() => true));
      setPhase('ready');
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('類題の生成を中断しました。');
        setPhase('idle');
      } else {
        setError(err instanceof Error ? err.message : '類題の生成に失敗しました。');
        setPhase('error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setProgressText('');
    }
  }

  async function handleGenerateEdgeCases() {
    const solutionCode = resolveSolutionCode();
    if (!solutionCode) {
      setError('エッジケースの期待値を検証するため、先に解答例コードを入力してください。');
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setEdgeCases(null);
    setEdgeSelected([]);
    try {
      if (!(await ensureModelLoaded(controller))) return;
      setPhase('generating');
      setProgressText('エッジケースの入力候補を生成しています...');
      const inputs = await generateEdgeCaseInputs(buildTaskContext(edgeCaseCount), {
        signal: controller.signal,
      });
      if (inputs.length === 0) {
        throw new Error('既存と重複しない新しいエッジケース入力を生成できませんでした。もう一度お試しください。');
      }

      setPhase('verifying');
      setProgressText('解答例を実行して期待値を検証しています...');
      const verification = await verifyInputsWithSolution(solutionCode, inputs);
      setEdgeCases(verification);
      setEdgeSelected(verification.verified.map(() => true));
      setPhase('ready');
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('エッジケースの生成を中断しました。');
        setPhase('idle');
      } else {
        setError(err instanceof Error ? err.message : 'エッジケースの生成に失敗しました。');
        setPhase('error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setProgressText('');
    }
  }

  async function handleReviewStatement() {
    if (!existingTask.statementMarkdown.trim()) {
      setError('問題文が空のためチェックできません。先に問題文を入力してください。');
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setReviewText('');
    setReviewStreaming(false);
    try {
      if (!(await ensureModelLoaded(controller))) return;
      setPhase('generating');
      setProgressText('問題文をチェックしています...');
      setReviewStreaming(true);
      const result = await reviewTaskStatement(buildTaskContext(), {
        onDelta: (textSoFar) => {
          setProgressText('');
          setReviewText(textSoFar);
        },
        signal: controller.signal,
      });
      setReviewText(result);
      setPhase('ready');
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('問題文チェックを中断しました。');
        setPhase('idle');
      } else {
        setError(err instanceof Error ? err.message : '問題文チェックに失敗しました。');
        setPhase('error');
      }
    } finally {
      setReviewStreaming(false);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setProgressText('');
    }
  }

  async function handleGenerateStarter() {
    if (!resolveSolutionCode()) {
      setError('スターターコードを生成するには、先に解答例コードを入力してください。');
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setGeneratedStarter(null);
    setConfirmStarterOverwrite(false);
    try {
      if (!(await ensureModelLoaded(controller))) return;
      setPhase('generating');
      setProgressText('解答例からスターターコードを生成しています...');
      const starter = await generateStarterFromSolution(buildTaskContext(), {
        signal: controller.signal,
      });
      setGeneratedStarter(starter);
      setPhase('ready');
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('スターターコードの生成を中断しました。');
        setPhase('idle');
      } else {
        setError(err instanceof Error ? err.message : 'スターターコードの生成に失敗しました。');
        setPhase('error');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setProgressText('');
    }
  }

  function requestApplyDraft() {
    if (hasExistingContent) {
      setConfirmOverwrite(true);
      return;
    }
    void doApplyDraft();
  }

  async function doApplyDraft() {
    if (!draft) return;
    setConfirmOverwrite(false);
    setApplying(true);
    try {
      const selectedCases = draft.verified.filter((_, i) => draftSelected[i] !== false);
      await onApply({
        statementMarkdown: draft.statementMarkdown,
        starterCode: draft.starterCode,
        solutionCode: draft.solutionCode,
        testCases: selectedCases,
      });
      setDraft(null);
      setDraftSelected([]);
      setPrompt('');
      setOpen(false);
    } finally {
      setApplying(false);
    }
  }

  async function handleApplyEdgeCases() {
    if (!edgeCases) return;
    const selected = edgeCases.verified.filter((_, i) => edgeSelected[i] !== false);
    if (selected.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      await onAddTestCases(selected);
      setEdgeCases(null);
      setEdgeSelected([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'テストケースの追加に失敗しました。');
    } finally {
      setApplying(false);
    }
  }

  function requestApplyStarter() {
    if (!generatedStarter) return;
    if (hasExistingContent) {
      setConfirmStarterOverwrite(true);
      return;
    }
    doApplyStarter();
  }

  function doApplyStarter() {
    if (!generatedStarter) return;
    setConfirmStarterOverwrite(false);
    onApplyStarterCode(generatedStarter);
    setGeneratedStarter(null);
  }

  const selectedDraftCount = draft
    ? draft.verified.filter((_, i) => draftSelected[i] !== false).length
    : 0;
  const selectedEdgeCount = edgeCases
    ? edgeCases.verified.filter((_, i) => edgeSelected[i] !== false).length
    : 0;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover"
      >
        {open ? 'AI作問サポートを閉じる' : '🤖 AI作問サポート'}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-mp-border bg-mp-surface p-3">
          <div className="mb-3 flex flex-wrap gap-1 border-b border-mp-border pb-2" role="tablist" aria-label="AI作問サポートモード">
            {MODE_TABS.map((tab) => {
              const active = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  disabled={busy}
                  onClick={() => handleSwitchMode(tab.id)}
                  className={`rounded px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50 ${
                    active
                      ? 'bg-mp-cyan text-mp-btn-fg'
                      : 'border border-mp-border bg-mp-bg text-mp-muted hover:bg-mp-surface-hover'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {mode === 'draft' && (
            <div>
              <p className="mb-2 text-xs text-mp-muted">
                どんな問題を作りたいか（トピック・難易度・条件など）を書いて生成してください。生成される内容は問題文・初期テンプレート・テストケース・解答例（{LANGUAGE_LABEL[language]}）の下書きで、そのまま保存されることはありません。必ず内容を確認してから「反映する」を押してください。
              </p>
              <textarea
                rows={3}
                aria-label="作りたい問題の説明"
                className="mb-2 w-full rounded border border-mp-border bg-mp-bg px-2 py-1 text-sm text-mp-fg"
                placeholder="例: 配列の中から最大値を求める問題。入力は整数の個数Nと続くN個の整数。"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
              />
              <div className="mb-2 flex items-center gap-2 text-sm">
                <label htmlFor="ai-testcase-count" className="text-mp-muted">
                  テストケース数
                </label>
                <input
                  id="ai-testcase-count"
                  type="number"
                  min={1}
                  max={10}
                  value={testCaseCount}
                  onChange={(e) =>
                    setTestCaseCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
                  }
                  disabled={busy}
                  className="w-16 rounded border border-mp-border bg-mp-bg px-2 py-1 text-sm text-mp-fg"
                />
                <div className="ml-auto flex items-center gap-2">
                  {canAbort && (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1.5 text-sm font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                    >
                      中断
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleGenerateDraft()}
                    disabled={busy || prompt.trim() === ''}
                    className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? '生成中...' : '生成する'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'variation' && (
            <div>
              <p className="mb-2 text-xs text-mp-muted">
                現在の問題文・解答例（{LANGUAGE_LABEL[language]}）をもとに、アルゴリズムや難易度を保ちながら題材・条件を変えた類題（問題文・初期テンプレート・検証済みテストケース・解答例）を生成します。元の問題を上書きしないよう、先に問題を複製してから利用することをおすすめします。
              </p>
              <textarea
                rows={3}
                aria-label="類題の変更方針（任意）"
                className="mb-2 w-full rounded border border-mp-border bg-mp-bg px-2 py-1 text-sm text-mp-fg"
                placeholder="例: 題材を買い物の合計金額に変え、最小値ではなく平均値を求めるようにする（空欄のままでも生成できます）"
                value={variationInstruction}
                onChange={(e) => setVariationInstruction(e.target.value)}
                disabled={busy}
              />
              <div className="mb-2 flex items-center gap-2 text-sm">
                <label htmlFor="ai-variation-testcase-count" className="text-mp-muted">
                  テストケース数
                </label>
                <input
                  id="ai-variation-testcase-count"
                  type="number"
                  min={1}
                  max={10}
                  value={variationTestCaseCount}
                  onChange={(e) =>
                    setVariationTestCaseCount(
                      Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={busy}
                  className="w-16 rounded border border-mp-border bg-mp-bg px-2 py-1 text-sm text-mp-fg"
                />
                <div className="ml-auto flex items-center gap-2">
                  {canAbort && (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1.5 text-sm font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                    >
                      中断
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleGenerateVariation()}
                    disabled={busy || existingTask.statementMarkdown.trim() === ''}
                    className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? '生成中...' : '類題を生成する'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'edge-cases' && (
            <div>
              <p className="mb-2 text-xs text-mp-muted">
                現在の問題文と既存テストケースをもとに、未カバーの境界値・コーナーケースの<strong>入力のみ</strong>をAIが提案します。期待される出力は現在の解答例（{LANGUAGE_LABEL[language]}）を実際に実行して確定するため、先に解答例コードを入力してください。
              </p>
              <div className="mb-2 flex items-center gap-2 text-sm">
                <label htmlFor="ai-edgecase-count" className="text-mp-muted">
                  追加候補数
                </label>
                <input
                  id="ai-edgecase-count"
                  type="number"
                  min={1}
                  max={10}
                  value={edgeCaseCount}
                  onChange={(e) =>
                    setEdgeCaseCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
                  }
                  disabled={busy}
                  className="w-16 rounded border border-mp-border bg-mp-bg px-2 py-1 text-sm text-mp-fg"
                />
                <div className="ml-auto flex items-center gap-2">
                  {canAbort && (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1.5 text-sm font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                    >
                      中断
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleGenerateEdgeCases()}
                    disabled={busy}
                    className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                  >
                    {busy ? '生成・検証中...' : 'エッジケース入力を生成して検証'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'review' && (
            <div>
              <p className="mb-2 text-xs text-mp-muted">
                現在の問題文・テストケース・出力の比較方法・解答例を突合し、曖昧な表現や制約の抜け漏れ・仕様の矛盾を箇条書きで指摘します（問題文は自動変更されません）。
              </p>
              <div className="mb-2 flex items-center justify-end gap-2">
                {canAbort && (
                  <button
                    type="button"
                    onClick={handleAbort}
                    className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1.5 text-sm font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                  >
                    中断
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleReviewStatement()}
                  disabled={busy || existingTask.statementMarkdown.trim() === ''}
                  className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'チェック中...' : '問題文をチェック'}
                </button>
              </div>
            </div>
          )}

          {mode === 'starter' && (
            <div>
              <p className="mb-2 text-xs text-mp-muted">
                現在の解答例コード（{LANGUAGE_LABEL[language]}）から解答本体を取り除き、生徒に配布する初期テンプレートコードの骨組みを生成します。
              </p>
              <div className="mb-2 flex items-center justify-end gap-2">
                {canAbort && (
                  <button
                    type="button"
                    onClick={handleAbort}
                    className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1.5 text-sm font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                  >
                    中断
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleGenerateStarter()}
                  disabled={busy}
                  className="rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? '生成中...' : '解答例からスターターを生成'}
                </button>
              </div>
            </div>
          )}

          {busy && progressText && <p className="mb-2 text-xs text-mp-muted">{progressText}</p>}
          {abortedMessage && <p className="mb-2 text-xs text-mp-muted">{abortedMessage}</p>}
          {error && <p className="mb-2 text-sm text-mp-red">{error}</p>}

          {(mode === 'draft' || mode === 'variation') && draft && (
            <div className="rounded border border-mp-border bg-mp-bg p-3">
              <p className="mb-2 text-xs font-bold text-mp-muted">
                {mode === 'variation' ? '類題プレビュー' : '下書きプレビュー'}
                {draft.autoRepaired && (
                  <span className="ml-2 font-normal text-mp-cyan">
                    （コンパイルエラーを自動修正して検証済み）
                  </span>
                )}
              </p>
              <div className="mb-2 max-h-40 overflow-y-auto rounded border border-mp-border bg-mp-surface p-2 text-xs whitespace-pre-wrap">
                {draft.statementMarkdown}
              </div>
              <p className="mb-1 text-xs text-mp-muted">
                テストケース: {selectedDraftCount}/{draft.verified.length}件を選択
                {draft.excludedCount > 0 &&
                  `（解答例の実行で検証できなかった${draft.excludedCount}件は除外しました）`}
              </p>
              {draft.verified.length > 0 && (
                <div className="mb-2 max-h-44 space-y-1.5 overflow-y-auto">
                  {draft.verified.map((tc, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 rounded border border-mp-border bg-mp-surface p-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={draftSelected[i] !== false}
                        onChange={(e) =>
                          setDraftSelected((prev) =>
                            prev.map((v, idx) => (idx === i ? e.target.checked : v)),
                          )
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 font-mono">
                        <p className="truncate text-mp-fg">
                          <span className="text-mp-muted">入力: </span>
                          {tc.input || '(空)'}
                        </p>
                        <p className="truncate text-mp-fg">
                          <span className="text-mp-muted">期待出力: </span>
                          {tc.expectedOutput || '(空)'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {draft.unverifiedJava && (
                <p className="mb-2 text-xs text-mp-orange">
                  ⚠️ Java の実行環境（judge）で解答例を実行できなかったため、期待される出力は空欄で追加されます。保存後に「解答例でテストケースを検証」などで必ず確認してください。
                  {draft.unverifiedReason && `（${draft.unverifiedReason}）`}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestApplyDraft}
                  disabled={applying}
                  className="rounded bg-mp-green px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? '反映中...' : 'この内容を反映する'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setDraftSelected([]);
                  }}
                  disabled={applying}
                  className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover disabled:opacity-50"
                >
                  破棄
                </button>
              </div>

              {confirmOverwrite && (
                <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
                  <p className="mb-2">
                    問題文・初期テンプレートコードには既に内容があります。反映すると上書きされます（テストケース・解答例は既存のものに追加されます）。よろしいですか？
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void doApplyDraft()}
                      className="rounded bg-mp-orange px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90"
                    >
                      上書きして反映
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmOverwrite(false)}
                      className="rounded border border-mp-border bg-mp-bg px-3 py-1 text-xs hover:bg-mp-surface-hover"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === 'edge-cases' && edgeCases && (
            <div className="rounded border border-mp-border bg-mp-bg p-3">
              <p className="mb-1 text-xs font-bold text-mp-muted">
                検証済みエッジケース候補（{selectedEdgeCount}/{edgeCases.verified.length}件を選択）
              </p>
              {edgeCases.excludedCount > 0 && (
                <p className="mb-2 text-xs text-mp-muted">
                  解答例の実行で検証できなかった{edgeCases.excludedCount}件は除外しました。
                </p>
              )}
              {edgeCases.unverifiedJava && (
                <p className="mb-2 text-xs text-mp-orange">
                  ⚠️ Java の実行環境（judge）で検証できなかったため、期待される出力は空欄で追加されます。
                  {edgeCases.unverifiedReason && `（${edgeCases.unverifiedReason}）`}
                </p>
              )}
              {edgeCases.verified.length === 0 ? (
                <p className="mb-2 text-xs text-mp-muted">
                  追加できる検証済みエッジケースがありませんでした。もう一度お試しください。
                </p>
              ) : (
                <div className="mb-2 max-h-52 space-y-1.5 overflow-y-auto">
                  {edgeCases.verified.map((tc, i) => (
                    <label
                      key={i}
                      className="flex items-start gap-2 rounded border border-mp-border bg-mp-surface p-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={edgeSelected[i] !== false}
                        onChange={(e) =>
                          setEdgeSelected((prev) =>
                            prev.map((v, idx) => (idx === i ? e.target.checked : v)),
                          )
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1 font-mono">
                        <p className="whitespace-pre-wrap break-words text-mp-fg">
                          <span className="text-mp-muted">入力: </span>
                          {tc.input || '(空)'}
                        </p>
                        <p className="whitespace-pre-wrap break-words text-mp-fg">
                          <span className="text-mp-muted">期待出力: </span>
                          {tc.expectedOutput || '(空)'}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleApplyEdgeCases()}
                  disabled={applying || selectedEdgeCount === 0}
                  className="rounded bg-mp-green px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? '追加中...' : `選択した ${selectedEdgeCount} 件をテストケースに追加`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEdgeCases(null);
                    setEdgeSelected([]);
                  }}
                  disabled={applying}
                  className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover disabled:opacity-50"
                >
                  破棄
                </button>
              </div>
            </div>
          )}

          {mode === 'review' && (reviewText || reviewStreaming) && (
            <div className="rounded border border-mp-border bg-mp-bg p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-bold text-mp-cyan">
                  問題文チェック結果{reviewStreaming ? '（生成中）' : ''}
                </p>
                {!reviewStreaming && (
                  <button
                    type="button"
                    onClick={() => setReviewText('')}
                    className="text-xs text-mp-muted hover:underline"
                  >
                    クリア
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-xs text-mp-fg">{reviewText}</p>
            </div>
          )}

          {mode === 'starter' && generatedStarter !== null && (
            <div className="rounded border border-mp-border bg-mp-bg p-3">
              <p className="mb-2 text-xs font-bold text-mp-muted">生成されたスターターコード</p>
              <pre className="mb-2 max-h-52 overflow-auto rounded border border-mp-border bg-mp-surface p-2 font-mono text-xs text-mp-fg">
                {generatedStarter}
              </pre>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestApplyStarter}
                  className="rounded bg-mp-green px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90"
                >
                  初期テンプレートに反映
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGeneratedStarter(null);
                    setConfirmStarterOverwrite(false);
                  }}
                  className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm hover:bg-mp-surface-hover"
                >
                  破棄
                </button>
              </div>
              {confirmStarterOverwrite && (
                <div className="mt-2 rounded border border-mp-orange bg-mp-orange/10 px-3 py-2 text-xs text-mp-orange">
                  <p className="mb-2">
                    現在の初期テンプレートコードを上書きします（まだ保存はされません）。よろしいですか？
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={doApplyStarter}
                      className="rounded bg-mp-orange px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90"
                    >
                      上書きして反映
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmStarterOverwrite(false)}
                      className="rounded border border-mp-border bg-mp-bg px-3 py-1 text-xs hover:bg-mp-surface-hover"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Default export so TaskEditorPage can `React.lazy()` this — it (and
// @mlc-ai/web-llm underneath it, via ../ai/aiAssist / ../ai/webllmEngine) is
// several MB of JS that shouldn't load just from opening the task editor if
// the teacher never touches AI assist.
export default AiAssistPanel;
