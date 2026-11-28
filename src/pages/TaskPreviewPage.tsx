import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '../lib/router';
import { useParams } from '../lib/routerContext';
import { getTask, checkSolution } from '../api/tasks';
import { ApiError } from '../api/client';
import { MarkdownBody } from '../components/MarkdownBody';
import { CodeEditor, type EditorMarker } from '../components/CodeEditor';
import { UserDrawer } from '../components/UserDrawer';
import { PageSkeleton } from '../components/Skeleton';
import { SampleDiff } from '../components/SampleDiff';
import { prewarmClientRunner, runClientSide } from '../runner/clientRunner';
import { compareOutput } from '../lib/compareOutput';
import { parseCompileErrors } from '../lib/compileErrors';
import { statusGlyph } from '../lib/status';
import {
  isServerExec,
  LANGUAGE_FILENAME,
  LANGUAGE_LABEL,
  MONACO_LANGUAGE,
  RUNNABLE_LANGUAGES,
} from '../lib/language';
import type { PerTestCaseStatus, SubmissionOverallStatus, TaskDetail } from '../types/exam';

type RunProgress =
  | { phase: 'compiling' }
  | { phase: 'running'; current: number; total: number }
  | { phase: 'server' }
  | null;

interface PreviewTestResult {
  testCaseId: string;
  status: PerTestCaseStatus;
  actualOutput: string;
  timeMs?: number;
}

interface PreviewVerdict {
  overallStatus: SubmissionOverallStatus;
  score: number;
  results: PreviewTestResult[];
}

const STATUS_LABEL: Record<SubmissionOverallStatus, string> = {
  AC: '✅ AC（全テストケース正解）',
  WA: '❌ WA（不正解）',
  CE: '⚠️ コンパイルエラー',
  TLE: '⌛ TLE（実行時間超過）',
  MLE: '⌛ MLE（メモリ超過）',
};

const STATUS_COLOR: Record<SubmissionOverallStatus, string> = {
  AC: 'bg-mp-green text-mp-btn-fg',
  WA: 'bg-mp-red text-mp-btn-fg',
  CE: 'bg-mp-yellow text-mp-btn-fg',
  TLE: 'bg-mp-orange text-mp-btn-fg',
  MLE: 'bg-mp-orange text-mp-btn-fg',
};

const TESTCASE_STATUS_COLOR: Record<PerTestCaseStatus, string> = {
  AC: 'text-mp-green',
  WA: 'text-mp-red',
  RE: 'text-mp-yellow',
  TLE: 'text-mp-orange',
  MLE: 'text-mp-orange',
};

function computePreviewVerdict(
  task: TaskDetail,
  outcomes: {
    testCaseId: string;
    stage: 'success' | 'runtime_error' | 'tle' | 'mle';
    stdout: string;
    timeMs?: number;
  }[],
): PreviewVerdict {
  const results: PreviewTestResult[] = task.testCases.map((tc) => {
    const outcome = outcomes.find((o) => o.testCaseId === tc.id);
    if (!outcome) {
      return { testCaseId: tc.id, status: 'RE', actualOutput: '' };
    }
    if (outcome.stage === 'tle') {
      return {
        testCaseId: tc.id,
        status: 'TLE',
        actualOutput: outcome.stdout,
        timeMs: outcome.timeMs,
      };
    }
    if (outcome.stage === 'mle') {
      return {
        testCaseId: tc.id,
        status: 'MLE',
        actualOutput: outcome.stdout,
        timeMs: outcome.timeMs,
      };
    }
    if (outcome.stage === 'runtime_error') {
      return {
        testCaseId: tc.id,
        status: 'RE',
        actualOutput: outcome.stdout,
        timeMs: outcome.timeMs,
      };
    }
    const matched = compareOutput(
      tc.expectedOutput,
      outcome.stdout,
      task.comparisonMode,
      task.floatTolerance,
    );
    return {
      testCaseId: tc.id,
      status: matched ? 'AC' : 'WA',
      actualOutput: outcome.stdout,
      timeMs: outcome.timeMs,
    };
  });

  const failing = results.filter((r) => r.status !== 'AC');
  let overallStatus: SubmissionOverallStatus;
  if (failing.length === 0) {
    overallStatus = 'AC';
  } else if (failing.every((r) => r.status === 'TLE')) {
    overallStatus = 'TLE';
  } else if (failing.every((r) => r.status === 'MLE')) {
    overallStatus = 'MLE';
  } else {
    overallStatus = 'WA';
  }

  const passed = results.length - failing.length;
  const score =
    overallStatus === 'AC'
      ? task.points
      : task.allowPartialCredit && results.length > 0
        ? Math.round((task.points * passed) / results.length)
        : 0;

  return { overallStatus, score, results };
}

