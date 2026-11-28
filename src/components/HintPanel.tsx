import { useRef, useState } from 'react';
import { generateHint, HINT_STAGE_LABEL, type HintStage } from '../ai/aiHint';
import { explainErrorStream, hasExplainableError } from '../ai/aiErrorExplain';
import { reviewAcCodeStream } from '../ai/aiCodeReview';
import { interruptGenerate, isGenerationAbortedError } from '../ai/webllmEngine';
import type { PracticeTask } from '../types/practice';
import type { JudgeVerdict } from '../types/student';

const STAGES: HintStage[] = [1, 2, 3];

/**
 * Staged AI hint, error-explanation (L6), and post-AC code review (L7) panel
 * for a practice-mode task (PracticeTaskPage). Strictly PRACTICE mode only —
 * never mounted in EXAM mode.
 *
 * PracticeTaskPage only mounts this (lazily) once it has confirmed both the
 * task's teacher-set `aiHintEnabled` flag and this browser's student opt-in
 * (aiHintSettings.ts) are true — this component doesn't re-check either.
 */
export function HintPanel({
  task,
  code,
  verdict,
  compileStderr,
  isAc,
}: {
  task: PracticeTask;
  code: string;
  verdict: JudgeVerdict | null;
  compileStderr: string | null;
  isAc?: boolean;
}) {
  const visibleStages = STAGES.filter((s) => s <= task.aiHintMaxStage);
  const [unlockedStage, setUnlockedStage] = useState<0 | 1 | 2 | 3>(0);
  const [hints, setHints] = useState<Partial<Record<HintStage, string>>>({});
  const [loadingStage, setLoadingStage] = useState<HintStage | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abortedMessage, setAbortedMessage] = useState<string | null>(null);

  // Beginner-friendly CE / RE / TLE / MLE error explanation (L6)
  const [explainingError, setExplainingError] = useState(false);
  const [errorExplanation, setErrorExplanation] = useState<string | null>(null);
  const [errorExplainStreamText, setErrorExplainStreamText] = useState('');

  // Post-AC code review (L7)
  const [reviewingCode, setReviewingCode] = useState(false);
  const [codeReview, setCodeReview] = useState<string | null>(null);
  const [codeReviewStreamText, setCodeReviewStreamText] = useState('');

  const abortControllerRef = useRef<AbortController | null>(null);

  const ac = isAc ?? verdict?.overallStatus === 'AC';
  const hasFailedRun = verdict !== null && verdict.overallStatus !== 'AC';
  const showErrorExplain = hasExplainableError(verdict, compileStderr);
  const busy = loadingStage !== null || explainingError || reviewingCode;

  function isStageAvailable(stage: HintStage): boolean {
    if (stage === 1) return hasFailedRun;
    return unlockedStage >= stage - 1;
  }

  function handleAbort() {
    abortControllerRef.current?.abort();
    interruptGenerate();
  }

  async function handleGenerate(stage: HintStage) {
    if (!verdict) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setLoadingStage(stage);
    setStreamingText('');
    setProgressText('');
    try {
      const text = await generateHint(
        stage,
        {
          language: task.language,
          statementMarkdown: task.statementMarkdown,
          code,
          verdict,
          compileStderr,
        },
        {
          onProgress: (report) => setProgressText(report.text),
          onDelta: (textSoFar) => {
            setProgressText('');
            setStreamingText(textSoFar);
          },
          signal: controller.signal,
        },
      );
      setHints((prev) => ({ ...prev, [stage]: text }));
      setUnlockedStage((prev) => (prev < stage ? stage : prev) as 0 | 1 | 2 | 3);
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('ヒントの生成を中断しました。');
      } else {
        setError(err instanceof Error ? err.message : 'ヒントの生成に失敗しました。');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoadingStage(null);
      setStreamingText('');
      setProgressText('');
    }
  }

  async function handleExplainError() {
    if (!verdict) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setExplainingError(true);
    setErrorExplanation(null);
    setErrorExplainStreamText('');
    setProgressText('');
    try {
      const text = await explainErrorStream(
        {
          language: task.language,
          code,
          verdict,
          compileStderr,
        },
        {
          onProgress: (report) => setProgressText(report.text),
          onDelta: (textSoFar) => {
            setProgressText('');
            setErrorExplainStreamText(textSoFar);
          },
          signal: controller.signal,
        },
      );
      setErrorExplanation(text);
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('エラー解説の生成を中断しました。');
      } else {
        setError(err instanceof Error ? err.message : 'エラー解説の生成に失敗しました。');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setExplainingError(false);
      setErrorExplainStreamText('');
      setProgressText('');
    }
  }

  async function handleCodeReview() {
    if (!ac) return;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null);
    setAbortedMessage(null);
    setReviewingCode(true);
    setCodeReview(null);
    setCodeReviewStreamText('');
    setProgressText('');
    try {
      const text = await reviewAcCodeStream(
        {
          language: task.language,
          statementMarkdown: task.statementMarkdown,
          code,
        },
        {
          onProgress: (report) => setProgressText(report.text),
          onDelta: (textSoFar) => {
            setProgressText('');
            setCodeReviewStreamText(textSoFar);
          },
          signal: controller.signal,
        },
      );
      setCodeReview(text);
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('コードレビューの生成を中断しました。');
      } else {
        setError(err instanceof Error ? err.message : 'コードレビューの生成に失敗しました。');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setReviewingCode(false);
      setCodeReviewStreamText('');
      setProgressText('');
    }
  }

  return (
    <div className="rounded border border-mp-border bg-mp-bg p-3">
      <p className="mb-2 text-xs font-bold text-mp-muted">🤖 AI学習サポート</p>

      {ac && (
        <div className="mb-3 border-b border-mp-border pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCodeReview()}
              disabled={busy}
              className="flex-1 rounded border border-mp-green/60 bg-mp-surface px-3 py-1.5 text-left text-xs font-bold text-mp-fg hover:bg-mp-surface-hover disabled:opacity-40"
            >
              {reviewingCode ? 'レビューを生成中...' : '✨ AC 後のコードレビュー'}
            </button>
            {reviewingCode && (
              <button
                type="button"
                onClick={handleAbort}
                className="rounded border border-mp-red/50 bg-mp-surface px-2.5 py-1.5 text-xs font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
              >
                中断
              </button>
            )}
          </div>
          {reviewingCode && progressText && (
            <p className="mt-1 text-xs text-mp-muted">{progressText}</p>
          )}
          {reviewingCode && codeReviewStreamText && (
            <div className="mt-2 rounded border border-mp-green/40 bg-mp-green/5 p-2 text-xs">
              <p className="mb-1 font-bold text-mp-green">AC 後のコードレビュー（生成中）</p>
              <p className="whitespace-pre-wrap text-mp-fg">{codeReviewStreamText}</p>
            </div>
          )}
          {!reviewingCode && codeReview && (
            <div className="mt-2 rounded border border-mp-green/40 bg-mp-green/5 p-2 text-xs">
              <p className="mb-1 font-bold text-mp-green">AC 後のコードレビュー</p>
              <p className="whitespace-pre-wrap text-mp-fg">{codeReview}</p>
            </div>
          )}
        </div>
      )}

      {showErrorExplain && (
        <div className="mb-3 border-b border-mp-border pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExplainError()}
              disabled={busy}
              className="flex-1 rounded border border-mp-yellow/60 bg-mp-surface px-3 py-1.5 text-left text-xs font-bold text-mp-fg hover:bg-mp-surface-hover disabled:opacity-40"
            >
              {explainingError ? '解説を生成中...' : '💡 エラーをやさしく解説'}
            </button>
            {explainingError && (
              <button
                type="button"
                onClick={handleAbort}
                className="rounded border border-mp-red/50 bg-mp-surface px-2.5 py-1.5 text-xs font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
              >
                中断
              </button>
            )}
          </div>
          {explainingError && progressText && (
            <p className="mt-1 text-xs text-mp-muted">{progressText}</p>
          )}
          {explainingError && errorExplainStreamText && (
            <div className="mt-2 rounded border border-mp-yellow/40 bg-mp-yellow/5 p-2 text-xs">
              <p className="mb-1 font-bold text-mp-yellow">エラー解説（生成中）</p>
              <p className="whitespace-pre-wrap text-mp-fg">{errorExplainStreamText}</p>
            </div>
          )}
          {!explainingError && errorExplanation && (
            <div className="mt-2 rounded border border-mp-yellow/40 bg-mp-yellow/5 p-2 text-xs">
              <p className="mb-1 font-bold text-mp-yellow">エラー解説</p>
              <p className="whitespace-pre-wrap text-mp-fg">{errorExplanation}</p>
            </div>
          )}
        </div>
      )}

      {!hasFailedRun && !ac && (
        <p className="mb-2 text-xs text-mp-muted">
          まずは「実行」して結果を確認してから、ヒントを利用できます。
        </p>
      )}
      <div className="flex flex-col gap-2">
        {visibleStages.map((stage) => {
          const available = isStageAvailable(stage);
          const revealed = hints[stage] !== undefined;
          const isCurrentLoading = loadingStage === stage;
          return (
            <div key={stage}>
              {!revealed && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleGenerate(stage)}
                    disabled={!available || busy}
                    title={!available ? '前の段階のヒントを先に確認してください。' : undefined}
                    className="flex-1 rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-left text-xs font-bold hover:bg-mp-surface-hover disabled:opacity-40"
                  >
                    {isCurrentLoading ? '生成中...' : HINT_STAGE_LABEL[stage]}
                  </button>
                  {isCurrentLoading && (
                    <button
                      type="button"
                      onClick={handleAbort}
                      className="rounded border border-mp-red/50 bg-mp-surface px-2.5 py-1.5 text-xs font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                    >
                      中断
                    </button>
                  )}
                </div>
              )}
              {isCurrentLoading && progressText && (
                <p className="mt-1 text-xs text-mp-muted">{progressText}</p>
              )}
              {isCurrentLoading && streamingText && (
                <div className="mt-1 rounded border border-mp-cyan/30 bg-mp-cyan/5 p-2 text-xs">
                  <p className="mb-1 font-bold text-mp-cyan">{HINT_STAGE_LABEL[stage]}（生成中）</p>
                  <p className="whitespace-pre-wrap text-mp-fg">{streamingText}</p>
                </div>
              )}
              {revealed && (
                <div className="rounded border border-mp-cyan/30 bg-mp-cyan/5 p-2 text-xs">
                  <p className="mb-1 font-bold text-mp-cyan">{HINT_STAGE_LABEL[stage]}</p>
                  <p className="whitespace-pre-wrap text-mp-fg">{hints[stage]}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {abortedMessage && <p className="mt-2 text-xs text-mp-muted">{abortedMessage}</p>}
      {error && <p className="mt-2 text-xs text-mp-red">{error}</p>}
    </div>
  );
}

// Default export so PracticeTaskPage can `React.lazy()` this — it (and
// @mlc-ai/web-llm underneath it, via ../ai/aiHint / ../ai/aiErrorExplain /
// ../ai/aiCodeReview → ../ai/webllmEngine) is several MB of JS that shouldn't
// land in the shared main bundle just from opening a practice task page.
export default HintPanel;
