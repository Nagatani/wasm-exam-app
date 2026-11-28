import { useMemo, useRef, useState } from 'react';
import { getSubmissionDetail } from '../api/exams';
import {
  sanitizeSubmissionForMisconception,
  type AnonymizedFailureSample,
  type AnonymizedStatusCounts,
} from '../ai/aiMisconceptionContext';
import { summarizeMisconceptionsStream } from '../ai/aiMisconception';
import {
  getWebLlmState,
  interruptGenerate,
  isGenerationAbortedError,
  loadWebLlmEngine,
} from '../ai/webllmEngine';
import type { Language, StudentResultRow, TaskResultColumn } from '../types/exam';

const MAX_FETCHED_NON_AC_STUDENTS = 12;

export interface AiMisconceptionPanelProps {
  examId: string;
  tasks: TaskResultColumn[];
  students: StudentResultRow[];
}

/**
 * Lazy-loaded teacher panel on ExamResultsPage that summarizes class-wide
 * misconceptions 100% in-browser using WebLLM on strictly anonymized stats and
 * code samples (no studentNumber / displayName / PII ever enters the prompt).
 */
export function AiMisconceptionPanel({
  examId,
  tasks,
  students,
}: AiMisconceptionPanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string>(() => tasks[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [summaryText, setSummaryText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abortedMessage, setAbortedMessage] = useState<string | null>(null);
  const [analyzedSampleCount, setAnalyzedSampleCount] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const effectiveTaskId = tasks.some((t) => t.id === selectedTaskId)
    ? selectedTaskId
    : (tasks[0]?.id ?? '');

  const perTaskCounts = useMemo(() => {
    const map = new Map<string, AnonymizedStatusCounts>();
    for (const task of tasks) {
      const counts: AnonymizedStatusCounts = {
        AC: 0,
        WA: 0,
        CE: 0,
        TLE: 0,
        MLE: 0,
        unsubmitted: 0,
      };
      for (const s of students) {
        const cell = s.results.find((r) => r.taskId === task.id);
        if (!cell || cell.status === null) {
          counts.unsubmitted += 1;
        } else {
          counts[cell.status] += 1;
        }
      }
      map.set(task.id, counts);
    }
    return map;
  }, [tasks, students]);

  function handleAbort() {
    abortControllerRef.current?.abort();
    interruptGenerate();
  }

  async function handleAnalyze() {
    const task = tasks.find((t) => t.id === effectiveTaskId);
    if (!task) return;
    const statusCounts = perTaskCounts.get(task.id);
    if (!statusCounts) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setBusy(true);
    setError(null);
    setAbortedMessage(null);
    setSummaryText('');
    setAnalyzedSampleCount(null);
    setProgressText('匿名化サンプルを集計しています...');

    try {
      // Collect up to MAX_FETCHED_NON_AC_STUDENTS non-AC submitters for this task
      // and strip all personal identifiers before anything reaches the model.
      const nonAcStudents = students
        .filter((s) => {
          const cell = s.results.find((r) => r.taskId === task.id);
          return cell?.status != null && cell.status !== 'AC';
        })
        .slice(0, MAX_FETCHED_NON_AC_STUDENTS);

      const samples: AnonymizedFailureSample[] = [];
      let detectedLanguage: Language | undefined;

      const settled = await Promise.allSettled(
        nonAcStudents.map(async (s) => {
          const detail = await getSubmissionDetail(examId, s.id);
          const detailTask = detail.tasks.find((t) => t.taskId === task.id);
          if (!detailTask) return null;
          if (!detectedLanguage) {
            detectedLanguage = detailTask.language;
          }
          const failingTestHints = detailTask.results
            .filter((r) => r.status !== 'AC')
            .map((r) => r.hint ?? r.status);
          return sanitizeSubmissionForMisconception(
            {
              status: detailTask.overallStatus,
              language: detailTask.language,
              code: detailTask.code,
              failingTestHints,
            },
            [s.studentNumber, s.displayName, s.id],
          );
        }),
      );

      if (controller.signal.aborted) {
        setAbortedMessage('つまずき傾向の分析を中断しました。');
        return;
      }

      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value !== null) {
          samples.push(res.value);
        }
      }
      setAnalyzedSampleCount(samples.length);

      if (getWebLlmState() !== 'ready') {
        setProgressText('AIモデルを読み込んでいます...');
        await loadWebLlmEngine((report) => setProgressText(report.text));
      }
      if (controller.signal.aborted) {
        setAbortedMessage('つまずき傾向の分析を中断しました。');
        return;
      }

      setProgressText('つまずき傾向を分析しています...');
      const text = await summarizeMisconceptionsStream(
        {
          taskTitle: task.title,
          language: detectedLanguage,
          totalStudents: students.length,
          statusCounts,
          samples,
        },
        {
          onDelta: (textSoFar) => {
            setProgressText('');
            setSummaryText(textSoFar);
          },
          signal: controller.signal,
        },
      );
      setSummaryText(text);
    } catch (err) {
      if (isGenerationAbortedError(err)) {
        setAbortedMessage('つまずき傾向の分析を中断しました。');
      } else {
        setError(err instanceof Error ? err.message : 'つまずき傾向の分析に失敗しました。');
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setBusy(false);
      setProgressText('');
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-mp-border bg-mp-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-left text-xs font-bold text-mp-cyan hover:underline"
          aria-expanded={open}
        >
          {open ? '▼ AIつまずき傾向サマリーを閉じる' : '▶ AIつまずき傾向サマリー（ブラウザ内完結）'}
        </button>
        <span className="text-[11px] text-mp-muted">個人情報・外部送信なし</span>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-mp-border pt-3">
          <p className="text-xs text-mp-muted">
            選択した設問の正答・誤答分布および非AC提出コードから、学籍番号・氏名を除外した匿名化データのみをブラウザ内AIで分析し、よくあるつまずき傾向と次回講義の補足ポイントを要約します。
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="ai-misconception-task" className="text-xs text-mp-muted">
              対象設問
            </label>
            <select
              id="ai-misconception-task"
              value={effectiveTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              disabled={busy}
              className="rounded border border-mp-border bg-mp-bg px-2 py-1 text-xs text-mp-fg disabled:opacity-50"
            >
              {tasks.map((task) => {
                const counts = perTaskCounts.get(task.id);
                const nonAc = counts ? counts.WA + counts.CE + counts.TLE + counts.MLE : 0;
                return (
                  <option key={task.id} value={task.id}>
                    {task.order + 1}. {task.title}（非AC {nonAc}件）
                  </option>
                );
              })}
            </select>

            <div className="ml-auto flex items-center gap-2">
              {busy && (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="rounded border border-mp-red/50 bg-mp-bg px-3 py-1 text-xs font-bold text-mp-red hover:bg-mp-red hover:text-mp-btn-fg"
                >
                  中断
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleAnalyze()}
                disabled={busy || !effectiveTaskId}
                className="rounded bg-mp-cyan px-3 py-1 text-xs font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
              >
                {busy ? '分析中...' : 'つまずき傾向を分析'}
              </button>
            </div>
          </div>

          {busy && progressText && <p className="text-xs text-mp-muted">{progressText}</p>}
          {abortedMessage && <p className="text-xs text-mp-muted">{abortedMessage}</p>}
          {error && (
            <p className="text-xs text-mp-red" role="alert">
              {error}
            </p>
          )}

          {summaryText && (
            <div className="rounded border border-mp-border bg-mp-bg p-3 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-bold text-mp-cyan">
                  つまずき傾向サマリー{busy ? '（生成中）' : ''}
                  {analyzedSampleCount !== null && (
                    <span className="ml-2 font-normal text-mp-muted">
                      （匿名化非ACサンプル {analyzedSampleCount}件を分析）
                    </span>
                  )}
                </span>
                {!busy && (
                  <button
                    type="button"
                    onClick={() => {
                      setSummaryText('');
                      setAnalyzedSampleCount(null);
                    }}
                    className="text-mp-muted hover:underline"
                  >
                    クリア
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-mp-fg">{summaryText}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Default export so ExamResultsPage can `React.lazy()` this — keeping
// @mlc-ai/web-llm completely out of the main/results page bundle.
export default AiMisconceptionPanel;
