import { useState } from 'react';
import { generateHint, HINT_STAGE_LABEL, type HintStage } from '../ai/aiHint';
import type { PracticeTask } from '../types/practice';
import type { JudgeVerdict } from '../types/student';

const STAGES: HintStage[] = [1, 2, 3];

/**
 * Staged AI hint panel for a practice-mode task (PracticeTaskPage). Three
 * buttons, unlocked one at a time: ヒント1 becomes pressable only once the
 * student has an actual non-AC run result (never before they've tried
 * anything themselves); ヒント2/3 each require the previous stage to have
 * been generated first. A generated hint's text is kept once shown — it is
 * NOT regenerated automatically as the student keeps editing; pressing a
 * stage again would just reflect whatever `code`/`verdict` this component
 * currently has as props (which the caller re-renders with as run/submit
 * happen), not a live-typing preview.
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
}: {
  task: PracticeTask;
  code: string;
  verdict: JudgeVerdict | null;
  compileStderr: string | null;
}) {
  const [unlockedStage, setUnlockedStage] = useState<0 | 1 | 2 | 3>(0);
  const [hints, setHints] = useState<Partial<Record<HintStage, string>>>({});
  const [loadingStage, setLoadingStage] = useState<HintStage | null>(null);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hasFailedRun = verdict !== null && verdict.overallStatus !== 'AC';
  const busy = loadingStage !== null;

  function isStageAvailable(stage: HintStage): boolean {
    if (stage === 1) return hasFailedRun;
    return unlockedStage >= stage - 1;
  }

  async function handleGenerate(stage: HintStage) {
    if (!verdict) return;
    setError(null);
    setLoadingStage(stage);
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
        (report) => setProgressText(report.text),
      );
      setHints((prev) => ({ ...prev, [stage]: text }));
      setUnlockedStage((prev) => (prev < stage ? stage : prev) as 0 | 1 | 2 | 3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ヒントの生成に失敗しました。');
    } finally {
      setLoadingStage(null);
      setProgressText('');
    }
  }

  return (
    <div className="rounded border border-mp-border bg-mp-bg p-3">
      <p className="mb-2 text-xs font-bold text-mp-muted">🤖 AIヒント</p>
      {!hasFailedRun && (
        <p className="mb-2 text-xs text-mp-muted">
          まずは「実行」して結果を確認してから、ヒントを利用できます。
        </p>
      )}
      <div className="flex flex-col gap-2">
        {STAGES.map((stage) => {
          const available = isStageAvailable(stage);
          const revealed = hints[stage] !== undefined;
          return (
            <div key={stage}>
              {!revealed && (
                <button
                  type="button"
                  onClick={() => void handleGenerate(stage)}
                  disabled={!available || busy}
                  title={!available ? '前の段階のヒントを先に確認してください。' : undefined}
                  className="w-full rounded border border-mp-border bg-mp-surface px-3 py-1.5 text-left text-xs font-bold hover:bg-mp-surface-hover disabled:opacity-40"
                >
                  {loadingStage === stage ? '生成中...' : HINT_STAGE_LABEL[stage]}
                </button>
              )}
              {loadingStage === stage && progressText && (
                <p className="mt-1 text-xs text-mp-muted">{progressText}</p>
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
      {error && <p className="mt-2 text-xs text-mp-red">{error}</p>}
    </div>
  );
}

// Default export so PracticeTaskPage can `React.lazy()` this — it (and
// @mlc-ai/web-llm underneath it, via ../ai/aiHint → ../ai/aiAssist) is
// several MB of JS that shouldn't land in the shared main bundle just from
// opening a practice task page.
export default HintPanel;