export function TaskPreviewPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RunProgress>(null);
  const [verdict, setVerdict] = useState<PreviewVerdict | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [compileMarkers, setCompileMarkers] = useState<EditorMarker[]>([]);

  const runActionRef = useRef<() => void>(() => {});
  const handleCmdEnter = useCallback(() => runActionRef.current(), []);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    setCompileMarkers([]);
    getTask(taskId)
      .then(({ task }) => {
        setTask(task);
        setCode(task.starterCode ?? '');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '問題の取得に失敗しました。');
      })
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    if (task) prewarmClientRunner(task.language);
  }, [task]);

  function showCompileError(stderr: string) {
    setCompileError(stderr);
    setCompileMarkers(task ? parseCompileErrors(task.language, stderr) : []);
  }

  async function handleRun() {
    if (!task) return;
    setRunning(true);
    setError(null);
    setVerdict(null);
    setCompileError(null);
    setCompileMarkers([]);
    try {
      if (isServerExec(task.language)) {
        setProgress({ phase: 'server' });
        const run = await checkSolution(task.id, code);
        if (run.compileFailed) {
          showCompileError(run.compileStderr || 'コンパイルエラーが発生しました。');
          setVerdict({ overallStatus: 'CE', score: 0, results: [] });
          return;
        }
        setVerdict(computePreviewVerdict(task, run.outcomes));
        return;
      }

      const run = await runClientSide(
        task.language,
        code,
        task.testCases.map((tc) => ({ id: tc.id, input: tc.input })),
        setProgress,
      );
      if (run.compileFailed) {
        showCompileError(run.compileStderr || 'コンパイル／構文エラーが発生しました。');
        setVerdict({ overallStatus: 'CE', score: 0, results: [] });
        return;
      }
      setVerdict(computePreviewVerdict(task, run.outcomes));
    } catch (err) {
      setError(err instanceof Error ? err.message : '実行に失敗しました。');
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  if (loading) {
    return <PageSkeleton />;
  }

  if (!task) {
    return (
      <div role="alert" className="min-h-screen bg-mp-bg p-6 text-mp-red">
        {error ?? '問題が見つかりません。'}
      </div>
    );
  }

  const sampleTestCases = task.testCases.filter((tc) => tc.isSample);
  const languageRunnable = RUNNABLE_LANGUAGES.includes(task.language);

  const compilingMessage =
    task.language === 'C'
      ? 'コンパイル中...（初回はコンパイラのダウンロードのため数十秒〜数分かかることがあります）'
      : task.language === 'PYTHON'
        ? 'Python 実行環境を読み込み中...（初回は数十秒かかることがあります）'
        : 'コンパイル中...';

  runActionRef.current = () => {
    if (running || !languageRunnable) return;
    void handleRun();
  };

  return (
    <div className="flex min-h-screen flex-col bg-mp-bg text-mp-fg">
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-mp-orange/40 bg-mp-orange/15 px-4 py-2 text-xs text-mp-fg"
      >
        <span className="font-bold text-mp-orange">
          生徒画面プレビュー（下書き確認用・保存や提出は行われません）
        </span>
        <Link
          to={`/teacher/exams/${task.examId}/tasks/${task.id}`}
          className="font-semibold text-mp-cyan hover:underline"
        >
          ← 問題編集に戻る
        </Link>
      </div>

      <header className="flex flex-col gap-2 border-b border-mp-border bg-mp-surface px-4 py-2">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-mp-cyan focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-mp-btn-fg"
        >
          本文へスキップ
        </a>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-sm font-bold text-mp-cyan">
            問題 {task.order + 1}: {task.title}（{task.points}点）
          </h1>
          <div className="flex items-center gap-3">
            <UserDrawer />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col gap-4 overflow-hidden p-4 outline-none md:flex-row"
      >
        {/* 左カラム: 問題文 + サンプルテストケース */}
        <div className="flex w-full flex-col overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <h2 className="mb-2 text-sm font-bold text-mp-muted">問題文</h2>
          <div className="markdown-body mb-4 text-sm">
            <MarkdownBody>{task.statementMarkdown}</MarkdownBody>
          </div>

          <h2 className="mb-2 text-sm font-bold text-mp-muted">サンプルテストケース</h2>
          {sampleTestCases.length === 0 ? (
            <p className="text-sm text-mp-muted">サンプルはありません。</p>
          ) : (
            <div className="space-y-3">
              {sampleTestCases.map((tc) => (
                <div key={tc.id} className="rounded bg-mp-bg p-2.5 text-xs font-mono">
                  <p>
                    <strong>入力例:</strong> {tc.input || '(なし)'}
                  </p>
                  <p>
                    <strong>期待される出力例:</strong> {tc.expectedOutput}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 中央カラム: エディタ */}
        <div className="flex w-full flex-col md:w-1/3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{LANGUAGE_LABEL[task.language]}</span>
              <span className="text-xs text-mp-muted">{LANGUAGE_FILENAME[task.language]}</span>
            </div>
            <span className="text-xs text-mp-muted">Ctrl / ⌘ + Enter で実行</span>
          </div>
          <div className="flex-1">
            <CodeEditor
              value={code}
              onChange={(v) => {
                setCode(v);
                if (compileMarkers.length > 0) setCompileMarkers([]);
              }}
              language={MONACO_LANGUAGE[task.language]}
              height={500}
              markers={compileMarkers}
              onCmdEnter={handleCmdEnter}
            />
          </div>
        </div>

        {/* 右カラム: 実行結果 */}
        <div className="flex w-full flex-col gap-3 overflow-y-auto rounded-lg border border-mp-border bg-mp-surface p-4 md:w-1/3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRun}
              disabled={running || !languageRunnable}
              className="flex-1 rounded bg-mp-cyan px-3 py-2 text-sm font-bold text-mp-btn-fg hover:opacity-90 disabled:opacity-50"
            >
              {running ? '実行中...' : '▶ 実行（プレビュー）'}
            </button>
          </div>

          <p className="rounded border border-mp-border bg-mp-bg p-2 text-xs text-mp-muted">
            生徒画面の見え方とテスト実行をプレビューしています。ここでの実行結果は保存されず、受験記録や提出履歴も作成されません。
          </p>

          {!languageRunnable && (
            <p className="rounded border border-mp-border bg-mp-bg p-2 text-xs text-mp-muted">
              {LANGUAGE_LABEL[task.language]}の実行環境は現在準備中です。
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-mp-red">
              {error}
            </p>
          )}

          <div
            role="status"
            aria-live="polite"
            className={(running && progress) || verdict ? 'space-y-3' : 'sr-only'}
          >
            {running && progress && (
              <div className="space-y-1">
                <div
                  role="progressbar"
                  aria-label="テスト実行の進捗"
                  aria-valuemin={progress.phase === 'running' ? 0 : undefined}
                  aria-valuenow={progress.phase === 'running' ? progress.current : undefined}
                  aria-valuemax={progress.phase === 'running' ? progress.total : undefined}
                  className="h-1.5 w-full overflow-hidden rounded bg-mp-bg"
                >
                  <div
                    className={`h-full bg-mp-cyan transition-[width] duration-300 ${
                      progress.phase === 'running' ? '' : 'mp-progress-indeterminate'
                    }`}
                    style={
                      progress.phase === 'running'
                        ? { width: `${(progress.current / Math.max(1, progress.total)) * 100}%` }
                        : undefined
                    }
                  />
                </div>
                <p className="text-xs text-mp-muted">
                  {progress.phase === 'compiling'
                    ? compilingMessage
                    : progress.phase === 'server'
                      ? 'サーバーでコンパイル・実行しています...'
                      : `テストケース ${progress.current}/${progress.total} を実行中...`}
                </p>
              </div>
            )}

            {verdict && (
              <div
                className={`rounded border px-3 py-2 text-center font-bold ${STATUS_COLOR[verdict.overallStatus]}`}
              >
                {STATUS_LABEL[verdict.overallStatus]}
                {verdict.overallStatus !== 'CE' && (
                  <span className="ml-2 font-normal">
                    （{verdict.score}/{task.points}点）
                  </span>
                )}
              </div>
            )}

            {verdict?.overallStatus === 'CE' && compileError && (
              <pre
                role="alert"
                className="whitespace-pre-wrap rounded bg-mp-bg p-3 text-xs text-mp-red"
              >
                {compileError}
              </pre>
            )}
          </div>

          {verdict && verdict.overallStatus !== 'CE' && (
            <div className="space-y-2">
              {task.testCases.map((tc, i) => {
                const result = verdict.results.find((r) => r.testCaseId === tc.id);
                return (
                  <div key={tc.id} className="rounded bg-mp-bg p-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">
                        テストケース {i + 1}
                        {tc.isSample ? '' : '（非公開）'}
                      </span>
                      <span
                        className={
                          result?.status ? TESTCASE_STATUS_COLOR[result.status] : ''
                        }
                      >
                        {result?.status ? `${statusGlyph(result.status)} ${result.status}` : '-'}
                        {result?.timeMs !== undefined && (
                          <span
                            className="ml-1 font-normal text-mp-muted"
                            title="実行時間（この端末での目安）"
                          >
                            {result.timeMs}ms
                          </span>
                        )}
                      </span>
                    </div>
                    {tc.isSample && result && (
                      <div className="text-mp-muted">
                        <p className="font-mono">入力: {tc.input || '(なし)'}</p>
                        {result.status === 'AC' ? (
                          <p className="font-mono">出力: {result.actualOutput}</p>
                        ) : result.status === 'RE' ||
                          result.status === 'TLE' ||
                          result.status === 'MLE' ? (
                          <p className="font-mono">
                            出力: {result.actualOutput || '(なし)'}
                            {result.status === 'TLE'
                              ? '（実行時間超過）'
                              : result.status === 'MLE'
                                ? '（メモリ超過）'
                                : '（実行時エラー）'}
                          </p>
                        ) : (
                          <SampleDiff
                            expected={tc.expectedOutput}
                            actual={result.actualOutput}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
