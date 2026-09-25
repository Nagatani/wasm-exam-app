import { useState } from 'react';
import { aiAssistState, generateTaskDraft, loadAiAssistModel } from '../ai/aiAssist';
import { isServerExec, LANGUAGE_LABEL } from '../lib/language';
import { runClientSide } from '../runner/clientRunner';
import { checkSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import type { Language } from '../types/exam';

export interface AiAssistApplyDraft {
  statementMarkdown: string;
  starterCode: string;
  solutionCode: string;
  testCases: { input: string; expectedOutput: string }[];
}

interface VerifiedCase {
  input: string;
  expectedOutput: string;
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
}

type Phase = 'idle' | 'loading-model' | 'generating' | 'verifying' | 'ready' | 'error';

/**
 * "AIで下書きを作成" — a collapsible panel (same open/close convention as
 * BulkTestCasePanel in TaskEditorPage.tsx) that lets a teacher describe a
 * task in a sentence or two and get a draft statement/starter code/test
 * cases/reference solution back. Only ever hands the *reviewed* draft to
 * the caller via `onApply` — nothing here saves anything by itself, matching
 * every other authoring aid in this app (BulkTestCasePanel, SolutionCheckPanel).
 *
 * TaskEditorPage only mounts this (lazily — see its own import) once it has
 * already confirmed AI作問サポート is enabled for this browser (see
 * aiAssistSettings.ts); this component doesn't re-check that itself.
 */
export function AiAssistPanel({
  taskId,
  language,
  hasExistingContent,
  onApply,
}: {
  taskId: string;
  language: Language;
  hasExistingContent: boolean;
  onApply: (draft: AiAssistApplyDraft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [testCaseCount, setTestCaseCount] = useState(4);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeneratedDraft | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const serverExec = isServerExec(language);
  const busy = phase === 'loading-model' || phase === 'generating' || phase === 'verifying';

  async function handleGenerate() {
    if (prompt.trim() === '') return;
    setError(null);
    setDraft(null);
    try {
      if (aiAssistState() !== 'ready') {
        setPhase('loading-model');
        await loadAiAssistModel((report) => setProgressText(report.text));
      }
      setPhase('generating');
      setProgressText('生成しています...');
      const generated = await generateTaskDraft({ language, prompt, testCaseCount });

      setPhase('verifying');
      setProgressText('解答例を実行してテストケースの期待値を求めています...');
      let result;
      if (serverExec) {
        try {
          result = await checkSolution(taskId, generated.solutionCode, generated.testCaseInputs);
        } catch (err) {
          // Judge down / not configured / busy: fall back to unverified cases
          // rather than losing the whole draft.
          setDraft({
            statementMarkdown: generated.statementMarkdown,
            starterCode: generated.starterCode,
            solutionCode: generated.solutionCode,
            verified: generated.testCaseInputs.map((input) => ({ input, expectedOutput: '' })),
            excludedCount: 0,
            unverifiedJava: true,
            unverifiedReason: err instanceof ApiError ? err.message : undefined,
          });
          setPhase('ready');
          return;
        }
      } else {
        const testCases = generated.testCaseInputs.map((input, i) => ({ id: String(i), input }));
        result = await runClientSide(language, generated.solutionCode, testCases, () => {});
      }
      if (result.compileFailed) {
        throw new Error(
          `生成された解答例のコンパイル/検証に失敗しました。もう一度「生成する」をお試しください。（${result.compileStderr.slice(0, 200)}）`,
        );
      }
      const verified: VerifiedCase[] = [];
      for (const [i, input] of generated.testCaseInputs.entries()) {
        const outcome = result.outcomes.find((o) => o.testCaseId === String(i));
        if (outcome?.stage === 'success') {
          verified.push({ input, expectedOutput: outcome.stdout });
        }
      }
      setDraft({
        statementMarkdown: generated.statementMarkdown,
        starterCode: generated.starterCode,
        solutionCode: generated.solutionCode,
        verified,
        excludedCount: generated.testCaseInputs.length - verified.length,
        unverifiedJava: false,
      });
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AIでの下書き生成に失敗しました。');
      setPhase('error');
    } finally {
      setProgressText('');
    }
  }

  function requestApply() {
    if (hasExistingContent) {
      setConfirmOverwrite(true);
      return;
    }
    void doApply();
  }

  async function doApply() {
    if (!draft) return;
    setConfirmOverwrite(false);
    setApplying(true);
    try {
      await onApply({
        statementMarkdown: draft.statementMarkdown,
        starterCode: draft.starterCode,
        solutionCode: draft.solutionCode,
        testCases: draft.verified,
      });
      setDraft(null);
      setPrompt('');
      setOpen(false);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-sm font-bold hover:bg-mp-surface-hover"
      >
        {open ? 'AIで下書きを作成を閉じる' : '🤖 AIで下書きを作成'}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-mp-border bg-mp-surface p-3">
          <p className="mb-2 text-xs text-mp-muted">
            どんな問題を作りたいか（トピック・難易度・条件など）を書いて生成してください。生成される内容は問題文・初期テンプレート・テストケース・解答例（{LANGUAGE_LABEL[language]}）の下書きで、そのまま保存されることはありません。必ず内容を確認してから「反映する」を押してください。
          </p>
          <textarea
            rows={3}
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
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={busy || prompt.trim() === ''}
              className="ml-auto rounded bg-mp-cyan px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? '生成中...' : '生成する'}
            </button>
          </div>

          {busy && progressText && <p className="mb-2 text-xs text-mp-muted">{progressText}</p>}
          {error && <p className="mb-2 text-sm text-mp-red">{error}</p>}

          {draft && phase === 'ready' && (
            <div className="rounded border border-mp-border bg-mp-bg p-3">
              <p className="mb-2 text-xs font-bold text-mp-muted">プレビュー</p>
              <div className="mb-2 max-h-40 overflow-y-auto rounded border border-mp-border bg-mp-surface p-2 text-xs whitespace-pre-wrap">
                {draft.statementMarkdown}
              </div>
              <p className="mb-1 text-xs text-mp-muted">
                テストケース: {draft.verified.length}件
                {draft.excludedCount > 0 &&
                  `（解答例の実行で検証できなかった${draft.excludedCount}件は除外しました）`}
              </p>
              {draft.unverifiedJava && (
                <p className="mb-2 text-xs text-mp-orange">
                  ⚠️ Java の実行環境（judge）で解答例を実行できなかったため、期待される出力は空欄で追加されます。保存後に「解答例でテストケースを検証」などで必ず確認してください。
                  {draft.unverifiedReason && `（${draft.unverifiedReason}）`}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={requestApply}
                  disabled={applying}
                  className="rounded bg-mp-green px-3 py-1.5 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
                >
                  {applying ? '反映中...' : 'この内容を反映する'}
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
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
                      onClick={() => void doApply()}
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
        </div>
      )}
    </div>
  );
}

// Default export so TaskEditorPage can `React.lazy()` this — it (and
// @mlc-ai/web-llm underneath it, via ../ai/aiAssist) is several MB of JS
// that shouldn't load just from opening the task editor if the teacher
// never touches AI assist.
export default AiAssistPanel;
